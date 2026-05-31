use crate::types::HardwareAcceleration;
use serde::{Deserialize, Serialize};
use std::process::Command;
use sysinfo::{System, SystemExt};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareDetectionResult {
    pub available: Vec<HardwareAcceleration>,
    pub recommended: HardwareAcceleration,
    pub gpu_info: Vec<GpuInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub name: String,
    pub vendor: String,
    pub memory: Option<u64>,
}

fn check_nvenc_available() -> bool {
    let output = Command::new("ffmpeg")
        .args(&["-hide_banner", "-encoders"])
        .output();

    if let Ok(output) = output {
        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout.contains("hevc_nvenc")
    } else {
        false
    }
}

fn check_qsv_available() -> bool {
    let output = Command::new("ffmpeg")
        .args(&["-hide_banner", "-encoders"])
        .output();

    if let Ok(output) = output {
        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout.contains("hevc_qsv")
    } else {
        false
    }
}

fn check_amf_available() -> bool {
    let output = Command::new("ffmpeg")
        .args(&["-hide_banner", "-encoders"])
        .output();

    if let Ok(output) = output {
        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout.contains("hevc_amf")
    } else {
        false
    }
}

fn get_gpu_info() -> Vec<GpuInfo> {
    let mut gpus = Vec::new();
    let mut sys = System::new_all();
    sys.refresh_all();

    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = Command::new("wmic")
            .args(&["path", "win32_VideoController", "get", "name,AdapterRAM"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines().skip(1) {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    let memory = parts.last().and_then(|m| m.parse::<u64>().ok());
                    let name = parts[..parts.len() - 1].join(" ");
                    if !name.is_empty() {
                        gpus.push(GpuInfo {
                            name,
                            vendor: "Unknown".to_string(),
                            memory,
                        });
                    }
                }
            }
        }
    }

    gpus
}

#[tauri::command]
pub async fn detect_hardware_acceleration() -> HardwareDetectionResult {
    let mut available = vec![HardwareAcceleration::None];
    let gpu_info = get_gpu_info();

    if check_nvenc_available() {
        available.push(HardwareAcceleration::Nvenc);
    }

    if check_qsv_available() {
        available.push(HardwareAcceleration::Qsv);
    }

    if check_amf_available() {
        available.push(HardwareAcceleration::Amf);
    }

    let recommended = if available.contains(&HardwareAcceleration::Nvenc) {
        HardwareAcceleration::Nvenc
    } else if available.contains(&HardwareAcceleration::Qsv) {
        HardwareAcceleration::Qsv
    } else if available.contains(&HardwareAcceleration::Amf) {
        HardwareAcceleration::Amf
    } else {
        HardwareAcceleration::None
    };

    HardwareDetectionResult {
        available,
        recommended,
        gpu_info,
    }
}
