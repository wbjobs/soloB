#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use uuid::Uuid;

pub struct AppState {
    pub db: Mutex<Connection>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChangeLog {
    pub note_id: String,
    #[serde(default)]
    pub user_id: String,
    pub operation: String,
    pub timestamp: String,
    pub title: String,
    pub content: String,
}

fn init_db(db_path: PathBuf) -> Connection {
    let conn = Connection::open(db_path).expect("Failed to open database");

    conn.execute(
        "CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        )",
        [],
    )
    .expect("Failed to create notes table");

    conn.execute(
        "CREATE TABLE IF NOT EXISTS change_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            note_id TEXT NOT NULL,
            operation TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            title TEXT,
            content TEXT,
            synced INTEGER DEFAULT 0
        )",
        [],
    )
    .expect("Failed to create change_logs table");

    conn.execute(
        "CREATE TABLE IF NOT EXISTS sync_state (
            key TEXT PRIMARY KEY,
            value TEXT
        )",
        [],
    )
    .expect("Failed to create sync_state table");

    conn
}

#[tauri::command]
fn get_all_notes(state: tauri::State<AppState>) -> Result<Vec<Note>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare("SELECT id, title, content, updated_at, deleted_at FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;

    let notes_iter = stmt
        .query_map([], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                updated_at: row.get(3)?,
                deleted_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let notes: Result<Vec<Note>, _> = notes_iter.collect();
    notes.map_err(|e| e.to_string())
}

#[tauri::command]
fn create_note(state: tauri::State<AppState>, title: String, content: String) -> Result<Note, String> {
    println!("Creating note: title='{}'", title);
    
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    let note = Note {
        id: id.clone(),
        title: title.clone(),
        content: content.clone(),
        updated_at: now.clone(),
        deleted_at: None,
    };

    match conn.execute(
        "INSERT INTO notes (id, title, content, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, NULL)",
        params![id, title, content, now],
    ) {
        Ok(rows) => println!("Inserted {} row(s) into notes", rows),
        Err(e) => {
            eprintln!("Failed to insert into notes: {}", e);
            return Err(format!("Insert notes failed: {}", e));
        }
    }

    match conn.execute(
        "INSERT INTO change_logs (note_id, operation, timestamp, title, content, synced) VALUES (?1, 'create', ?2, ?3, ?4, 0)",
        params![id, now, title, content],
    ) {
        Ok(rows) => println!("Inserted {} row(s) into change_logs", rows),
        Err(e) => {
            eprintln!("Failed to insert into change_logs: {}", e);
            return Err(format!("Insert change_logs failed: {}", e));
        }
    }

    println!("Note created successfully: {}", id);
    Ok(note)
}

#[tauri::command]
fn update_note(
    state: tauri::State<AppState>,
    id: String,
    title: String,
    content: String,
) -> Result<Note, String> {
    println!("Updating note: id='{}'", id);
    
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let now = Utc::now().to_rfc3339();

    match conn.execute(
        "UPDATE notes SET title = ?1, content = ?2, updated_at = ?3 WHERE id = ?4",
        params![title, content, now, id],
    ) {
        Ok(rows) => println!("Updated {} row(s) in notes", rows),
        Err(e) => {
            eprintln!("Failed to update notes: {}", e);
            return Err(format!("Update notes failed: {}", e));
        }
    }

    match conn.execute(
        "INSERT INTO change_logs (note_id, operation, timestamp, title, content, synced) VALUES (?1, 'update', ?2, ?3, ?4, 0)",
        params![id, now, title, content],
    ) {
        Ok(rows) => println!("Inserted {} row(s) into change_logs", rows),
        Err(e) => {
            eprintln!("Failed to insert into change_logs: {}", e);
            return Err(format!("Insert change_logs failed: {}", e));
        }
    }

    println!("Note updated successfully: {}", id);
    Ok(Note {
        id,
        title,
        content,
        updated_at: now,
        deleted_at: None,
    })
}

#[tauri::command]
fn delete_note(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    println!("Deleting note: id='{}'", id);
    
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let now = Utc::now().to_rfc3339();

    match conn.execute(
        "UPDATE notes SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    ) {
        Ok(rows) => println!("Marked {} row(s) as deleted", rows),
        Err(e) => {
            eprintln!("Failed to update notes: {}", e);
            return Err(format!("Update notes failed: {}", e));
        }
    }

    match conn.execute(
        "INSERT INTO change_logs (note_id, operation, timestamp, title, content, synced) VALUES (?1, 'delete', ?2, '', '', 0)",
        params![id, now],
    ) {
        Ok(rows) => println!("Inserted {} row(s) into change_logs", rows),
        Err(e) => {
            eprintln!("Failed to insert into change_logs: {}", e);
            return Err(format!("Insert change_logs failed: {}", e));
        }
    }

    println!("Note deleted successfully: {}", id);
    Ok(())
}

#[tauri::command]
fn get_unsynced_changes(state: tauri::State<AppState>) -> Result<Vec<ChangeLog>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT note_id, operation, timestamp, title, content FROM change_logs WHERE synced = 0 ORDER BY timestamp ASC")
        .map_err(|e| e.to_string())?;

    let logs_iter = stmt
        .query_map([], |row| {
            Ok(ChangeLog {
                note_id: row.get(0)?,
                operation: row.get(1)?,
                timestamp: row.get(2)?,
                title: row.get(3)?,
                content: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let logs: Result<Vec<ChangeLog>, _> = logs_iter.collect();
    logs.map_err(|e| e.to_string())
}

#[tauri::command]
fn mark_changes_synced(state: tauri::State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE change_logs SET synced = 1 WHERE synced = 0", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn apply_server_changes(
    state: tauri::State<AppState>,
    changes: Vec<ChangeLog>,
) -> Result<(), String> {
    println!("Applying {} server changes", changes.len());
    
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;

    for (i, change) in changes.iter().enumerate() {
        println!("Processing server change {}: note_id={}, op={}", i, change.note_id, change.operation);

        let server_time: DateTime<Utc> = match change.timestamp.parse() {
            Ok(t) => t,
            Err(e) => {
                eprintln!("Failed to parse server timestamp '{}': {}", change.timestamp, e);
                continue;
            }
        };

        let current_updated: Result<Option<String>, _> = conn
            .query_row(
                "SELECT updated_at FROM notes WHERE id = ?1",
                params![change.note_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string());

        let should_apply = match current_updated {
            Ok(Some(ts)) => {
                let client_time: DateTime<Utc> = match ts.parse() {
                    Ok(t) => t,
                    Err(e) => {
                        eprintln!("Failed to parse client timestamp '{}': {}", ts, e);
                        false
                    }
                };
                let apply = server_time > client_time;
                println!("Note {} exists - server_ts={:?}, client_ts={:?}, should_apply={}", 
                    change.note_id, server_time, client_time, apply);
                apply
            }
            Ok(None) => {
                println!("Note {} does not exist locally, will apply server change", change.note_id);
                true
            }
            Err(e) => {
                eprintln!("Error querying note {}: {}", change.note_id, e);
                continue;
            }
        };

        if !should_apply {
            println!("Skipping change for note {} - local version is newer", change.note_id);
            continue;
        }

        match change.operation.as_str() {
            "create" => {
                match conn.execute(
                    "INSERT OR REPLACE INTO notes (id, title, content, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, NULL)",
                    params![change.note_id, change.title, change.content, change.timestamp],
                ) {
                    Ok(rows) => println!("Inserted {} row(s) for note {}", rows, change.note_id),
                    Err(e) => {
                        eprintln!("Failed to insert note {}: {}", change.note_id, e);
                        continue;
                    }
                }
            }
            "update" => {
                match conn.execute(
                    "UPDATE notes SET title = ?1, content = ?2, updated_at = ?3 WHERE id = ?4",
                    params![change.title, change.content, change.timestamp, change.note_id],
                ) {
                    Ok(rows) => println!("Updated {} row(s) for note {}", rows, change.note_id),
                    Err(e) => {
                        eprintln!("Failed to update note {}: {}", change.note_id, e);
                        continue;
                    }
                }
            }
            "delete" => {
                match conn.execute(
                    "UPDATE notes SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
                    params![change.timestamp, change.note_id],
                ) {
                    Ok(rows) => println!("Marked {} row(s) as deleted for note {}", rows, change.note_id),
                    Err(e) => {
                        eprintln!("Failed to delete note {}: {}", change.note_id, e);
                        continue;
                    }
                }
            }
            op => {
                println!("Unknown operation: {}", op);
            }
        }
    }

    println!("All server changes processed");
    Ok(())
}

#[tauri::command]
fn get_last_sync(state: tauri::State<AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let result: Result<Option<String>, _> = conn
        .query_row(
            "SELECT value FROM sync_state WHERE key = 'last_sync'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string());

    match result {
        Ok(Some(ts)) => Ok(ts),
        Ok(None) => Ok(Utc::now().to_rfc3339()),
        Err(e) => Err(e),
    }
}

#[tauri::command]
fn set_last_sync(state: tauri::State<AppState>, timestamp: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_sync', ?1)",
        params![timestamp],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_user_id() -> Result<String, String> {
    Ok("local-user".to_string())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path_resolver()
                .app_data_dir()
                .expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data dir");
            let db_path = app_data_dir.join("notes.db");
            let conn = init_db(db_path);

            app.manage(AppState {
                db: Mutex::new(conn),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_all_notes,
            create_note,
            update_note,
            delete_note,
            get_unsynced_changes,
            mark_changes_synced,
            apply_server_changes,
            get_last_sync,
            set_last_sync,
            get_user_id,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
