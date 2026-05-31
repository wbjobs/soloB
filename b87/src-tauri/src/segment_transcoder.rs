use crate::video_splitter::{VideoSegment, SplitResult, VideoSplitter, create_concat_file};
use crate::wasm_transcoder::{MemoryMonitoredTranscoder, SegmentTranscodeConfig, TranscodeSegmentResult, cleanup_segment_file};
use std::path::{Path, PathBuf};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, mpsc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentJob {
    pub segment: VideoSegment,
    pub status: SegmentStatus,
    pub progress: f64,
    pub result: Option<TranscodeSegmentResult>,
    pub output_path: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SegmentStatus {
    Pending,
    Queued,
    Transcoding,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregatedProgress {
    pub total_segments: usize,
    pub completed_segments: usize,
    pub failed_segments: usize,
    pub overall_progress: f64,
    pub current_memory_mb: f64,
    pub peak_memory_mb: f64,
    pub elapsed_seconds: f64,
    pub avg_segment_fps: f64,
    pub estimated_remaining_seconds: f64,
}

pub struct SegmentTranscodeManager {
    jobs: HashMap<Uuid, SegmentJob>,
    segments: Vec<VideoSegment>,
    config: SegmentTranscodeConfig,
    transcoder: MemoryMonitoredTranscoder,
    work_dir: PathBuf,
    output_dir: PathBuf,
    current_job_id: Uuid,
    max_concurrent: usize,
    active_transcodings: usize,
    progress_sender: Option<mpsc::Sender<AggregatedProgress>>,
    start_time: Option<std::time::Instant>,
    total_frames: u64,
    completed_frames: u64,
    peak_memory_tracker: Arc<Mutex<f64>>,
}

impl SegmentTranscodeManager {
    pub fn new(
        split_result: SplitResult,
        config: SegmentTranscodeConfig,
        output_dir: PathBuf,
    ) -> Self {
        let mut jobs = HashMap::new();
        let segments = split_result.segments.clone();

        for segment in &segments {
            let output_path = output_dir.join(format!(
                "transcoded_{:04d}.mkv",
                segment.index
            ));
            
            jobs.insert(
                segment.id,
                SegmentJob {
                    segment: segment.clone(),
                    status: SegmentStatus::Pending,
                    progress: 0.0,
                    result: None,
                    output_path,
                },
            );
        }

        Self {
            jobs,
            segments,
            config,
            transcoder: MemoryMonitoredTranscoder::new().with_memory_limit(1500.0),
            work_dir: split_result.work_dir,
            output_dir,
            current_job_id: Uuid::new_v4(),
            max_concurrent: 1,
            active_transcodings: 0,
            progress_sender: None,
            start_time: None,
            total_frames: split_result.total_frames,
            completed_frames: 0,
            peak_memory_tracker: Arc::new(Mutex::new(0.0)),
        }
    }

    pub fn with_max_concurrent(mut self, max: usize) -> Self {
        self.max_concurrent = max;
        self
    }

    pub fn set_progress_sender(&mut self, sender: mpsc::Sender<AggregatedProgress>) {
        self.progress_sender = Some(sender);
    }

    pub async fn start_transcoding(&mut self) -> Result<Vec<VideoSegment>, String> {
        self.start_time = Some(std::time::Instant::now());
        
        for job in self.jobs.values_mut() {
            job.status = SegmentStatus::Queued;
        }

        let mut completed_segments = Vec::new();
        let mut pending_segment_ids: Vec<Uuid> = self.segments
            .iter()
            .map(|s| s.id)
            .collect();

        pending_segment_ids.sort_by_key(|id| {
            self.jobs.get(id).map(|j| j.segment.index).unwrap_or(0)
        });

        let (result_sender, mut result_receiver) = mpsc::channel(32);
        
        let pending_queue = Arc::new(Mutex::new(pending_segment_ids));

        loop {
            let queue_empty = {
                let queue = pending_queue.lock().await;
                queue.is_empty()
            };

            if queue_empty && self.active_transcodings == 0 {
                break;
            }

            while self.active_transcodings < self.max_concurrent && !{
                let queue = pending_queue.lock().await;
                queue.is_empty()
            } {
                let segment_id = {
                    let mut queue = pending_queue.lock().await;
                    queue.pop()
                };

                if let Some(id) = segment_id {
                    if let Some(job) = self.jobs.get_mut(&id) {
                        job.status = SegmentStatus::Transcoding;
                        self.active_transcodings += 1;

                        let segment = job.segment.clone();
                        let output_path = job.output_path.clone();
                        let config = self.config.clone();
                        let transcoder = self.transcoder.clone();
                        let result_sender = result_sender.clone();
                        let peak_tracker = self.peak_memory_tracker.clone();

                        tokio::spawn(async move {
                            let result = transcoder
                                .transcode_segment(&segment.path, &output_path, &config)
                                .await;

                            let peak_memory = transcoder.peak_memory.lock().await;
                            let mut global_peak = peak_tracker.lock().await;
                            if *peak_memory > *global_peak {
                                *global_peak = *peak_memory;
                            }
                            drop(peak_memory);
                            drop(global_peak);

                            let _ = result_sender.send((segment.id, result)).await;
                        });
                    }
                }
            }

            tokio::select! {
                Some((segment_id, result)) = result_receiver.recv() => {
                    self.active_transcodings -= 1;

                    if let Some(job) = self.jobs.get_mut(&segment_id) {
                        match result {
                            Ok(transcode_result) => {
                                if transcode_result.success {
                                    job.status = SegmentStatus::Completed;
                                    job.progress = 100.0;
                                    job.result = Some(transcode_result.clone());
                                    self.completed_frames += transcode_result.encoded_frames;
                                    
                                    completed_segments.push(VideoSegment {
                                        id: segment_id,
                                        index: job.segment.index,
                                        path: job.output_path.clone(),
                                        start_time: job.segment.start_time,
                                        duration: job.segment.duration,
                                        frame_count: transcode_result.encoded_frames,
                                        size_bytes: std::fs::metadata(&job.output_path)
                                            .map(|m| m.len())
                                            .unwrap_or(0),
                                    });
                                } else {
                                    job.status = SegmentStatus::Failed;
                                    job.result = Some(transcode_result);
                                }
                            }
                            Err(e) => {
                                job.status = SegmentStatus::Failed;
                                job.result = Some(TranscodeSegmentResult {
                                    segment_id,
                                    success: false,
                                    output_path: job.output_path.clone(),
                                    error_message: Some(e),
                                    peak_memory_mb: 0.0,
                                    elapsed_seconds: 0.0,
                                    encoded_frames: 0,
                                    avg_fps: 0.0,
                                });
                            }
                        }
                    }

                    self.send_progress_update().await;
                }
                _ = tokio::time::sleep(tokio::time::Duration::from_millis(500)) => {
                    self.send_progress_update().await;
                }
            }
        }

        completed_segments.sort_by_key(|s| s.index);
        Ok(completed_segments)
    }

    async fn send_progress_update(&self) {
        if let Some(sender) = &self.progress_sender {
            let progress = self.calculate_progress();
            let _ = sender.send(progress).await;
        }
    }

    pub fn calculate_progress(&self) -> AggregatedProgress {
        let total = self.jobs.len();
        let completed = self.jobs.values()
            .filter(|j| j.status == SegmentStatus::Completed)
            .count();
        let failed = self.jobs.values()
            .filter(|j| j.status == SegmentStatus::Failed)
            .count();

        let elapsed = self.start_time
            .map(|t| t.elapsed().as_secs_f64())
            .unwrap_or(0.0);

        let overall_progress = if self.total_frames > 0 {
            (self.completed_frames as f64 / self.total_frames as f64) * 100.0
        } else {
            (completed as f64 / total.max(1) as f64) * 100.0
        };

        let avg_fps: f64 = self.jobs.values()
            .filter_map(|j| j.result.as_ref().map(|r| r.avg_fps))
            .sum::<f64>()
            / completed.max(1) as f64;

        let remaining_frames = self.total_frames.saturating_sub(self.completed_frames);
        let estimated_remaining = if avg_fps > 0.0 {
            remaining_frames as f64 / avg_fps
        } else {
            0.0
        };

        let current_memory = *self.transcoder.current_memory_usage.try_lock().unwrap_or(&0.0);
        let peak_memory = *self.peak_memory_tracker.try_lock().unwrap_or(&0.0);

        AggregatedProgress {
            total_segments: total,
            completed_segments: completed,
            failed_segments: failed,
            overall_progress: overall_progress.min(100.0),
            current_memory_mb: current_memory,
            peak_memory_mb: peak_memory,
            elapsed_seconds: elapsed,
            avg_segment_fps: avg_fps,
            estimated_remaining_seconds: estimated_remaining,
        }
    }

    pub async fn cleanup(&self) -> Result<(), String> {
        let splitter = VideoSplitter::new();
        splitter.cleanup_segments(&self.work_dir).await?;

        for job in self.jobs.values() {
            if job.status == SegmentStatus::Completed {
                let _ = cleanup_segment_file(&job.segment.path).await;
            }
        }

        Ok(())
    }

    pub fn get_job_id(&self) -> Uuid {
        self.current_job_id
    }
}

pub async fn merge_segments(
    segments: &[VideoSegment],
    output_path: &Path,
    format: &str,
) -> Result<(), String> {
    if segments.is_empty() {
        return Err("No segments to merge".to_string());
    }

    let work_dir = segments[0].path
        .parent()
        .ok_or("Invalid segment path")?;
    
    let concat_path = work_dir.join("concat_list.txt");
    create_concat_file(segments, &concat_path)?;

    let output = tokio::process::Command::new("ffmpeg")
        .args(&[
            "-y",
            "-hide_banner",
            "-f", "concat",
            "-safe", "0",
            "-i", concat_path.to_str().ok_or("Invalid concat path")?,
            "-c", "copy",
            "-f", format,
            output_path.to_str().ok_or("Invalid output path")?,
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to execute ffmpeg merge: {}", e))?;

    let _ = tokio::fs::remove_file(&concat_path).await;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Merge failed: {}", stderr));
    }

    Ok(())
}
