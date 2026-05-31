use crate::encryption::verify_key;
use crate::anti_clone::AntiCloneDetector;
use crate::database::{Database, SwipeLog};
use chrono::Utc;
use serde::Serialize;
use tauri::State;
use std::sync::Mutex;

#[derive(Debug, Serialize, Clone)]
pub struct VerificationResult {
    pub success: bool,
    pub message: String,
    pub uid: String,
    pub reader_ip: String,
    pub timestamp: i64,
    pub counter: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct SwipeResult {
    pub verification: VerificationResult,
    pub anti_clone_alert: Option<String>,
    pub log_id: Option<i64>,
}

#[tauri::command]
pub fn verify_card(
    state: State<'_, super::AppState>,
    uid: String,
    key: String,
    master_secret: Option<String>,
    counter_tolerance: Option<i64>,
) -> VerificationResult {
    let secret = master_secret.unwrap_or_else(|| "nfc-access-control-secret-key-2024".to_string());
    let tolerance = counter_tolerance.unwrap_or(5);
    
    let current_counter = if let Ok(db) = state.db.lock() {
        db.get_counter(&uid).unwrap_or(0)
    } else {
        0
    };
    
    let verified_counter = verify_key(&uid, &key, &secret, current_counter, tolerance);
    
    VerificationResult {
        success: verified_counter.is_some(),
        message: if verified_counter.is_some() {
            format!("密钥验证成功，帧计数器: {}", verified_counter.unwrap())
        } else {
            format!("密钥验证失败，当前计数器: {}", current_counter)
        },
        uid: uid.clone(),
        reader_ip: "127.0.0.1".to_string(),
        timestamp: Utc::now().timestamp_millis(),
        counter: verified_counter,
    }
}

#[tauri::command]
pub fn simulate_swipe(
    state: State<'_, super::AppState>,
    uid: String,
    key: String,
    reader_ip: String,
) -> SwipeResult {
    let master_secret = "nfc-access-control-secret-key-2024".to_string();
    let counter_tolerance = 5;
    
    let current_counter = if let Ok(db) = state.db.lock() {
        db.get_counter(&uid).unwrap_or(0)
    } else {
        0
    };
    
    let verified_counter = verify_key(&uid, &key, &master_secret, current_counter, counter_tolerance);
    let is_valid = verified_counter.is_some();
    
    let timestamp = Utc::now().timestamp_millis();
    
    let mut new_counter = current_counter;
    if is_valid {
        if let Ok(mut db) = state.db.lock() {
            if let Ok(c) = db.increment_counter(&uid) {
                new_counter = c;
            }
        }
    }
    
    let mut anti_clone_alert = None;
    if let Ok(mut detector) = state.detector.lock() {
        if detector.check_clone(&uid, &reader_ip, timestamp) {
            anti_clone_alert = Some(format!("检测到卡片克隆风险！UID: {} 在不同读卡器同时出现", uid));
        }
    }
    
    let mut log_id = None;
    if let Ok(mut db) = state.db.lock() {
        let log = SwipeLog {
            id: None,
            uid: uid.clone(),
            reader_ip: reader_ip.clone(),
            success: is_valid,
            timestamp,
            anti_clone_detected: anti_clone_alert.is_some(),
        };
        
        if let Ok(id) = db.add_log(&log) {
            log_id = Some(id);
        }
    }
    
    SwipeResult {
        verification: VerificationResult {
            success: is_valid,
            message: if is_valid {
                format!("刷卡成功，帧计数器已递增至: {}", new_counter)
            } else {
                format!("刷卡失败：密钥无效，当前计数器: {}", current_counter)
            },
            uid: uid.clone(),
            reader_ip: reader_ip.clone(),
            timestamp,
            counter: verified_counter,
        },
        anti_clone_alert,
        log_id,
    }
}
