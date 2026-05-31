use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TranscodeStatus {
    Pending,
    Queued,
    Running,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum HardwareAcceleration {
    None,
    Qsv,
    Nvenc,
    Amf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoInfo {
    pub path: String,
    pub filename: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub bitrate: u64,
    pub codec: String,
    pub file_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscodeConfig {
    pub preset: String,
    pub crf: u8,
    pub speed: u8,
    pub target_width: Option<u32>,
    pub target_height: Option<u32>,
    pub hdr_to_sdr: bool,
    pub hardware_accel: HardwareAcceleration,
    pub output_format: String,
}

impl Default for TranscodeConfig {
    fn default() -> Self {
        Self {
            preset: "medium".to_string(),
            crf: 28,
            speed: 6,
            target_width: None,
            target_height: None,
            hdr_to_sdr: false,
            hardware_accel: HardwareAcceleration::None,
            output_format: "mp4".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscodeJob {
    pub id: Uuid,
    pub input_path: PathBuf,
    pub output_path: PathBuf,
    pub config: TranscodeConfig,
    pub status: TranscodeStatus,
    pub progress: f64,
    pub current_fps: f64,
    pub elapsed_time: u64,
    pub remaining_time: Option<u64>,
    pub error_message: Option<String>,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub thumbnail_path: Option<PathBuf>,
}

impl TranscodeJob {
    pub fn new(input_path: PathBuf, output_path: PathBuf, config: TranscodeConfig) -> Self {
        Self {
            id: Uuid::new_v4(),
            input_path,
            output_path,
            config,
            status: TranscodeStatus::Queued,
            progress: 0.0,
            current_fps: 0.0,
            elapsed_time: 0,
            remaining_time: None,
            error_message: None,
            created_at: Utc::now(),
            started_at: None,
            completed_at: None,
            thumbnail_path: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscodingProgress {
    pub job_id: Uuid,
    pub progress: f64,
    pub fps: f64,
    pub elapsed: u64,
    pub remaining: Option<u64>,
    pub frame: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryOptimizedConfig {
    pub enable_segmented_transcoding: bool,
    pub max_segment_duration_seconds: f64,
    pub memory_limit_mb: f64,
    pub max_concurrent_segments: usize,
    pub auto_cleanup_segments: bool,
}

impl Default for MemoryOptimizedConfig {
    fn default() -> Self {
        Self {
            enable_segmented_transcoding: true,
            max_segment_duration_seconds: 30.0,
            memory_limit_mb: 1500.0,
            max_concurrent_segments: 1,
            auto_cleanup_segments: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryStatus {
    pub current_usage_mb: f64,
    pub peak_usage_mb: f64,
    pub memory_limit_mb: f64,
    pub segments_in_memory: usize,
    pub estimated_memory_savings_mb: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentedTranscodeResult {
    pub success: bool,
    pub output_path: String,
    pub total_segments: usize,
    pub peak_memory_mb: f64,
    pub estimated_memory_savings_mb: f64,
    pub total_duration_seconds: f64,
    pub error_message: Option<String>,
}

#[tauri::command]
pub async fn get_video_info(path: String) -> Result<VideoInfo, String> {
    use std::process::Command;
    
    let output = Command::new("ffprobe")
        .args(&[
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            "-select_streams", "v:0",
            &path,
        ])
        .output()
        .map_err(|e| format!("Failed to execute ffprobe: {}", e))?;

    if !output.status.success() {
        return Err("ffprobe command failed".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;

    let streams = json["streams"].as_array().ok_or("No streams found")?;
    let video_stream = streams.get(0).ok_or("No video stream found")?;
    let format = json["format"].as_object().ok_or("No format info found")?;

    let duration = format["duration"]
        .as_str()
        .unwrap_or("0")
        .parse::<f64>()
        .unwrap_or(0.0);

    let width = video_stream["width"]
        .as_u64()
        .unwrap_or(0) as u32;

    let height = video_stream["height"]
        .as_u64()
        .unwrap_or(0) as u32;

    let fps_str = video_stream["r_frame_rate"].as_str().unwrap_or("0/1");
    let fps_parts: Vec<&str> = fps_str.split('/').collect();
    let fps = if fps_parts.len() == 2 {
        fps_parts[0].parse::<f64>().unwrap_or(0.0) / fps_parts[1].parse::<f64>().unwrap_or(1.0)
    } else {
        0.0
    };

    let bitrate = format["bit_rate"]
        .as_str()
        .unwrap_or("0")
        .parse::<u64>()
        .unwrap_or(0);

    let codec = video_stream["codec_name"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();

    let file_size = format["size"]
        .as_str()
        .unwrap_or("0")
        .parse::<u64>()
        .unwrap_or(0);

    let path_buf = PathBuf::from(&path);
    let filename = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    Ok(VideoInfo {
        path,
        filename,
        duration,
        width,
        height,
        fps,
        bitrate,
        codec,
        file_size,
    })
}
