use serde::Serialize;
use std::collections::HashMap;
use chrono::Utc;

#[derive(Debug, Serialize, Clone)]
pub struct CloneAlert {
    pub id: i64,
    pub uid: String,
    pub reader_ip1: String,
    pub reader_ip2: String,
    pub timestamp1: i64,
    pub timestamp2: i64,
    pub alert_time: i64,
    pub message: String,
}

pub struct AntiCloneDetector {
    recent_swipes: HashMap<String, Vec<(String, i64)>>,
    alerts: Vec<CloneAlert>,
    time_window_ms: i64,
    max_alerts: usize,
    alert_id_counter: i64,
}

impl AntiCloneDetector {
    pub fn new() -> Self {
        AntiCloneDetector {
            recent_swipes: HashMap::new(),
            alerts: Vec::new(),
            time_window_ms: 5000,
            max_alerts: 100,
            alert_id_counter: 0,
        }
    }

    pub fn check_clone(&mut self, uid: &str, reader_ip: &str, timestamp: i64) -> bool {
        self.cleanup_old_entries(timestamp);

        let swipes = self.recent_swipes
            .entry(uid.to_string())
            .or_insert_with(Vec::new);

        let mut clone_detected = false;
        
        for (existing_ip, existing_time) in swipes.iter() {
            if existing_ip != reader_ip {
                let time_diff = (timestamp - existing_time).abs();
                if time_diff <= self.time_window_ms {
                    clone_detected = true;
                    self.add_alert(
                        uid,
                        existing_ip,
                        reader_ip,
                        *existing_time,
                        timestamp,
                    );
                    break;
                }
            }
        }

        swipes.push((reader_ip.to_string(), timestamp));
        
        if swipes.len() > 10 {
            swipes.remove(0);
        }

        clone_detected
    }

    fn add_alert(
        &mut self,
        uid: &str,
        reader_ip1: &str,
        reader_ip2: &str,
        timestamp1: i64,
        timestamp2: i64,
    ) {
        self.alert_id_counter += 1;
        
        let alert = CloneAlert {
            id: self.alert_id_counter,
            uid: uid.to_string(),
            reader_ip1: reader_ip1.to_string(),
            reader_ip2: reader_ip2.to_string(),
            timestamp1,
            timestamp2,
            alert_time: Utc::now().timestamp_millis(),
            message: format!(
                "克隆检测告警：UID {} 在 {}ms 内同时出现在读卡器 {} 和 {}",
                uid,
                (timestamp2 - timestamp1).abs(),
                reader_ip1,
                reader_ip2
            ),
        };

        self.alerts.insert(0, alert);
        
        if self.alerts.len() > self.max_alerts {
            self.alerts.truncate(self.max_alerts);
        }
    }

    fn cleanup_old_entries(&mut self, current_time: i64) {
        for swipes in self.recent_swipes.values_mut() {
            swipes.retain(|&(_, time)| current_time - time <= self.time_window_ms);
        }
        
        self.recent_swipes.retain(|_, swipes| !swipes.is_empty());
    }
}

#[tauri::command]
pub fn get_alerts(state: tauri::State<'_, super::AppState>) -> Vec<CloneAlert> {
    if let Ok(detector) = state.detector.lock() {
        detector.alerts.clone()
    } else {
        Vec::new()
    }
}

#[tauri::command]
pub fn clear_alerts(state: tauri::State<'_, super::AppState>) -> bool {
    if let Ok(mut detector) = state.detector.lock() {
        detector.alerts.clear();
        true
    } else {
        false
    }
}
