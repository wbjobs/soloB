use hmac::{Hmac, Mac};
use sha2::Sha256;
use serde::Serialize;
use std::sync::Mutex;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Serialize, Clone)]
pub struct DynamicKey {
    pub key: String,
    pub counter: i64,
    pub uid: String,
}

lazy_static::lazy_static! {
    static ref CURRENT_KEY: Mutex<Option<DynamicKey>> = Mutex::new(None);
}

pub fn generate_key_with_counter(uid: &str, counter: i64, master_secret: &str) -> String {
    let message = format!("{}:{}", uid, counter);
    
    let mut mac = HmacSha256::new_from_slice(master_secret.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(message.as_bytes());
    
    let result = mac.finalize();
    hex::encode_upper(result.into_bytes())
}

#[tauri::command]
pub fn generate_dynamic_key(
    state: tauri::State<'_, super::AppState>,
    uid: String,
    master_secret: Option<String>,
) -> Result<DynamicKey, String> {
    let secret = master_secret.unwrap_or_else(|| "nfc-access-control-secret-key-2024".to_string());
    
    let counter = if let Ok(db) = state.db.lock() {
        db.get_counter(&uid).map_err(|e| e.to_string())?
    } else {
        return Err("无法访问数据库".to_string());
    };
    
    let key = generate_key_with_counter(&uid, counter, &secret);
    
    let dynamic_key = DynamicKey {
        key: key.clone(),
        counter,
        uid: uid.clone(),
    };
    
    if let Ok(mut current) = CURRENT_KEY.lock() {
        *current = Some(dynamic_key.clone());
    }
    
    Ok(dynamic_key)
}

#[tauri::command]
pub fn get_current_key() -> Option<DynamicKey> {
    if let Ok(current) = CURRENT_KEY.lock() {
        current.clone()
    } else {
        None
    }
}

pub fn verify_key(uid: &str, key: &str, master_secret: &str, counter: i64, counter_tolerance: i64) -> Option<i64> {
    for offset in 0..=counter_tolerance {
        let test_counter = counter - offset;
        if test_counter < 0 {
            continue;
        }
        
        let expected_key = generate_key_with_counter(uid, test_counter, master_secret);
        if expected_key == key {
            return Some(test_counter);
        }
    }
    
    None
}
