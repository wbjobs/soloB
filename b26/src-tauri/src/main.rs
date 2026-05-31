#![cfg_attr(
    all(not(debug_assertions), windows_subsystem = "windows"))]

use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
    collections::VecDeque,
};

use dirs;
use serde::{Deserialize, Serialize};
use tauri::{
    api::notification::Notification,
    AppHandle, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTraySubmenu, CustomMenuItem,
};
use uuid::Uuid;
use chrono::Utc;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct NotificationItem {
    id: String,
    title: String,
    body: String,
    timestamp: i64,
}

struct AppState {
    notifications_paused: bool,
    recent_notifications: VecDeque<NotificationItem>,
}

const IPC_PORT_FILE: &str = "tray-notify-ipc.txt";
const STATE_FILE: &str = "app-state.json";
const MAX_RECENT_NOTIFICATIONS: usize = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistentState {
    notifications_paused: bool,
    recent_notifications: Vec<NotificationItem>,
}

fn get_state_file_path() -> PathBuf {
    let dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("TauriTrayNotify")
        .join(STATE_FILE)
}

fn read_persistent_state() -> PersistentState {
    let path = get_state_file_path();
    if let Ok(file) = fs::File::open(&path) {
        let reader = std::io::BufReader::new(file);
        if let Ok(state) = serde_json::from_reader::<_, PersistentState>(reader) {
            return state;
        }
    }
    PersistentState {
        notifications_paused: false,
        recent_notifications: Vec::new(),
    }
}

fn write_persistent_state(state: &PersistentState) {
    let path = get_state_file_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(file) = fs::File::create(&path) {
        let _ = serde_json::to_writer_pretty(file, state);
    }
}

fn read_state() -> bool {
    read_persistent_state().notifications_paused
}

fn write_state(notifications_paused: bool, recent_notifications: &VecDeque<NotificationItem>) {
    let state = PersistentState {
        notifications_paused,
        recent_notifications: recent_notifications.iter().cloned().collect(),
    };
    write_persistent_state(&state);
}

fn get_ipc_file_path() -> PathBuf {
    let dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("TauriTrayNotify")
        .join(IPC_PORT_FILE)
}

fn check_single_instance() -> bool {
    let path = get_ipc_file_path();
    path.exists()
}

fn create_ipc_file() {
    let path = get_ipc_file_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if !path.exists() {
        let _ = fs::File::create(&path);
    }
}

fn write_to_ipc_file(content: &str) {
    let path = get_ipc_file_path();
    if let Ok(mut file) = fs::File::create(&path) {
        let _ = file.write_all(content.as_bytes());
    }
}

fn read_from_ipc_file() -> Option<String> {
    let path = get_ipc_file_path();
    let mut file = fs::File::open(&path).ok()?;
    let mut content = String::new();
    file.read_to_string(&mut content).ok()?;
    if content.is_empty() {
        None
    } else {
        Some(content)
    }
}

fn send_notification(app: &AppHandle, title: &str, body: &str) {
    let notifications_paused = read_state();
    let should_show = !notifications_paused;
    
    let state = app.state::<Arc<Mutex<AppState>>>().inner().clone();
    let mut state_lock = state.lock().unwrap();
    
    let notification = NotificationItem {
        id: Uuid::new_v4().to_string(),
        title: title.to_string(),
        body: body.to_string(),
        timestamp: Utc::now().timestamp(),
    };
    
    state_lock.recent_notifications.push_front(notification.clone());
    if state_lock.recent_notifications.len() > MAX_RECENT_NOTIFICATIONS {
        state_lock.recent_notifications.pop_back();
    }
    
    write_state(state_lock.notifications_paused, &state_lock.recent_notifications);
    
    if should_show {
        let _ = Notification::new(&app.config().tauri.bundle.identifier)
            .title(title)
            .body(body)
            .show();
    }
    
    update_tray_menu(app);
}

fn create_tray_menu(recent_notifications: &VecDeque<NotificationItem>) -> SystemTrayMenu {
    let mut menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("显示主窗口", "显示主窗口"))
        .add_native_item(tauri::SystemTrayMenuItem::Separator);
    
    if !recent_notifications.is_empty() {
        let mut submenu = SystemTrayMenu::new();
        for notification in recent_notifications.iter() {
            let id = format!("recent_notification_{}", notification.id);
            let label = if notification.title.len() > 20 {
                format!("{}...", &notification.title[..20])
            } else {
                notification.title.clone()
            };
            submenu = submenu.add_item(CustomMenuItem::new(id, label));
        }
        menu = menu.add_submenu(SystemTraySubmenu::new("最近通知", submenu))
            .add_native_item(tauri::SystemTrayMenuItem::Separator);
    }
    
    menu = menu
        .add_item(CustomMenuItem::new("暂停通知", "暂停通知"))
        .add_native_item(tauri::SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("退出", "退出"));
    
    menu
}

