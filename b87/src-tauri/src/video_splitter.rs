use std::path::{Path, PathBuf};
use std::process::Command;
use std::fs::{self, File};
use std::io::Write;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoSegment {
    pub id: Uuid,
    pub index: usize,
    pub path: PathBuf,
    pub start_time: f64,
    pub duration: f64,
    pub frame_count: u64,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplitResult {
    pub original_path: PathBuf,
    pub segments: Vec<VideoSegment>,
    pub work_dir: PathBuf,
    pub total_duration: f64,
    pub total_frames: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyframeInfo {
    pub pts_time: f64,
    pub pkt_pos: i64,
    pub pkt_size: i32,
}

pub struct VideoSplitter {
    ffprobe_path: String,
    ffmpeg_path: String,
    max_segment_duration: f64,
    target_segment_frames: u64,
}

impl Default for VideoSplitter {
    fn default() -> Self {
        Self {
            ffprobe_path: "ffprobe".to_string(),
            ffmpeg_path: "ffmpeg".to_string(),
            max_segment_duration: 30.0,
            target_segment_frames: 900,
        }
    }
}

impl VideoSplitter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_max_duration(mut self, seconds: f64) -> Self {
        self.max_segment_duration = seconds;
        self
    }

    pub fn detect_keyframes(&self, video_path: &Path) -> Result<Vec<KeyframeInfo>, String> {
        let output = Command::new(&self.ffprobe_path)
            .args(&[
                "-v", "quiet",
                "-select_streams", "v:0",
                "-show_entries", "frame=pts_time,pkt_pos,pkt_size,key_frame",
                "-of", "json",
                video_path.to_str().ok_or("Invalid video path")?,
            ])
            .output()
            .map_err(|e| format!("Failed to execute ffprobe: {}", e))?;

        if !output.status.success() {
            return Err("ffprobe command failed".to_string());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let json: serde_json::Value = serde_json::from_str(&stdout)
            .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;

        let mut keyframes = Vec::new();
        
        if let Some(frames) = json["frames"].as_array() {
            for frame in frames {
                if frame["key_frame"].as_i64().unwrap_or(0) == 1 {
                    if let (Some(pts_time), Some(pkt_pos), Some(pkt_size)) = (
                        frame["pts_time"].as_str().and_then(|s| s.parse().ok()),
                        frame["pkt_pos"].as_i64(),
                        frame["pkt_size"].as_i64().map(|n| n as i32),
                    ) {
                        keyframes.push(KeyframeInfo {
                            pts_time,
                            pkt_pos,
                            pkt_size,
                        });
                    }
                }
            }
        }

        Ok(keyframes)
    }

    pub fn get_video_duration(&self, video_path: &Path) -> Result<f64, String> {
        let output = Command::new(&self.ffprobe_path)
            .args(&[
                "-v", "quiet",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                video_path.to_str().ok_or("Invalid video path")?,
            ])
            .output()
            .map_err(|e| format!("Failed to execute ffprobe: {}", e))?;

        if !output.status.success() {
            return Err("ffprobe command failed".to_string());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout.trim()
            .parse::<f64>()
            .map_err(|e| format!("Failed to parse duration: {}", e))
    }

    pub fn split_video(&self, video_path: &Path, output_dir: &Path) -> Result<SplitResult, String> {
        if !video_path.exists() {
            return Err("Video file does not exist".to_string());
        }

        fs::create_dir_all(output_dir)
            .map_err(|e| format!("Failed to create output directory: {}", e))?;

        let keyframes = self.detect_keyframes(video_path)?;
        let total_duration = self.get_video_duration(video_path)?;

        if keyframes.is_empty() {
            return Err("No keyframes found in video".to_string());
        }

        let mut segments = Vec::new();
        let mut segment_start = 0.0;
        let mut segment_frames = 0;
        let mut segment_index = 0;

        for (i, kf) in keyframes.iter().enumerate() {
            segment_frames += 1;
            
            let should_split = 
                kf.pts_time - segment_start >= self.max_segment_duration ||
                segment_frames >= self.target_segment_frames ||
                i == keyframes.len() - 1;

            if should_split && i > 0 {
                let segment_duration = kf.pts_time - segment_start;
                
                if segment_duration > 1.0 {
                    let segment_path = output_dir.join(format!(
                        "segment_{:04d}.mkv",
                        segment_index
                    ));

                    self.extract_segment(
                        video_path,
                        &segment_path,
                        segment_start,
                        segment_duration,
                    )?;

                    let metadata = fs::metadata(&segment_path)
                        .map_err(|e| format!("Failed to get segment metadata: {}", e))?;

                    segments.push(VideoSegment {
                        id: Uuid::new_v4(),
                        index: segment_index,
                        path: segment_path,
                        start_time: segment_start,
                        duration: segment_duration,
                        frame_count: segment_frames as u64,
                        size_bytes: metadata.len(),
                    });

                    segment_index += 1;
                    segment_start = kf.pts_time;
                    segment_frames = 0;
                }
            }
        }

        if segments.is_empty() {
            return Err("Failed to create any segments".to_string());
        }

        let total_frames: u64 = segments.iter().map(|s| s.frame_count).sum();

        Ok(SplitResult {
            original_path: video_path.to_path_buf(),
            segments,
            work_dir: output_dir.to_path_buf(),
            total_duration,
            total_frames,
        })
    }

    fn extract_segment(
        &self,
        input: &Path,
        output: &Path,
        start_time: f64,
        duration: f64,
    ) -> Result<(), String> {
        let output = Command::new(&self.ffmpeg_path)
            .args(&[
                "-y",
                "-ss", &start_time.to_string(),
                "-i", input.to_str().ok_or("Invalid input path")?,
                "-t", &duration.to_string(),
                "-c", "copy",
                "-avoid_negative_ts", "make_zero",
                "-f", "matroska",
                output.to_str().ok_or("Invalid output path")?,
            ])
            .output()
            .map_err(|e| format!("Failed to execute ffmpeg: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Segment extraction failed: {}", stderr));
        }

        Ok(())
    }

    pub fn cleanup_segments(&self, work_dir: &Path) -> Result<(), String> {
        if work_dir.exists() {
            fs::remove_dir_all(work_dir)
                .map_err(|e| format!("Failed to cleanup segments: {}", e))?;
        }
        Ok(())
    }
}

pub fn create_concat_file(segments: &[VideoSegment], output_path: &Path) -> Result<(), String> {
    let mut file = File::create(output_path)
        .map_err(|e| format!("Failed to create concat file: {}", e))?;

    writeln!(file, "ffconcat version 1.0")
        .map_err(|e| format!("Failed to write concat file: {}", e))?;

    for segment in segments {
        let abs_path = segment.path.canonicalize()
            .map_err(|e| format!("Failed to get absolute path: {}", e))?;
        
        writeln!(file, "file '{}'", abs_path.to_string_lossy().replace("'", "\\'"))
            .map_err(|e| format!("Failed to write segment path: {}", e))?;
    }

    Ok(())
}
