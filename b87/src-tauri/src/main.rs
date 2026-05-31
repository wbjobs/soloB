#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod transcoder;
mod types;
mod hardware;
mod thumbnail;
mod video_splitter;
mod wasm_transcoder;
mod segment_transcoder;
mod preview_transcoder;

use std::sync::Arc;
use tokio::sync::Mutex;
use transcoder::TranscoderManager;
use preview_transcoder::PreviewTranscoderManager;

#[tokio::main]
async fn main() {
    let manager = Arc::new(Mutex::new(TranscoderManager::new()));
    let preview_manager = Arc::new(Mutex::new(PreviewTranscoderManager::new()));

    tauri::Builder::default()
        .manage(manager)
        .manage(preview_manager)
        .invoke_handler(tauri::generate_handler![
            types::get_video_info,
            transcoder::add_to_queue,
            transcoder::start_transcoding,
            transcoder::pause_transcoding,
            transcoder::resume_transcoding,
            transcoder::cancel_transcoding,
            transcoder::remove_from_queue,
            transcoder::get_queue_status,
            transcoder::get_transcoding_progress,
            transcoder::set_max_parallel,
            transcoder::transcode_with_memory_optimization,
            hardware::detect_hardware_acceleration,
            thumbnail::generate_thumbnail_grid,
            preview_transcoder_create_job,
            preview_transcoder_start,
            preview_transcoder_pause,
            preview_transcoder_resume,
            preview_transcoder_update_config,
            preview_transcoder_get_state,
            preview_transcoder_cancel,
            preview_transcoder_create_checkpoint,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
pub async fn preview_transcoder_create_job(
    manager: tauri::State<'_, Arc<Mutex<PreviewTranscoderManager>>>,
    input_path: String,
    output_path: String,
    config: crate::wasm_transcoder::SegmentTranscodeConfig,
) -> Result<String, String> {
    let mgr = manager.lock().await;
    let job_id = mgr.create_job(
        std::path::PathBuf::from(input_path),
        std::path::PathBuf::from(output_path),
        config,
    ).await?;
    Ok(job_id.to_string())
}

#[tauri::command]
pub async fn preview_transcoder_start(
    manager: tauri::State<'_, Arc<Mutex<PreviewTranscoderManager>>>,
    job_id: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let mgr = manager.lock().await;
    let uuid = uuid::Uuid::parse_str(&job_id)
        .map_err(|e| format!("Invalid job ID: {}", e))?;
    mgr.start_transcoding(uuid, app_handle).await
}

#[tauri::command]
pub async fn preview_transcoder_pause(
    manager: tauri::State<'_, Arc<Mutex<PreviewTranscoderManager>>>,
    job_id: String,
) -> Result<(), String> {
    let mgr = manager.lock().await;
    let uuid = uuid::Uuid::parse_str(&job_id)
        .map_err(|e| format!("Invalid job ID: {}", e))?;
    mgr.pause_transcoding(uuid).await
}

#[tauri::command]
pub async fn preview_transcoder_resume(
    manager: tauri::State<'_, Arc<Mutex<PreviewTranscoderManager>>>,
    job_id: String,
    new_config: Option<crate::wasm_transcoder::SegmentTranscodeConfig>,
) -> Result<(), String> {
    let mgr = manager.lock().await;
    let uuid = uuid::Uuid::parse_str(&job_id)
        .map_err(|e| format!("Invalid job ID: {}", e))?;
    mgr.resume_transcoding(uuid, new_config).await
}

#[tauri::command]
pub async fn preview_transcoder_update_config(
    manager: tauri::State<'_, Arc<Mutex<PreviewTranscoderManager>>>,
    job_id: String,
    new_config: crate::wasm_transcoder::SegmentTranscodeConfig,
) -> Result<(), String> {
    let mgr = manager.lock().await;
    let uuid = uuid::Uuid::parse_str(&job_id)
        .map_err(|e| format!("Invalid job ID: {}", e))?;
    mgr.update_transcode_config(uuid, new_config).await
}

#[tauri::command]
pub async fn preview_transcoder_get_state(
    manager: tauri::State<'_, Arc<Mutex<PreviewTranscoderManager>>>,
    job_id: String,
) -> Result<Option<crate::preview_transcoder::TranscodeState>, String> {
    let mgr = manager.lock().await;
    let uuid = uuid::Uuid::parse_str(&job_id)
        .map_err(|e| format!("Invalid job ID: {}", e))?;
    Ok(mgr.get_job_state(uuid).await)
}

#[tauri::command]
pub async fn preview_transcoder_cancel(
    manager: tauri::State<'_, Arc<Mutex<PreviewTranscoderManager>>>,
    job_id: String,
) -> Result<(), String> {
    let mgr = manager.lock().await;
    let uuid = uuid::Uuid::parse_str(&job_id)
        .map_err(|e| format!("Invalid job ID: {}", e))?;
    mgr.cancel_transcoding(uuid).await
}

#[tauri::command]
pub async fn preview_transcoder_create_checkpoint(
    manager: tauri::State<'_, Arc<Mutex<PreviewTranscoderManager>>>,
    job_id: String,
) -> Result<crate::preview_transcoder::ResumeCheckpoint, String> {
    let mgr = manager.lock().await;
    let uuid = uuid::Uuid::parse_str(&job_id)
        .map_err(|e| format!("Invalid job ID: {}", e))?;
    mgr.create_checkpoint(uuid).await
}