fn update_tray_menu(app: &AppHandle) {
    let state = app.state::<Arc<Mutex<AppState>>>().inner().clone();
    let state_lock = state.lock().unwrap();
    
    if let Some(tray) = app.tray_handle() {
        let _ = tray.set_menu(create_tray_menu(&state_lock.recent_notifications));
    }
}

#[tauri::command]
fn show_window(app: AppHandle) {
    if let Some(window) = app.get_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    if let Some(window) = app.get_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn get_recent_notifications(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> Vec<NotificationItem> {
    let state = state.inner().lock().unwrap();
    state.recent_notifications.iter().cloned().collect()
}

#[tauri::command]
fn toggle_notifications(state: tauri::State<'_, Arc<Mutex<AppState>>>) {
    let mut state = state.inner().lock().unwrap();
    state.notifications_paused = !state.notifications_paused;
    write_state(state.notifications_paused, &state.recent_notifications);
}

fn main() {
    let persistent_state = read_persistent_state();
    let notifications_paused = persistent_state.notifications_paused;
    let recent_notifications: VecDeque<NotificationItem> = persistent_state.recent_notifications.into_iter().collect();
    let state = Arc::new(Mutex::new(AppState {
        notifications_paused,
        recent_notifications: recent_notifications.clone(),
    }));

    let app = tauri::Builder::default()
        .manage(state)
        .setup(move |app| {
            let app_for_ipc = app.handle();
            let app_for_update = app.handle();
            
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    if let Some(content) = read_from_ipc_file() {
                        let content = content.trim();
                        if !content.is_empty() {
                            if let Ok(data) = serde_json::from_str::<serde_json::Value>(content) {
                                let title = data.get("title").and_then(|v| v.as_str()).unwrap_or("通知");
                                let body = data.get("body").and_then(|v| v.as_str()).unwrap_or("");
                                
                                send_notification(&app_for_ipc, title, body);
                            }
                            
                            write_to_ipc_file("");
                        }
                    }
                }
            });
            
            update_tray_menu(&app_for_update);

            Ok(())
        })
        .on_window_event(|event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
                api.prevent_close();
                event.window().hide().unwrap();
            }
        })
        .system_tray(SystemTray::new().with_menu(create_tray_menu(&recent_notifications)))
        .on_system_tray_event(|app, event| {
            let state = app.state::<Arc<Mutex<AppState>>>().inner().clone();

            match event {
                SystemTrayEvent::MenuItemClick { id, .. } => {
                    if id.starts_with("recent_notification_") {
                        let notification_id = id.trim_start_matches("recent_notification_").to_string();
                        let state_lock = state.lock().unwrap();
                        
                        if let Some(notification) = state_lock.recent_notifications.iter().find(|n| n.id == notification_id) {
                            if let Some(window) = app.get_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = window.emit("show-notification", notification.clone());
                            }
                        }
                    } else {
                        match id.as_str() {
                            "显示主窗口" => {
                                if let Some(window) = app.get_window("main") {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                            "暂停通知" => {
                                let mut state_lock = state.lock().unwrap();
                                state_lock.notifications_paused = !state_lock.notifications_paused;
                                write_state(state_lock.notifications_paused, &state_lock.recent_notifications);
                            }
                            "退出" => {
                                let _ = app.exit(0);
                            }
                            _ => {}
                        }
                    }
                }
                SystemTrayEvent::LeftClick { .. } => {
                    if let Some(window) = app.get_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![show_window, hide_window, toggle_notifications, get_recent_notifications])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    let cli_matches = app.get_cli_matches();
    
    if let Some(notify_arg) = cli_matches.args.get("notify") {
        let body = notify_arg.value.as_str().unwrap_or("");
        
        if check_single_instance() {
            let title = cli_matches
                .args
                .get("title")
                .and_then(|v| v.value.as_str())
                .unwrap_or("通知");
            
            let notification = serde_json::json!({
                "title": title,
                "body": body
            });
            
            let notification_str = serde_json::to_string(&notification).unwrap_or_else(|_| String::new());
            
            write_to_ipc_file(&notification_str);
            
            let _ = app.exit(0);
        } else {
            println!("应用未运行，无法发送通知");
            let _ = app.exit(1);
        }
    } else {
        create_ipc_file();
        app.run(|_app_handle, _event| {});
    }
}