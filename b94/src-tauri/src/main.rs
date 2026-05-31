mod nfc_card;
mod encryption;
mod reader;
mod anti_clone;
mod database;
mod clone_attack;

use tauri::State;
use std::sync::Mutex;
use database::Database;
use anti_clone::AntiCloneDetector;

struct AppState {
    db: Mutex<Database>,
    detector: Mutex<AntiCloneDetector>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = Database::new().expect("Failed to initialize database");
    let detector = AntiCloneDetector::new();

    tauri::Builder::default()
        .manage(AppState {
            db: Mutex::new(db),
            detector: Mutex::new(detector),
        })
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            nfc_card::generate_uid,
            encryption::generate_dynamic_key,
            encryption::get_current_key,
            reader::verify_card,
            reader::simulate_swipe,
            database::get_swipe_logs,
            database::clear_logs,
            database::get_counter,
            database::reset_counter,
            database::clear_all_counters,
            anti_clone::get_alerts,
            anti_clone::clear_alerts,
            clone_attack::simulate_clone_attack,
            clone_attack::get_attack_history,
            clone_attack::get_current_attack,
            clone_attack::clear_attack_history,
            clone_attack::export_attack_report,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
