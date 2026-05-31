use rusqlite::{params, Connection, Result};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Serialize, Clone)]
pub struct SwipeLog {
    pub id: Option<i64>,
    pub uid: String,
    pub reader_ip: String,
    pub success: bool,
    pub timestamp: i64,
    pub anti_clone_detected: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct CardCounter {
    pub uid: String,
    pub counter: i64,
    pub last_updated: i64,
}

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new() -> Result<Self> {
        let mut path = Self::get_db_path();
        std::fs::create_dir_all(&path).ok();
        path.push("nfc_access.db");
        
        let conn = Connection::open(path)?;
        
        conn.execute(
            "CREATE TABLE IF NOT EXISTS swipe_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uid TEXT NOT NULL,
                reader_ip TEXT NOT NULL,
                success INTEGER NOT NULL,
                timestamp INTEGER NOT NULL,
                anti_clone_detected INTEGER NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS card_counters (
                uid TEXT PRIMARY KEY,
                counter INTEGER NOT NULL DEFAULT 0,
                last_updated INTEGER NOT NULL
            )",
            [],
        )?;

        Ok(Database { conn })
    }

    fn get_db_path() -> PathBuf {
        if let Ok(home) = std::env::var("HOME") {
            PathBuf::from(home).join(".nfc-access")
        } else if let Ok(appdata) = std::env::var("APPDATA") {
            PathBuf::from(appdata).join("NFC Access System")
        } else {
            PathBuf::from(".")
        }
    }

    pub fn add_log(&mut self, log: &SwipeLog) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO swipe_logs (uid, reader_ip, success, timestamp, anti_clone_detected)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                log.uid,
                log.reader_ip,
                log.success,
                log.timestamp,
                log.anti_clone_detected,
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn get_logs(&self, limit: i64) -> Result<Vec<SwipeLog>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, uid, reader_ip, success, timestamp, anti_clone_detected
             FROM swipe_logs
             ORDER BY timestamp DESC
             LIMIT ?1",
        )?;

        let logs = stmt.query_map(params![limit], |row| {
            Ok(SwipeLog {
                id: Some(row.get(0)?),
                uid: row.get(1)?,
                reader_ip: row.get(2)?,
                success: row.get::<_, i64>(3)? != 0,
                timestamp: row.get(4)?,
                anti_clone_detected: row.get::<_, i64>(5)? != 0,
            })
        })?;

        logs.collect()
    }

    pub fn clear_all_logs(&mut self) -> Result<usize> {
        let affected = self.conn.execute("DELETE FROM swipe_logs", [])?;
        Ok(affected)
    }

    pub fn get_counter(&self, uid: &str) -> Result<i64> {
        let result: Result<i64, _> = self.conn.query_row(
            "SELECT counter FROM card_counters WHERE uid = ?1",
            params![uid],
            |row| row.get(0),
        );
        
        match result {
            Ok(counter) => Ok(counter),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(0),
            Err(e) => Err(e),
        }
    }

    pub fn increment_counter(&mut self, uid: &str) -> Result<i64> {
        use chrono::Utc;
        let now = Utc::now().timestamp_millis();
        
        self.conn.execute(
            "INSERT OR REPLACE INTO card_counters (uid, counter, last_updated)
             VALUES (?1, COALESCE((SELECT counter FROM card_counters WHERE uid = ?1), 0) + 1, ?2)",
            params![uid, now],
        )?;
        
        self.get_counter(uid)
    }

    pub fn reset_counter(&mut self, uid: &str) -> Result<()> {
        use chrono::Utc;
        let now = Utc::now().timestamp_millis();
        
        self.conn.execute(
            "INSERT OR REPLACE INTO card_counters (uid, counter, last_updated)
             VALUES (?1, 0, ?2)",
            params![uid, now],
        )?;
        
        Ok(())
    }

    pub fn clear_all_counters(&mut self) -> Result<usize> {
        let affected = self.conn.execute("DELETE FROM card_counters", [])?;
        Ok(affected)
    }
}

#[tauri::command]
pub fn get_swipe_logs(
    state: tauri::State<'_, super::AppState>,
    limit: Option<i64>,
) -> Result<Vec<SwipeLog>, String> {
    let limit = limit.unwrap_or(100);
    if let Ok(db) = state.db.lock() {
        db.get_logs(limit).map_err(|e| e.to_string())
    } else {
        Err("无法访问数据库".to_string())
    }
}

#[tauri::command]
pub fn clear_logs(state: tauri::State<'_, super::AppState>) -> Result<usize, String> {
    if let Ok(mut db) = state.db.lock() {
        db.clear_all_logs().map_err(|e| e.to_string())
    } else {
        Err("无法访问数据库".to_string())
    }
}

#[tauri::command]
pub fn get_counter(
    state: tauri::State<'_, super::AppState>,
    uid: String,
) -> Result<i64, String> {
    if let Ok(db) = state.db.lock() {
        db.get_counter(&uid).map_err(|e| e.to_string())
    } else {
        Err("无法访问数据库".to_string())
    }
}

#[tauri::command]
pub fn reset_counter(
    state: tauri::State<'_, super::AppState>,
    uid: String,
) -> Result<(), String> {
    if let Ok(mut db) = state.db.lock() {
        db.reset_counter(&uid).map_err(|e| e.to_string())
    } else {
        Err("无法访问数据库".to_string())
    }
}

#[tauri::command]
pub fn clear_all_counters(state: tauri::State<'_, super::AppState>) -> Result<usize, String> {
    if let Ok(mut db) = state.db.lock() {
        db.clear_all_counters().map_err(|e| e.to_string())
    } else {
        Err("无法访问数据库".to_string())
    }
}
