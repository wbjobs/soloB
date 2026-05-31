use crate::encryption::generate_key_with_counter;
use crate::anti_clone::AntiCloneDetector;
use crate::database::Database;
use chrono::Utc;
use serde::{Serialize, Deserialize};
use std::sync::Mutex;

#[derive(Debug, Serialize, Clone)]
pub struct AttackStep {
    pub step_id: i32,
    pub description: String,
    pub reader_ip: String,
    pub timestamp: i64,
    pub success: bool,
    pub anti_clone_triggered: bool,
    pub details: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct AttackReport {
    pub attack_id: String,
    pub attack_name: String,
    pub attack_type: String,
    pub target_uid: String,
    pub start_time: i64,
    pub end_time: i64,
    pub steps: Vec<AttackStep>,
    pub total_steps: i32,
    pub successful_steps: i32,
    pub anti_clone_alerts: i32,
    pub detection_rate: f64,
    pub conclusion: String,
    pub recommendations: Vec<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct AttackConfig {
    pub attack_name: String,
    pub attack_type: String,
    pub target_uid: String,
    pub counter: i64,
    pub master_secret: String,
    pub reader_ips: Vec<String>,
    pub time_window_ms: i64,
    pub num_attempts: i32,
}

lazy_static::lazy_static! {
    static ref CURRENT_ATTACK: Mutex<Option<AttackReport>> = Mutex::new(None);
    static ref ATTACK_HISTORY: Mutex<Vec<AttackReport>> = Mutex::new(Vec::new());
}

pub fn generate_attack_id() -> String {
    format!("ATTACK-{:08X}", Utc::now().timestamp_millis() as u64)
}

pub fn create_attack_report(config: &AttackConfig) -> AttackReport {
    AttackReport {
        attack_id: generate_attack_id(),
        attack_name: config.attack_name.clone(),
        attack_type: config.attack_type.clone(),
        target_uid: config.target_uid.clone(),
        start_time: Utc::now().timestamp_millis(),
        end_time: 0,
        steps: Vec::new(),
        total_steps: 0,
        successful_steps: 0,
        anti_clone_alerts: 0,
        detection_rate: 0.0,
        conclusion: String::new(),
        recommendations: Vec::new(),
    }
}

pub fn add_attack_step(
    report: &mut AttackReport,
    step_id: i32,
    description: String,
    reader_ip: String,
    success: bool,
    anti_clone_triggered: bool,
    details: String,
) {
    let step = AttackStep {
        step_id,
        description,
        reader_ip,
        timestamp: Utc::now().timestamp_millis(),
        success,
        anti_clone_triggered,
        details,
    };
    
    report.steps.push(step);
    report.total_steps += 1;
    if success {
        report.successful_steps += 1;
    }
    if anti_clone_triggered {
        report.anti_clone_alerts += 1;
    }
}

pub fn finalize_attack_report(report: &mut AttackReport) {
    report.end_time = Utc::now().timestamp_millis();
    
    if report.total_steps > 0 {
        report.detection_rate = (report.anti_clone_alerts as f64) / (report.total_steps as f64) * 100.0;
    }
    
    if report.detection_rate >= 100.0 {
        report.conclusion = "防克隆系统工作正常，所有克隆攻击均被成功检测".to_string();
    } else if report.detection_rate >= 80.0 {
        report.conclusion = "防克隆系统基本正常，大部分克隆攻击被检测".to_string();
    } else if report.detection_rate >= 50.0 {
        report.conclusion = "防克隆系统存在部分漏洞，部分克隆攻击未被检测".to_string();
    } else {
        report.conclusion = "防克隆系统存在严重漏洞，大部分克隆攻击未被检测".to_string();
    }
    
    report.recommendations = vec![
        "建议定期进行克隆攻击测试，确保防克隆系统持续有效".to_string(),
        "建议缩短检测时间窗口，提高检测灵敏度".to_string(),
        "建议增加读卡器之间的通信同步机制".to_string(),
        "建议使用多因素认证，不依赖单一的UID验证".to_string(),
    ];
}

#[tauri::command]
pub fn simulate_clone_attack(
    state: tauri::State<'_, super::AppState>,
    config: AttackConfig,
) -> Result<AttackReport, String> {
    let mut report = create_attack_report(&config);
    
    let key = generate_key_with_counter(&config.target_uid, config.counter, &config.master_secret);
    
    let mut step_id = 1;
    
    for attempt in 0..config.num_attempts {
        for (i, reader_ip) in config.reader_ips.iter().enumerate() {
            let description = format!(
                "第{}轮攻击 - 读卡器{} ({})",
                attempt + 1,
                i + 1,
                reader_ip
            );
            
            let mut anti_clone_triggered = false;
            let mut success = true;
            let mut details = String::new();
            
            if let Ok(mut detector) = state.detector.lock() {
                anti_clone_triggered = detector.check_clone(
                    &config.target_uid,
                    reader_ip,
                    Utc::now().timestamp_millis(),
                );
            }
            
            if let Ok(mut db) = state.db.lock() {
                let swipe_log = crate::database::SwipeLog {
                    id: None,
                    uid: config.target_uid.clone(),
                    reader_ip: reader_ip.clone(),
                    success: true,
                    timestamp: Utc::now().timestamp_millis(),
                    anti_clone_detected: anti_clone_triggered,
                };
                
                let _ = db.add_log(&swipe_log);
            }
            
            if anti_clone_triggered {
                details = format!("检测到克隆攻击！UID {} 在时间窗口内出现在多个读卡器", config.target_uid);
            } else {
                details = "刷卡成功，未检测到克隆".to_string();
            }
            
            add_attack_step(
                &mut report,
                step_id,
                description,
                reader_ip.clone(),
                success,
                anti_clone_triggered,
                details,
            );
            
            step_id += 1;
        }
    }
    
    finalize_attack_report(&mut report);
    
    if let Ok(mut history) = ATTACK_HISTORY.lock() {
        history.push(report.clone());
    }
    
    if let Ok(mut current) = CURRENT_ATTACK.lock() {
        *current = Some(report.clone());
    }
    
    Ok(report)
}

#[tauri::command]
pub fn get_attack_history() -> Vec<AttackReport> {
    if let Ok(history) = ATTACK_HISTORY.lock() {
        history.clone()
    } else {
        Vec::new()
    }
}

#[tauri::command]
pub fn get_current_attack() -> Option<AttackReport> {
    if let Ok(current) = CURRENT_ATTACK.lock() {
        current.clone()
    } else {
        None
    }
}

#[tauri::command]
pub fn clear_attack_history() -> bool {
    if let Ok(mut history) = ATTACK_HISTORY.lock() {
        history.clear();
        true
    } else {
        false
    }
}

#[tauri::command]
pub fn export_attack_report(attack_id: String) -> Result<String, String> {
    if let Ok(history) = ATTACK_HISTORY.lock() {
        if let Some(report) = history.iter().find(|r| r.attack_id == attack_id) {
            let mut markdown = format!("# 克隆攻击测试报告\n\n");
            markdown.push_str(&format!("**报告ID**: {}\n\n", report.attack_id));
            markdown.push_str(&format!("**攻击名称**: {}\n\n", report.attack_name));
            markdown.push_str(&format!("**攻击类型**: {}\n\n", report.attack_type));
            markdown.push_str(&format!("**目标UID**: {}\n\n", report.target_uid));
            
            let start_date = chrono::NaiveDateTime::from_timestamp_millis(report.start_time)
                .unwrap_or_default()
                .format("%Y-%m-%d %H:%M:%S%.3f");
            let end_date = chrono::NaiveDateTime::from_timestamp_millis(report.end_time)
                .unwrap_or_default()
                .format("%Y-%m-%d %H:%M:%S%.3f");
            
            markdown.push_str(&format!("**开始时间**: {}\n\n", start_date));
            markdown.push_str(&format!("**结束时间**: {}\n\n", end_date));
            markdown.push_str(&format!("**持续时间**: {} ms\n\n", report.end_time - report.start_time));
            
            markdown.push_str("## 测试结果汇总\n\n");
            markdown.push_str(&format!("- **总测试步数**: {}\n", report.total_steps));
            markdown.push_str(&format!("- **成功步数**: {}\n", report.successful_steps));
            markdown.push_str(&format!("- **检测到克隆告警**: {}\n", report.anti_clone_alerts));
            markdown.push_str(&format!("- **检测率**: {:.2}%\n\n", report.detection_rate));
            
            markdown.push_str("## 测试结论\n\n");
            markdown.push_str(&format!("{}\n\n", report.conclusion));
            
            markdown.push_str("## 详细步骤\n\n");
            markdown.push_str("| 步骤 | 读卡器 | 时间 | 克隆检测 | 详情 |\n");
            markdown.push_str("|------|--------|------|----------|------|\n");
            
            for step in &report.steps {
                let step_time = chrono::NaiveDateTime::from_timestamp_millis(step.timestamp)
                    .unwrap_or_default()
                    .format("%H:%M:%S%.3f");
                let detected = if step.anti_clone_triggered { "✅ 是" } else { "❌ 否" };
                markdown.push_str(&format!(
                    "| {} | {} | {} | {} | {} |\n",
                    step.step_id,
                    step.reader_ip,
                    step_time,
                    detected,
                    step.details
                ));
            }
            
            markdown.push_str("\n## 建议\n\n");
            for (i, rec) in report.recommendations.iter().enumerate() {
                markdown.push_str(&format!("{}. {}\n", i + 1, rec));
            }
            
            return Ok(markdown);
        }
    }
    
    Err("未找到指定的攻击报告".to_string())
}
