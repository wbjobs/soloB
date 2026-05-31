use crate::types::{HardwareAcceleration, TranscodeConfig, TranscodeJob, TranscodeStatus, TranscodingProgress, VideoInfo};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use uuid::Uuid;

pub struct TranscoderManager {
    queue: HashMap<Uuid, TranscodeJob>,
    max_parallel: usize,
    running_jobs: Vec<Uuid>,
}

impl TranscoderManager {
    pub fn new() -> Self {
        Self {
            queue: HashMap::new(),
            max_parallel: 2,
            running_jobs: Vec::new(),
        }
    }

    pub fn add_job(&mut self, job: TranscodeJob) {
        self.queue.insert(job.id, job);
    }

    pub fn get_job(&self, id: Uuid) -> Option<&TranscodeJob> {
        self.queue.get(&id)
    }

    pub fn get_job_mut(&mut self, id: Uuid) -> Option<&mut TranscodeJob> {
        self.queue.get_mut(&id)
    }

    pub fn remove_job(&mut self, id: Uuid) -> Option<TranscodeJob> {
        self.queue.remove(&id)
    }

    pub fn get_all_jobs(&self) -> Vec<TranscodeJob> {
        self.queue.values().cloned().collect()
    }

    pub fn can_start_job(&self) -> bool {
        self.running_jobs.len() < self.max_parallel
    }

    pub fn get_next_queued_job(&mut self) -> Option<Uuid> {
        self.queue
            .values()
            .find(|j| matches!(j.status, TranscodeStatus::Queued))
            .map(|j| j.id)
    }
}

fn build_ffmpeg_command(
    input: &PathBuf,
    output: &PathBuf,
    config: &TranscodeConfig,
    video_info: &VideoInfo,
) -> Vec<String> {
    let mut args = vec![
        "-y".to_string(),
        "-i".to_string(),
        input.to_string_lossy().to_string(),
    ];

    let codec = match config.hardware_accel {
        HardwareAcceleration::Nvenc => "hevc_nvenc",
        HardwareAcceleration::Qsv => "hevc_qsv",
        HardwareAcceleration::Amf => "hevc_amf",
        HardwareAcceleration::None => "libx265",
    };

    args.extend(vec![
        "-c:v".to_string(),
        codec.to_string(),
        "-crf".to_string(),
        config.crf.to_string(),
        "-preset".to_string(),
        config.preset.clone(),
    ]);

    if let (Some(w), Some(h)) = (config.target_width, config.target_height) {
        args.extend(vec![
            "-vf".to_string(),
            format!("scale={}:{}", w, h),
        ]);
    }

    if config.hdr_to_sdr {
        args.extend(vec![
            "-vf".to_string(),
            "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p".to_string(),
        ]);
    }

    args.extend(vec![
        "-c:a".to_string(),
        "copy".to_string(),
        "-progress".to_string(),
        "-".to_string(),
        "-nostats".to_string(),
        output.to_string_lossy().to_string(),
    ]);

    args
}

async fn parse_ffmpeg_progress(line: &str, duration: f64) -> Option<TranscodingProgress> {
    let mut out_time = None;
    let mut fps = None;
    let mut frame = None;

    for part in line.split_whitespace() {
        if let Some((key, value)) = part.split_once('=') {
            match key {
                "out_time_ms" => {
                    if let Ok(ms) = value.parse::<f64>() {
                        out_time = Some(ms / 1000.0);
                    }
                }
                "fps" => {
                    if let Ok(f) = value.parse::<f64>() {
                        fps = Some(f);
                    }
                }
                "frame" => {
                    if let Ok(f) = value.parse::<u64>() {
                        frame = Some(f);
                    }
                }
                _ => {}
            }
        }
    }

    let progress = out_time.map(|t| (t / duration) * 100.0).unwrap_or(0.0);
    let elapsed = out_time.unwrap_or(0.0) as u64;
    let remaining = if progress > 0.0 && elapsed > 0 {
        Some(((elapsed as f64 / progress) * (100.0 - progress)) as u64)
    } else {
        None
    };

    Some(TranscodingProgress {
        job_id: Uuid::nil(),
        progress: progress.min(100.0),
        fps: fps.unwrap_or(0.0),
        elapsed,
        remaining,
        frame: frame.unwrap_or(0),
    })
}

#[tauri::command]
pub async fn add_to_queue(
    manager: tauri::State<'_, Arc<Mutex<TranscoderManager>>>,
    input_path: String,
    output_path: String,
    config: TranscodeConfig,
) -> Result<Uuid, String> {
    let input = PathBuf::from(input_path);
    let output = PathBuf::from(output_path);
    
    let job = TranscodeJob::new(input, output, config);
    let job_id = job.id;

    let mut mgr = manager.lock().await;
    mgr.add_job(job);

    Ok(job_id)
}

