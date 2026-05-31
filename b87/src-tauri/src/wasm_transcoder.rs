use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};
use sysinfo::{System, SystemExt, ProcessExt, Pid};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscodeSegmentResult {
    pub segment_id: Uuid,
    pub success: bool,
    pub output_path: PathBuf,
    pub error_message: Option<String>,
    pub peak_memory_mb: f64,
    pub elapsed_seconds: f64,
    pub encoded_frames: u64,
    pub avg_fps: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentTranscodeConfig {
    pub crf: u8,
    pub preset: String,
    pub target_width: Option<u32>,
    pub target_height: Option<u32>,
    pub hdr_to_sdr: bool,
    pub hardware_accel: String,
}

pub struct MemoryMonitoredTranscoder {
    memory_limit_mb: f64,
    current_memory_usage: Arc<Mutex<f64>>,
    peak_memory: Arc<Mutex<f64>>,
    ffmpeg_path: String,
}

impl Default for MemoryMonitoredTranscoder {
    fn default() -> Self {
        Self {
            memory_limit_mb: 1500.0,
            current_memory_usage: Arc::new(Mutex::new(0.0)),
            peak_memory: Arc::new(Mutex::new(0.0)),
            ffmpeg_path: "ffmpeg".to_string(),
        }
    }
}

impl MemoryMonitoredTranscoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_memory_limit(mut self, limit_mb: f64) -> Self {
        self.memory_limit_mb = limit_mb;
        self
    }

    async fn monitor_memory(&self, pid: u32, stop_signal: Arc<Mutex<bool>>) {
        let mut system = System::new_all();
        let pid = Pid::from(pid as usize);

        loop {
            {
                let stop = stop_signal.lock().await;
                if *stop {
                    break;
                }
            }

            system.refresh_process(pid);
            
            if let Some(process) = system.process(pid) {
                let memory_mb = process.memory() as f64 / 1024.0;
                
                let mut current = self.current_memory_usage.lock().await;
                *current = memory_mb;

                let mut peak = self.peak_memory.lock().await;
                if memory_mb > *peak {
                    *peak = memory_mb;
                }
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
    }

    pub async fn transcode_segment(
        &self,
        input_path: &Path,
        output_path: &Path,
        config: &SegmentTranscodeConfig,
    ) -> Result<TranscodeSegmentResult, String> {
        let start_time = Instant::now();
        let segment_id = Uuid::new_v4();

        *self.peak_memory.lock().await = 0.0;
        *self.current_memory_usage.lock().await = 0.0;

        let mut args = vec![
            "-y".to_string(),
            "-hide_banner".to_string(),
            "-i".to_string(),
            input_path.to_string_lossy().to_string(),
        ];

        match config.hardware_accel.as_str() {
            "Nvenc" => {
                args.extend(vec![
                    "-c:v".to_string(), "hevc_nvenc".to_string(),
                    "-rc".to_string(), "vbr".to_string(),
                    "-cq".to_string(), config.crf.to_string(),
                    "-preset".to_string(), "p6".to_string(),
                ]);
            }
            "Qsv" => {
                args.extend(vec![
                    "-c:v".to_string(), "hevc_qsv".to_string(),
                    "-global_quality".to_string(), config.crf.to_string(),
                    "-preset".to_string(), "medium".to_string(),
                ]);
            }
            _ => {
                args.extend(vec![
                    "-c:v".to_string(), "libx265".to_string(),
                    "-crf".to_string(), config.crf.to_string(),
                    "-preset".to_string(), config.preset.clone(),
                    "-x265-params".to_string(), "pool=none:wpp=0:frame-threads=1".to_string(),
                ]);
            }
        }

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
            "-c:a".to_string(), "copy".to_string(),
            "-f".to_string(), "matroska".to_string(),
            output_path.to_string_lossy().to_string(),
        ]);

        let mut child = Command::new(&self.ffmpeg_path)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;

        let pid = child.id();
        let stop_signal = Arc::new(Mutex::new(false));
        
        let monitor_handle = {
            let stop_signal = stop_signal.clone();
            let memory_monitor = self.clone();
            tokio::spawn(async move {
                memory_monitor.monitor_memory(pid, stop_signal).await;
            })
        };

        let status = tokio::task::spawn_blocking(move || child.wait())
            .await
            .map_err(|e| format!("Failed to wait for process: {}", e))?
            .map_err(|e| format!("Process wait error: {}", e))?;

        {
            let mut stop = stop_signal.lock().await;
            *stop = true;
        }
        
        let _ = monitor_handle.await;

        let elapsed = start_time.elapsed().as_secs_f64();
        let peak_memory = *self.peak_memory.lock().await;

        if peak_memory > self.memory_limit_mb {
            let _ = std::fs::remove_file(output_path);
            return Err(format!(
                "Memory limit exceeded: {:.1} MB > {:.1} MB",
                peak_memory, self.memory_limit_mb
            ));
        }

        if !status.success() {
            return Ok(TranscodeSegmentResult {
                segment_id,
                success: false,
                output_path: output_path.to_path_buf(),
                error_message: Some(format!("FFmpeg exited with code: {}", status)),
                peak_memory_mb: peak_memory,
                elapsed_seconds: elapsed,
                encoded_frames: 0,
                avg_fps: 0.0,
            });
        }

        let frame_count = self.count_frames(output_path).unwrap_or(0);
        let avg_fps = if elapsed > 0.0 { frame_count as f64 / elapsed } else { 0.0 };

        Ok(TranscodeSegmentResult {
            segment_id,
            success: true,
            output_path: output_path.to_path_buf(),
            error_message: None,
            peak_memory_mb: peak_memory,
            elapsed_seconds: elapsed,
            encoded_frames: frame_count,
            avg_fps,
        })
    }

    fn count_frames(&self, path: &Path) -> Result<u64, String> {
        let output = Command::new("ffprobe")
            .args(&[
                "-v", "quiet",
                "-select_streams", "v:0",
                "-count_frames",
                "-show_entries", "stream=nb_read_frames",
                "-of", "default=noprint_wrappers=1:nokey=1",
                path.to_str().ok_or("Invalid path")?,
            ])
            .output()
            .map_err(|e| format!("Failed to count frames: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout.trim()
            .parse::<u64>()
            .map_err(|e| format!("Failed to parse frame count: {}", e))
    }

    pub fn get_current_memory_usage(&self) -> Arc<Mutex<f64>> {
        self.current_memory_usage.clone()
    }
}

impl Clone for MemoryMonitoredTranscoder {
    fn clone(&self) -> Self {
        Self {
            memory_limit_mb: self.memory_limit_mb,
            current_memory_usage: self.current_memory_usage.clone(),
            peak_memory: self.peak_memory.clone(),
            ffmpeg_path: self.ffmpeg_path.clone(),
        }
    }
}

pub fn estimate_segment_memory(width: u32, height: u32, frames: u64) -> f64 {
    let pixels_per_frame = width as f64 * height as f64;
    let bytes_per_pixel = 1.5;
    let frame_buffer_count = 4.0;
    let codec_overhead = 1.5;
    
    let memory_bytes = pixels_per_frame * bytes_per_pixel * frames.min(10) as f64 * frame_buffer_count * codec_overhead;
    memory_bytes / 1024.0 / 1024.0
}

pub async fn cleanup_segment_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        tokio::fs::remove_file(path)
            .await
            .map_err(|e| format!("Failed to cleanup segment: {}", e))?;
    }
    Ok(())
}
