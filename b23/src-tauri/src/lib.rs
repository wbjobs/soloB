mod db;
mod p2p;
mod models;

use tauri::{AppHandle, Manager, State};
use tokio::sync::mpsc;

pub struct AppState {
    db_pool: sqlx::SqlitePool,
    p2p_sender: Option<mpsc::UnboundedSender<p2p::P2PCommand>>,
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle();
            tauri::async_runtime::spawn(async move {
                initialize_app(&app_handle).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_note,
            update_note,
            get_all_notes,
            get_note,
            delete_note,
            get_note_history,
            rollback_to_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

async fn initialize_app(app_handle: &AppHandle) {
    let db_pool = db::init_db(app_handle).await;
    let (p2p_sender, p2p_receiver) = mpsc::unbounded_channel();
    let db_clone = db_pool.clone();
    let app_handle_clone = app_handle.clone();

    tauri::async_runtime::spawn(async move {
        if let Err(e) = p2p::run_p2p(app_handle_clone, db_clone, p2p_receiver).await {
            eprintln!("P2P error: {:?}", e);
        }
    });

    app_handle.manage(AppState {
        db_pool,
        p2p_sender: Some(p2p_sender),
    });
}

#[tauri::command]
async fn create_note(
    title: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<models::Note, String> {
    let note = db::create_note(&state.db_pool, title, content).await
        .map_err(|e| e.to_string())?;
    
    if let Some(sender) = &state.p2p_sender {
        let _ = sender.send(p2p::P2PCommand::Publish(models::NoteMessage {
            action: models::NoteAction::Create,
            note: note.clone(),
        }));
    }
    
    Ok(note)
}

#[tauri::command]
async fn update_note(
    id: String,
    title: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<models::Note, String> {
    let note = db::update_note(&state.db_pool, &id, title, content, true).await
        .map_err(|e| e.to_string())?;
    
    if let Some(sender) = &state.p2p_sender {
        let _ = sender.send(p2p::P2PCommand::Publish(models::NoteMessage {
            action: models::NoteAction::Update,
            note: note.clone(),
        }));
    }
    
    Ok(note)
}

#[tauri::command]
async fn get_note_history(
    note_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<models::NoteHistory>, String> {
    db::get_note_history(&state.db_pool, &note_id).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn rollback_to_history(
    history_id: String,
    state: State<'_, AppState>,
) -> Result<models::Note, String> {
    let note = db::rollback_to_history(&state.db_pool, &history_id).await
        .map_err(|e| e.to_string())?;
    
    if let Some(sender) = &state.p2p_sender {
        let _ = sender.send(p2p::P2PCommand::Publish(models::NoteMessage {
            action: models::NoteAction::Update,
            note: note.clone(),
        }));
    }
    
    Ok(note)
}

#[tauri::command]
async fn get_all_notes(state: State<'_, AppState>) -> Result<Vec<models::Note>, String> {
    db::get_all_notes(&state.db_pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_note(id: String, state: State<'_, AppState>) -> Result<Option<models::Note>, String> {
    db::get_note(&state.db_pool, &id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_note(id: String, state: State<'_, AppState>) -> Result<(), String> {
    db::delete_note(&state.db_pool, &id).await.map_err(|e| e.to_string())?;
    
    if let Some(sender) = &state.p2p_sender {
        let note = models::Note {
            id,
            title: String::new(),
            content: String::new(),
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        };
        let _ = sender.send(p2p::P2PCommand::Publish(models::NoteMessage {
            action: models::NoteAction::Delete,
            note,
        }));
    }
    
    Ok(())
}