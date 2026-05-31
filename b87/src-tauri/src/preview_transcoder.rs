use crate::video_splitter::{VideoSegment, VideoSplitter, create_concat_file};
use crate::wasm_transcoder::{MemoryMonitoredTranscoder, SegmentTranscodeConfig, cleanup_segment_file};
use std::path::{Path, PathBuf};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, mpsc, RwLock};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreviewFrame {
    pub frame_id: Uuid,
    pub segment_index: usize,
    pub timestamp_seconds: f64,
    pub image_path: String,
    pub progress_percent: f64,
    pub width: u32,
    pub height: u32,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscodeState {
    pub job_id: Uuid,
    pub status: TranscodeJobStatus,
    pub total_segments: usize,
    pub completed_segments: usize,
    pub current_segment_index: usize,
    pub overall_progress: f64,
    pub peak_memory_mb: f64,
    pub elapsed_seconds: f64,
    pub estimated_remaining_seconds: f64,
    pub preview_frames: Vec<PreviewFrame>,
    pub current_config: SegmentTranscodeConfig,
    pub work_dir: PathBuf,
    pub input_path: PathBuf,
    pub output_path: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TranscodeJobStatus {
    Initialized,
    Splitting,
    Queued,
    Running,
    Paused,
    Merging,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResumeCheckpoint {
    pub job_id: Uuid,
    pub completed_segment_indices: Vec<usize>,
    pub pending_segment_indices: Vec<usize>,
    pub last_config: SegmentTranscodeConfig,
    pub work_dir: PathBuf,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub struct PreviewTranscoderManager {
    active_jobs: Arc<RwLock<HashMap<Uuid, TranscodeState>>>,
    job_handles: Arc<Mutex<HashMap<Uuid, tokio::task::JoinHandle<()>>>>,
    pause_signals: Arc<Mutex<HashMap<Uuid, Arc<Mutex<bool>>>>>,
    preview_senders: Arc<Mutex<HashMap<Uuid, mpsc::Sender<PreviewFrame>>>>,
}

impl Default for PreviewTranscoderManager {
    fn default() -> Self {
        Self::new()
    }
}

impl PreviewTranscoderManager {
    pub fn new() -> Self {
        Self {
            active_jobs: Arc::new(RwLock::new(HashMap::new())),
            job_handles: Arc::new(Mutex::new(HashMap::new())),
            pause_signals: Arc::new(Mutex::new(HashMap::new())),
            preview_senders: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn create_job(
        &self,
        input_path: PathBuf,
        output_path: PathBuf,
        config: SegmentTranscodeConfig,
    ) -> Result<Uuid, String> {
        let job_id = Uuid::new_v4();
        let work_dir = output_path.parent()
            .unwrap_or_else(|| Path::new("."))
            .join(format!(".transcode_{}", job_id));

        std::fs::create_dir_all(&work_dir)
            .map_err(|e| format!("Failed to create work directory: {}", e))?;

        let state = TranscodeState {
            job_id,
            status: TranscodeJobStatus::Initialized,
            total_segments: 0,
            completed_segments: 0,
            current_segment_index: 0,
            overall_progress: 0.0,
            peak_memory_mb: 0.0,
            elapsed_seconds: 0.0,
            estimated_remaining_seconds: 0.0,
            preview_frames: Vec::new(),
            current_config: config,
            work_dir: work_dir.clone(),
            input_path,
            output_path,
        };

        let mut jobs = self.active_jobs.write().await;
        jobs.insert(job_id, state);

        Ok(job_id)
    }

    pub async fn get_job_state(&self, job_id: Uuid) -> Option<TranscodeState> {
        let jobs = self.active_jobs.read().await;
        jobs.get(&job_id).cloned()
    }

    pub async fn start_transcoding(
        &self,
        job_id: Uuid,
        app_handle: tauri::AppHandle,
    ) -> Result<(), String> {
        let state = {
            let jobs = self.active_jobs.read().await;
            jobs.get(&job_id).cloned()
        };

        let mut state = state.ok_or_else(|| "Job not found".to_string())?;

        let pause_signal = Arc::new(Mutex::new(false));
        {
            let mut signals = self.pause_signals.lock().await;
            signals.insert(job_id, pause_signal.clone());
        }

        let (preview_sender, mut preview_receiver) = mpsc::channel(10);
        {
            let mut senders = self.preview_senders.lock().await;
            senders.insert(job_id, preview_sender);
        }

        let app_handle_clone = app_handle.clone();
        let active_jobs = self.active_jobs.clone();
        
        let handle = tokio::spawn(async move {
            let start_time = std::time::Instant::now();
            let _ = Self::run_transcoding_pipeline(
                job_id,
                &mut state,
                pause_signal,
                preview_sender,
                app_handle_clone.clone(),
                active_jobs.clone(),
            ).await;
        });

        {
            let mut handles = self.job_handles.lock().await;
            handles.insert(job_id, handle);
        }

        let app_handle_preview = app_handle.clone();
        let active_jobs_preview = self.active_jobs.clone();
        tokio::spawn(async move {
            while let Some(preview_frame) = preview_receiver.recv().await {
                let mut jobs = active_jobs_preview.write().await;
                if let Some(state) = jobs.get_mut(&job_id) {
                    state.preview_frames.push(preview_frame.clone());
                }
                
                let _ = app_handle_preview.emit_all(
                    "preview_frame_available",
                    &serde_json::json!({
                        "job_id": job_id.to_string(),
                        "preview_frame": preview_frame,
                    })
                );
            }
        });

        Ok(())
    }

    async fn run_transcoding_pipeline(
        job_id: Uuid,
        state: &mut TranscodeState,
        pause_signal: Arc<Mutex<bool>>,
        preview_sender: mpsc::Sender<PreviewFrame>,
        app_handle: tauri::AppHandle,
        active_jobs: Arc<RwLock<HashMap<Uuid, TranscodeState>>>,
    ) -> Result<(), String> {
        let start_time = std::time::Instant::now();

        {
            let mut jobs = active_jobs.write().await;
            if let Some(s) = jobs.get_mut(&job_id) {
                s.status = TranscodeJobStatus::Splitting;
            }
        }

        let splitter = VideoSplitter::new().with_max_duration(30.0);
        let split_result = splitter.split_video(&state.input_path, &state.work_dir)?;
        
        let segments = split_result.segments;
        let total_segments = segments.len();

        {
            let mut jobs = active_jobs.write().await;
            if let Some(s) = jobs.get_mut(&job_id) {
                s.total_segments = total_segments;
                s.status = TranscodeJobStatus::Running;
            }
        }

        let mut completed_segments: Vec<VideoSegment> = Vec::new();
        let mut last_preview_progress = 0.0;
        let transcoder = MemoryMonitoredTranscoder::new().with_memory_limit(1500.0);

        for (index, segment) in segments.iter().enumerate() {
            loop {
                let is_paused = {
                    let pause = pause_signal.lock().await;
                    *pause
                };

                if is_paused {
                    {
                        let mut jobs = active_jobs.write().await;
                        if let Some(s) = jobs.get_mut(&job_id) {
                            s.status = TranscodeJobStatus::Paused;
                            s.elapsed_seconds = start_time.elapsed().as_secs_f64();
                        }
                    }

                    let _ = app_handle.emit_all(
                        "transcoding_paused",
                        &serde_json::json!({ "job_id": job_id.to_string() })
                    );

                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                    continue;
                }
                break;
            }

            {
                let mut jobs = active_jobs.write().await;
                if let Some(s) = jobs.get_mut(&job_id) {
                    s.status = TranscodeJobStatus::Running;
                    s.current_segment_index = index;
                }
            }

            let segment_output = state.work_dir.join(format!(
                "encoded_{:04d}.mkv",
                segment.index
            ));

            let current_config = {
                let jobs = active_jobs.read().await;
                jobs.get(&job_id).map(|s| s.current_config.clone())
                    .ok_or_else(|| "Job state lost".to_string())?
            };

            let result = transcoder.transcode_segment(
                &segment.path,
                &segment_output,
                &current_config,
            ).await?;

            if !result.success {
                return Err(format!("Segment {} transcoding failed", segment.index));
            }

            completed_segments.push(VideoSegment {
                id: segment.id,
                index: segment.index,
                path: segment_output,
                start_time: segment.start_time,
                duration: segment.duration,
                frame_count: result.encoded_frames,
                size_bytes: std::fs::metadata(&segment_output)
                    .map(|m| m.len())
                    .unwrap_or(0),
            });

            let progress = ((index + 1) as f64 / total_segments as f64) * 100.0;
            
            {
                let mut jobs = active_jobs.write().await;
                if let Some(s) = jobs.get_mut(&job_id) {
                    s.completed_segments = index + 1;
                    s.overall_progress = progress;
                    s.elapsed_seconds = start_time.elapsed().as_secs_f64();
                    s.peak_memory_mb = s.peak_memory_mb.max(result.peak_memory_mb);
                }
            }

            if progress - last_preview_progress >= 10.0 || index == total_segments - 1 {
                last_preview_progress = progress;
                
                if let Ok(preview_frame) = Self::extract_preview_frame(
                    &segment_output,
                    segment.index,
                    progress,
                    &state.work_dir,
                ) {
                    let _ = preview_sender.send(preview_frame).await;
                }
            }

            let _ = app_handle.emit_all(
                "segment_progress",
                &serde_json::json!({
                    "job_id": job_id.to_string(),
                    "segment_index": index,
                    "total_segments": total_segments,
                    "progress": progress,
                    "peak_memory_mb": result.peak_memory_mb,
                })
            );
        }

        {
            let mut jobs = active_jobs.write().await;
            if let Some(s) = jobs.get_mut(&job_id) {
                s.status = TranscodeJobStatus::Merging;
            }
        }

        completed_segments.sort_by_key(|s| s.index);
        Self::merge_segments(&completed_segments, &state.output_path).await?;

        {
            let mut jobs = active_jobs.write().await;
            if let Some(s) = jobs.get_mut(&job_id) {
                s.status = TranscodeJobStatus::Completed;
                s.overall_progress = 100.0;
            }
        }

        let _ = app_handle.emit_all(
            "transcoding_completed",
            &serde_json::json!({
                "job_id": job_id.to_string(),
                "output_path": state.output_path.to_string_lossy().to_string(),
                "total_preview_frames": state.preview_frames.len(),
                "peak_memory_mb": state.peak_memory_mb,
            })
        );

        Ok(())
    }

    fn extract_preview_frame(
        video_path: &Path,
        segment_index: usize,
        progress: f64,
        work_dir: &Path,
    ) -> Result<PreviewFrame, String> {
        let frame_id = Uuid::new_v4();
        let output_path = work_dir.join(format!(
            "preview_{:04d}_{}.jpg",
            segment_index,
            frame_id
        ));

        let output = std::process::Command::new("ffmpeg")
            .args(&[
                "-y",
                "-i", video_path.to_str().ok_or("Invalid video path")?,
                "-ss", "00:00:01",
                "-vframes", "1",
                "-vf", "scale=640:-1",
                "-q:v", "2",
                output_path.to_str().ok_or("Invalid output path")?,
            ])
            .output()
            .map_err(|e| format!("Failed to extract preview: {}", e))?;

        if !output.status.success() {
            return Err("Preview extraction failed".to_string());
        }

        let probe_output = std::process::Command::new("ffprobe")
            .args(&[
                "-v", "quiet",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height,duration",
                "-of", "json",
                output_path.to_str().ok_or("Invalid path")?,
            ])
            .output()
            .map_err(|e| format!("Failed to probe preview: {}", e))?;

        let json: serde_json::Value = serde_json::from_slice(&probe_output.stdout)
            .map_err(|e| format!("Failed to parse probe output: {}", e))?;

        let width = json["streams"][0]["width"].as_u64().unwrap_or(640) as u32;
        let height = json["streams"][0]["height"].as_u64().unwrap_or(360) as u32;
        let duration = json["streams"][0]["duration"].as_str()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.0);

        Ok(PreviewFrame {
            frame_id,
            segment_index,
            timestamp_seconds: duration / 2.0,
            image_path: output_path.to_string_lossy().to_string(),
            progress_percent: progress,
            width,
            height,
            created_at: chrono::Utc::now(),
        })
    }

    async fn merge_segments(segments: &[VideoSegment], output_path: &Path) -> Result<(), String> {
        if segments.is_empty() {
            return Err("No segments to merge".to_string());
        }

        let work_dir = segments[0].path
            .parent()
            .ok_or("Invalid segment path")?;
        
        let concat_path = work_dir.join("final_concat.txt");
        create_concat_file(segments, &concat_path)?;

        let output = tokio::process::Command::new("ffmpeg")
            .args(&[
                "-y",
                "-hide_banner",
                "-f", "concat",
                "-safe", "0",
                "-i", concat_path.to_str().ok_or("Invalid concat path")?,
                "-c", "copy",
                output_path.to_str().ok_or("Invalid output path")?,
            ])
            .output()
            .await
            .map_err(|e| format!("Failed to execute merge: {}", e))?;

        let _ = tokio::fs::remove_file(&concat_path).await;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Merge failed: {}", stderr));
        }

        Ok(())
    }

    pub async fn pause_transcoding(&self, job_id: Uuid) -> Result<(), String> {
        let mut signals = self.pause_signals.lock().await;
        if let Some(signal) = signals.get(&job_id) {
            let mut pause = signal.lock().await;
            *pause = true;
            
            let mut jobs = self.active_jobs.write().await;
            if let Some(state) = jobs.get_mut(&job_id) {
                state.status = TranscodeJobStatus::Paused;
            }
            
            Ok(())
        } else {
            Err("Job not found or not running".to_string())
        }
    }

    pub async fn resume_transcoding(
        &self,
        job_id: Uuid,
        new_config: Option<SegmentTranscodeConfig>,
    ) -> Result<(), String> {
        let mut signals = self.pause_signals.lock().await;
        if let Some(signal) = signals.get(&job_id) {
            let mut pause = signal.lock().await;
            *pause = false;

            if let Some(config) = new_config {
                let mut jobs = self.active_jobs.write().await;
                if let Some(state) = jobs.get_mut(&job_id) {
                    state.current_config = config;
                    state.status = TranscodeJobStatus::Running;
                }
            }

            Ok(())
        } else {
            Err("Job not found".to_string())
        }
    }

    pub async fn update_transcode_config(
        &self,
        job_id: Uuid,
        new_config: SegmentTranscodeConfig,
    ) -> Result<(), String> {
        let mut jobs = self.active_jobs.write().await;
        if let Some(state) = jobs.get_mut(&job_id) {
            state.current_config = new_config;
            Ok(())
        } else {
            Err("Job not found".to_string())
        }
    }

    pub async fn cancel_transcoding(&self, job_id: Uuid) -> Result<(), String> {
        {
            let mut handles = self.job_handles.lock().await;
            if let Some(handle) = handles.remove(&job_id) {
                handle.abort();
            }
        }

        let state = {
            let jobs = self.active_jobs.read().await;
            jobs.get(&job_id).cloned()
        };

        if let Some(s) = state {
            let _ = std::fs::remove_dir_all(&s.work_dir);
        }

        let mut jobs = self.active_jobs.write().await;
        jobs.remove(&job_id);

        Ok(())
    }

    pub async fn create_checkpoint(&self, job_id: Uuid) -> Result<ResumeCheckpoint, String> {
        let jobs = self.active_jobs.read().await;
        let state = jobs.get(&job_id).ok_or_else(|| "Job not found".to_string())?;

        let completed_indices: Vec<usize> = (0..state.completed_segments).collect();
        let pending_indices: Vec<usize> = (state.completed_segments..state.total_segments).collect();

        let checkpoint = ResumeCheckpoint {
            job_id,
            completed_segment_indices: completed_indices,
            pending_segment_indices: pending_indices,
            last_config: state.current_config.clone(),
            work_dir: state.work_dir.clone(),
            created_at: chrono::Utc::now(),
        };

        let checkpoint_path = state.work_dir.join("checkpoint.json");
        let json = serde_json::to_string_pretty(&checkpoint)
            .map_err(|e| format!("Failed to serialize checkpoint: {}", e))?;
        
        tokio::fs::write(&checkpoint_path, json)
            .await
            .map_err(|e| format!("Failed to save checkpoint: {}", e))?;

        Ok(checkpoint)
    }

    pub async fn cleanup_job(&self, job_id: Uuid) -> Result<(), String> {
        let state = {
            let jobs = self.active_jobs.read().await;
            jobs.get(&job_id).cloned()
        };

        if let Some(s) = state {
            let _ = std::fs::remove_dir_all(&s.work_dir);
        }

        let mut jobs = self.active_jobs.write().await;
        jobs.remove(&job_id);

        Ok(())
    }
}
