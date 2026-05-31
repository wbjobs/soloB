use sqlx::{SqlitePool, migrate::MigrateDatabase};
use tauri::{AppHandle, Manager};
use crate::models::{Note, NoteHistory};

pub async fn init_db(app: &AppHandle) -> SqlitePool {
    let app_dir = app.path_resolver().app_data_dir().expect("Failed to get app data dir");
    std::fs::create_dir_all(&app_dir).expect("Failed to create app data dir");
    
    let db_path = app_dir.join("notes.db");
    let db_url = format!("sqlite:{}", db_path.to_string_lossy());
    
    if !sqlx::Sqlite::database_exists(&db_url).await.unwrap_or(false) {
        sqlx::Sqlite::create_database(&db_url).await.expect("Failed to create database");
    }
    
    let pool = SqlitePool::connect(&db_url).await.expect("Failed to connect to database");
    
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        "#,
    )
    .execute(&pool)
    .await
    .expect("Failed to create table");

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS note_history (
            id TEXT PRIMARY KEY,
            note_id TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            version_at TEXT NOT NULL,
            version_number INTEGER NOT NULL,
            FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(&pool)
    .await
    .expect("Failed to create note_history table");

    sqlx::query(
        r#"CREATE INDEX IF NOT EXISTS idx_note_history_note_id ON note_history(note_id)"#,
    )
    .execute(&pool)
    .await
    .expect("Failed to create index");
    
    pool
}

pub async fn create_note(pool: &SqlitePool, title: String, content: String) -> Result<Note, sqlx::Error> {
    let note = Note::new(title, content);
    
    sqlx::query(
        r#"
        INSERT INTO notes (id, title, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        "#,
    )
    .bind(&note.id)
    .bind(&note.title)
    .bind(&note.content)
    .bind(&note.created_at)
    .bind(&note.updated_at)
    .execute(pool)
    .await?;
    
    Ok(note)
}

pub async fn add_to_history(pool: &SqlitePool, note: &Note) -> Result<(), sqlx::Error> {
    let history_id = uuid::Uuid::new_v4().to_string();
    let version_at = chrono::Utc::now().to_rfc3339();
    
    let max_version = sqlx::query!(
        r#"SELECT COALESCE(MAX(version_number), 0) as max_version FROM note_history WHERE note_id = ?"#,
        note.id
    )
    .fetch_one(pool)
    .await?
    .max_version;
    
    let version_number = max_version.map(|v| v + 1).unwrap_or(1);
    
    sqlx::query(
        r#"
        INSERT INTO note_history (id, note_id, title, content, version_at, version_number)
        VALUES (?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&history_id)
    .bind(&note.id)
    .bind(&note.title)
    .bind(&note.content)
    .bind(&version_at)
    .bind(version_number)
    .execute(pool)
    .await?;
    
    Ok(())
}

pub async fn update_note(
    pool: &SqlitePool,
    id: &str,
    title: String,
    content: String,
    record_history: bool,
) -> Result<Note, sqlx::Error> {
    if record_history {
        if let Some(old_note) = get_note(pool, id).await? {
            add_to_history(pool, &old_note).await?;
        }
    }

    let updated_at = chrono::Utc::now().to_rfc3339();
    
    sqlx::query(
        r#"
        UPDATE notes
        SET title = ?, content = ?, updated_at = ?
        WHERE id = ?
        "#,
    )
    .bind(&title)
    .bind(&content)
    .bind(&updated_at)
    .bind(id)
    .execute(pool)
    .await?;
    
    get_note(pool, id).await
        .map(|opt| opt.expect("Note not found after update"))
}

pub async fn get_note_history(pool: &SqlitePool, note_id: &str) -> Result<Vec<NoteHistory>, sqlx::Error> {
    let history = sqlx::query_as!(
        NoteHistory,
        r#"
        SELECT id, note_id, title, content, version_at, version_number
        FROM note_history
        WHERE note_id = ?
        ORDER BY version_number DESC
        "#,
        note_id
    )
    .fetch_all(pool)
    .await?;
    
    Ok(history)
}

pub async fn rollback_to_history(
    pool: &SqlitePool,
    history_id: &str,
) -> Result<Note, sqlx::Error> {
    let history = sqlx::query_as!(
        NoteHistory,
        r#"
        SELECT id, note_id, title, content, version_at, version_number
        FROM note_history
        WHERE id = ?
        "#,
        history_id
    )
    .fetch_one(pool)
    .await?;

    update_note(
        pool,
        &history.note_id,
        history.title,
        history.content,
        true,
    )
    .await
}

pub async fn get_all_notes(pool: &SqlitePool) -> Result<Vec<Note>, sqlx::Error> {
    let notes = sqlx::query_as!(
        Note,
        r#"
        SELECT id, title, content, created_at, updated_at
        FROM notes
        ORDER BY updated_at DESC
        "#
    )
    .fetch_all(pool)
    .await?;
    
    Ok(notes)
}

pub async fn get_note(pool: &SqlitePool, id: &str) -> Result<Option<Note>, sqlx::Error> {
    let note = sqlx::query_as!(
        Note,
        r#"
        SELECT id, title, content, created_at, updated_at
        FROM notes
        WHERE id = ?
        "#,
        id
    )
    .fetch_optional(pool)
    .await?;
    
    Ok(note)
}

pub async fn delete_note(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        DELETE FROM notes
        WHERE id = ?
        "#,
    )
    .bind(id)
    .execute(pool)
    .await?;
    
    Ok(())
}

pub async fn note_exists(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        SELECT 1 as exists_flag FROM notes WHERE id = ?
        "#,
        id
    )
    .fetch_optional(pool)
    .await?;
    
    Ok(result.is_some())
}