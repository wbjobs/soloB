use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginConfig {
    pub name: String,
    pub version: String,
    pub description: String,
    pub enabled: bool,
    pub settings: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginData {
    pub name: String,
    pub data: serde_json::Value,
    pub timestamp: i64,
}

pub fn get_plugins_dir() -> PathBuf {
    if let Some(config_dir) = dirs::config_dir() {
        let plugin_dir = config_dir.join("solo-ops-tool").join("plugins");
        if !plugin_dir.exists() {
            let _ = fs::create_dir_all(&plugin_dir);
        }
        plugin_dir
    } else {
        let plugin_dir = std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("plugins");
        if !plugin_dir.exists() {
            let _ = fs::create_dir_all(&plugin_dir);
        }
        plugin_dir
    }
}

pub fn load_plugin_configs() -> Result<Vec<PluginConfig>, String> {
    let plugins_dir = get_plugins_dir();
    let mut plugins = Vec::new();
    
    if !plugins_dir.exists() {
        return Ok(plugins);
    }
    
    let entries = fs::read_dir(&plugins_dir).map_err(|e| e.to_string())?;
    
    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "toml") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(config) = toml::from_str::<PluginConfig>(&content) {
                        plugins.push(config);
                    }
                }
            }
        }
    }
    
    Ok(plugins)
}

pub fn save_plugin_config(config: &PluginConfig) -> Result<(), String> {
    let plugins_dir = get_plugins_dir();
    let file_path = plugins_dir.join(format!("{}.toml", config.name));
    
    let content = toml::to_string(config).map_err(|e| e.to_string())?;
    fs::write(file_path, content).map_err(|e| e.to_string())?;
    
    Ok(())
}

pub fn delete_plugin_config(name: &str) -> Result<(), String> {
    let plugins_dir = get_plugins_dir();
    let file_path = plugins_dir.join(format!("{}.toml", name));
    
    if file_path.exists() {
        fs::remove_file(file_path).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

pub fn get_sample_plugin_configs() -> Vec<PluginConfig> {
    vec![
        PluginConfig {
            name: "gpu_monitor".to_string(),
            version: "0.1.0".to_string(),
            description: "GPU 使用率和温度监控".to_string(),
            enabled: true,
            settings: {
                let mut map = HashMap::new();
                map.insert("update_interval".to_string(), serde_json::json!(5));
                map.insert("include_temperature".to_string(), serde_json::json!(true));
                map
            },
        },
        PluginConfig {
            name: "process_monitor".to_string(),
            version: "0.1.0".to_string(),
            description: "进程资源占用监控".to_string(),
            enabled: true,
            settings: {
                let mut map = HashMap::new();
                map.insert("top_n".to_string(), serde_json::json!(10));
                map.insert("sort_by".to_string(), serde_json::json!("cpu"));
                map
            },
        },
        PluginConfig {
            name: "system_health".to_string(),
            version: "0.1.0".to_string(),
            description: "系统健康状态检查".to_string(),
            enabled: false,
            settings: {
                let mut map = HashMap::new();
                map.insert("alerts_enabled".to_string(), serde_json::json!(true));
                map.insert("cpu_threshold".to_string(), serde_json::json!(90));
                map.insert("memory_threshold".to_string(), serde_json::json!(85));
                map
            },
        },
    ]
}
