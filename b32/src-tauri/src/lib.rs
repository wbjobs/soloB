mod embedding;
mod code_parser;
mod vector_db;
mod commands;

use commands::{
    get_data_directory,
    scan_directory,
    get_scan_progress,
    has_existing_index,
    search_code,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::AppState::new())
        .invoke_handler(tauri::generate_handler![
            get_data_directory,
            scan_directory,
            get_scan_progress,
            has_existing_index,
            search_code,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