#[tauri::command]
pub async fn start_transcoding(
    manager: tauri::State<'_, Arc<Mutex<TranscoderManager>>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let manager_clone = manager.inner().clone();
    
    tokio::spawn(async move {
        loop {
            let job_id = {
                let mut mgr = manager_clone.lock().await;
                if !mgr.can_start_job() {
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                    continue;
                }
                mgr.get_next_queued_job()
            };

            if let Some(job_id) = job_id {
                let manager_for_job = manager_clone.clone();
                let app_handle_clone = app_handle.clone();
                
                tokio::spawn(async move {
                    let job_info = {
                        let mut mgr = manager_for_job.lock().await;
                        if let Some(job) = mgr.get_job_mut(job_id) {
                            job.status = TranscodeStatus::Running;
                            job.started_at = Some(chrono::Utc::now());
                            Some(job.clone())
                        } else {
                            None
                        }
                    };

                    if let Some(job) = job_info {
                        let video_info = crate::types::get_video_info(
                            job.input_path.to_string_lossy().to_string()
                        ).await.ok();

                        if let Some(info) = video_info {
                            let args = build_ffmpeg_command(
                                &job.input_path,
                                &job.output_path,
                                &job.config,
                                &info,
                            );

                            let mut cmd = Command::new("ffmpeg");
                            cmd.args(&args);
                            cmd.stdout(std::process::Stdio::piped());
                            cmd.stderr(std::process::Stdio::piped());

                            if let Ok(mut child) = cmd.spawn() {
                                let stdout = child.stdout.take().unwrap();
                                let reader = BufReader::new(stdout);
                                let mut lines = reader.lines();

                                while let Ok(Some(line)) = lines.next_line().await {
                                    if let Some(mut progress) = parse_ffmpeg_progress(&line, info.duration).await {
                                        progress.job_id = job_id;
                                        
                                        let mut mgr = manager_for_job.lock().await;
                                        if let Some(job) = mgr.get_job_mut(job_id) {
                                            job.progress = progress.progress;
                                            job.current_fps = progress.fps;
                                            job.elapsed_time = progress.elapsed;
                                            job.remaining_time = progress.remaining;
                                        }

                                        let _ = app_handle_clone.emit_all("transcoding_progress", &progress);
                                    }
                                }

                                let status = child.wait().await;
                                let mut mgr = manager_for_job.lock().await;
                                
                                if let Ok(exit_status) = status {
                                    if exit_status.success() {
                                        if let Some(job) = mgr.get_job_mut(job_id) {
                                            job.status = TranscodeStatus::Completed;
                                            job.completed_at = Some(chrono::Utc::now());
                                            job.progress = 100.0;
                                        }

                                        let _ = crate::thumbnail::generate_thumbnail_grid(
                                            job.output_path.to_string_lossy().to_string(),
                                        ).await.map(|thumb_path| {
                                            if let Some(job) = mgr.get_job_mut(job_id) {
                                                job.thumbnail_path = Some(PathBuf::from(thumb_path));
                                            }
                                        });
                                    } else {
                                        if let Some(job) = mgr.get_job_mut(job_id) {
                                            job.status = TranscodeStatus::Failed;
                                            job.error_message = Some("FFmpeg exited with error".to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                });
            } else {
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn pause_transcoding(
    manager: tauri::State<'_, Arc<Mutex<TranscoderManager>>>,
    job_id: Uuid,
) -> Result<(), String> {
    let mut mgr = manager.lock().await;
    if let Some(job) = mgr.get_job_mut(job_id) {
        job.status = TranscodeStatus::Paused;
    }
    Ok(())
}

#[tauri::command]
pub async fn resume_transcoding(
    manager: tauri::State<'_, Arc<Mutex<TranscoderManager>>>,
    job_id: Uuid,
) -> Result<(), String> {
    let mut mgr = manager.lock().await;
    if let Some(job) = mgr.get_job_mut(job_id) {
        job.status = TranscodeStatus::Queued;
    }
    Ok(())
}

#[tauri::command]
pub async fn cancel_transcoding(
    manager: tauri::State<'_, Arc<Mutex<TranscoderManager>>>,
    job_id: Uuid,
) -> Result<(), String> {
    let mut mgr = manager.lock().await;
    if let Some(job) = mgr.get_job_mut(job_id) {
        job.status = TranscodeStatus::Cancelled;
    }
    Ok(())
}

#[tauri::command]
pub async fn remove_from_queue(
    manager: tauri::State<'_, Arc<Mutex<TranscoderManager>>>,
    job_id: Uuid,
) -> Result<(), String> {
    let mut mgr = manager.lock().await;
    mgr.remove_job(job_id);
    Ok(())
}

#[tauri::command]
pub async fn get_queue_status(
    manager: tauri::State<'_, Arc<Mutex<TranscoderManager>>>,
) -> Result<Vec<TranscodeJob>, String> {
    let mgr = manager.lock().await;
    Ok(mgr.get_all_jobs())
}

#[tauri::command]
pub async fn get_transcoding_progress(
    manager: tauri::State<'_, Arc<Mutex<TranscoderManager>>>,
    job_id: Uuid,
) -> Result<Option<TranscodeJob>, String> {
    let mgr = manager.lock().await;
    Ok(mgr.get_job(job_id).cloned())
}

#[tauri::command]
pub async fn set_max_parallel(
    manager: tauri::State<'_, Arc<Mutex<TranscoderManager>>>,
    max: usize,
) -> Result<(), String> {
    let mut mgr = manager.lock().await;
    mgr.max_parallel = max;
    Ok(())
}

#[tauri::command]
pub async fn transcode_with_memory_optimization(
    input_path: String,
    output_path: String,
    config: TranscodeConfig,
    memory_config: crate::types::MemoryOptimizedConfig,
    app_handle: tauri::AppHandle,
) -> Result<crate::types::SegmentedTranscodeResult, String> {
    use crate::video_splitter::VideoSplitter;
    use crate::segment_transcoder::{SegmentTranscodeManager, merge_segments};
    use crate::wasm_transcoder::SegmentTranscodeConfig;
    use std::path::Path;

    let input = Path::new(&input_path);
    let output = Path::new(&output_path);
    
    if !input.exists() {
        return Err("Input file does not exist".to_string());
    }

    let video_info = crate::types::get_video_info(input_path.clone()).await?;
    
    let estimated_full_memory = if video_info.width >= 3840 {
        3500.0 + (video_info.width * video_info.height) as f64 / 100000.0
    } else {
        1500.0 + (video_info.width * video_info.height) as f64 / 200000.0
    };

    let work_dir = output.parent()
        .unwrap_or_else(|| Path::new("."))
        .join(".transcode_work");

    std::fs::create_dir_all(&work_dir)
        .map_err(|e| format!("Failed to create work directory: {}", e))?;

    let splitter = VideoSplitter::new()
        .with_max_duration(memory_config.max_segment_duration_seconds);

    let split_result = splitter.split_video(input, &work_dir)?;
    
    let segment_count = split_result.segments.len();

    let segment_config = SegmentTranscodeConfig {
        crf: config.crf,
        preset: config.preset.clone(),
        target_width: config.target_width,
        target_height: config.target_height,
        hdr_to_sdr: config.hdr_to_sdr,
        hardware_accel: format!("{:?}", config.hardware_accel),
    };

    let (progress_sender, mut progress_receiver) = tokio::sync::mpsc::channel(32);

    let app_handle_clone = app_handle.clone();
    tokio::spawn(async move {
        while let Some(progress) = progress_receiver.recv().await {
            let event_payload = serde_json::json!({
                "job_id": uuid::Uuid::new_v4().to_string(),
                "progress": progress.overall_progress,
                "fps": progress.avg_segment_fps,
                "elapsed": progress.elapsed_seconds as u64,
                "remaining": Some(progress.estimated_remaining_seconds as u64),
                "current_memory_mb": progress.current_memory_mb,
                "peak_memory_mb": progress.peak_memory_mb,
                "completed_segments": progress.completed_segments,
                "total_segments": progress.total_segments,
            });
            let _ = app_handle_clone.emit_all("segmented_transcoding_progress", &event_payload);
        }
    });

    let mut segment_manager = SegmentTranscodeManager::new(
        split_result,
        segment_config,
        work_dir.clone(),
    );
    segment_manager = segment_manager.with_max_concurrent(memory_config.max_concurrent_segments);
    segment_manager.set_progress_sender(progress_sender);

    let completed_segments = segment_manager.start_transcoding().await?;
    
    if completed_segments.is_empty() {
        return Err("No segments were successfully transcoded".to_string());
    }

    merge_segments(&completed_segments, output, &config.output_format).await?;

    let final_progress = segment_manager.calculate_progress();

    if memory_config.auto_cleanup_segments {
        let _ = segment_manager.cleanup().await;
    }

    let thumbnail_result = crate::thumbnail::generate_thumbnail_grid(output_path.clone()).await;

    let estimated_savings = estimated_full_memory - final_progress.peak_memory_mb.max(0.0);

    Ok(crate::types::SegmentedTranscodeResult {
        success: true,
        output_path: output_path.clone(),
        total_segments: segment_count,
        peak_memory_mb: final_progress.peak_memory_mb,
        estimated_memory_savings_mb: estimated_savings.max(0.0),
        total_duration_seconds: final_progress.elapsed_seconds,
        error_message: None,
    })
}
