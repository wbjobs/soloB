#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod monitor;
mod plugin;
mod shell;

use std::sync::Arc;
use tauri::Manager;

use monitor::{collect_process_tree, get_cached_metrics, kill_process, MonitorState, ProcessTreeNode, SystemMetrics};
use plugin::{get_sample_plugin_configs, load_plugin_configs, save_plugin_config, PluginConfig};
use shell::{execute_shell_command_async, execute_shell_command_sync, ShellManager, ShellOutput};

#[tauri::command]
fn get_system_metrics(state: tauri::State<'_, Arc<MonitorState>>) -> SystemMetrics {
    get_cached_metrics(&state)
}

#[tauri::command]
fn execute_command(command: String) -> ShellOutput {
    execute_shell_command_sync(&command)
}

#[tauri::command]
async fn execute_command_stream(
    app: tauri::AppHandle,
    command: String,
    session_id: String,
) -> Result<(), String> {
    execute_shell_command_async(app, command, session_id).await;
    Ok(())
}

#[tauri::command]
fn get_plugins() -> Result<Vec<PluginConfig>, String> {
    match load_plugin_configs() {
        Ok(plugins) if !plugins.is_empty() => Ok(plugins),
        _ => Ok(get_sample_plugin_configs()),
    }
}

#[tauri::command]
fn save_plugin(config: PluginConfig) -> Result<(), String> {
    save_plugin_config(&config)
}

#[tauri::command]
fn delete_plugin(name: String) -> Result<(), String> {
    plugin::delete_plugin_config(&name)
}

#[tauri::command]
fn get_plugins_directory() -> String {
    plugin::get_plugins_dir().to_string_lossy().to_string()
}

#[tauri::command]
fn get_process_tree(state: tauri::State<'_, Arc<MonitorState>>) -> Result<Vec<ProcessTreeNode>, String> {
    collect_process_tree(&state).ok_or_else(|| "无法获取进程列表".to_string())
}

#[tauri::command]
fn terminate_process(pid: u32) -> Result<(), String> {
    kill_process(pid)
}

fn main() {
    let monitor_state = Arc::new(MonitorState::new());
    let shell_manager = Arc::new(ShellManager::new());
    
    let monitor_state_clone = Arc::clone(&monitor_state);
    
    tauri::Builder::default()
        .manage(monitor_state)
        .manage(shell_manager)
        .setup(|app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                monitor::start_monitoring(app_handle, monitor_state_clone).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_system_metrics,
            execute_command,
            execute_command_stream,
            get_plugins,
            save_plugin,
            delete_plugin,
            get_plugins_directory,
            get_process_tree,
            terminate_process
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
