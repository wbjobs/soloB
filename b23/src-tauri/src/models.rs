use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteHistory {
    pub id: String,
    pub note_id: String,
    pub title: String,
    pub content: String,
    pub version_at: String,
    pub version_number: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteAction {
    Create,
    Update,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteMessage {
    pub action: NoteAction,
    pub note: Note,
}

impl Note {
    pub fn new(title: String, content: String) -> Self {
        let now = Utc::now().to_rfc3339();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            title,
            content,
            created_at: now.clone(),
            updated_at: now,
        }
    }
}