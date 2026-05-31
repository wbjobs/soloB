use std::path::PathBuf;
use std::process::Command;

#[tauri::command]
pub async fn generate_thumbnail_grid(video_path: String) -> Result<String, String> {
    let video = PathBuf::from(&video_path);
    let thumbnail_path = video.with_file_name(format!(
        "{}_thumbgrid.jpg",
        video.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("video")
    ));

    let output = Command::new("ffmpeg")
        .args(&[
            "-y",
            "-i",
            &video_path,
            "-vf",
            "fps=1/10,scale=320:-1,tile=3x3",
            "-frames:v",
            "1",
            "-q:v",
            "2",
            thumbnail_path.to_str().unwrap(),
        ])
        .output()
        .map_err(|e| format!("Failed to generate thumbnail: {}", e))?;

    if output.status.success() {
        Ok(thumbnail_path.to_string_lossy().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Thumbnail generation failed: {}", stderr))
    }
}
