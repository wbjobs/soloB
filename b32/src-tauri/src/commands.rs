use crate::code_parser;
use crate::embedding::EmbeddingEngine;
use crate::vector_db::{SearchResult, VectorDatabase};
use anyhow::Context;
use dashmap::DashMap;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

static SCAN_PROGRESS: Lazy<DashMap<String, ScanProgress>> = 
    Lazy::new(|| DashMap::new());

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProgress {
    pub progress: u32,
    pub status: String,
    pub finished: bool,
}

pub struct AppState {
    db: Mutex<Option<Arc<VectorDatabase>>>,
    current_directory: Mutex<Option<PathBuf>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            db: Mutex::new(None),
            current_directory: Mutex::new(None),
        }
    }
}

fn get_data_directory() -> Result<PathBuf, String> {
    let dir = dirs::data_local_dir()
        .ok_or("Failed to get data directory")?
        .join("semantic-code-search");
    
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create data directory: {}", e))?;
    
    Ok(dir)
}

fn get_scan_key(directory: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    
    let mut hasher = DefaultHasher::new();
    directory.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

#[tauri::command]
pub fn get_data_directory() -> Result<String, String> {
    get_data_directory()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn has_existing_index(directory: String) -> Result<bool, String> {
    let data_dir = get_data_directory().map_err(|e| e.to_string())?;
    let db_path = data_dir.join("qdrant");
    
    Ok(db_path.exists() && db_path.is_dir())
}

#[tauri::command]
pub async fn scan_directory(directory: String, state: State<'_, AppState>) -> Result<u32, String> {
    let scan_key = get_scan_key(&directory);
    let dir_path = PathBuf::from(&directory);
    
    SCAN_PROGRESS.insert(scan_key.clone(), ScanProgress {
        progress: 0,
        status: "Initializing...".to_string(),
        finished: false,
    });
    
    let scan_key_clone = scan_key.clone();
    let directory_clone = directory.clone();
    
    tokio::spawn(async move {
        let result = async {
            SCAN_PROGRESS.insert(scan_key_clone.clone(), ScanProgress {
                progress: 5,
                status: "Loading embedding model...".to_string(),
                finished: false,
            });
            
            let engine = EmbeddingEngine::get()
                .context("Failed to load embedding model")?;
            
            SCAN_PROGRESS.insert(scan_key_clone.clone(), ScanProgress {
                progress: 10,
                status: "Scanning code files...".to_string(),
                finished: false,
            });
            
            let parsed_files = code_parser::parse_directory(
                &dir_path,
                |current, total, file| {
                    let progress = 10 + ((current as u32 * 40) / total.max(1) as u32);
                    SCAN_PROGRESS.insert(scan_key_clone.clone(), ScanProgress {
                        progress,
                        status: format!("Parsing: {}", file),
                        finished: false,
                    });
                }
            ).context("Failed to parse directory")?;
            
            let total_blocks: usize = parsed_files.iter().map(|f| f.blocks.len()).sum();
            
            SCAN_PROGRESS.insert(scan_key_clone.clone(), ScanProgress {
                progress: 50,
                status: format!("Generating embeddings for {} code blocks...", total_blocks),
                finished: false,
            });
            
            let mut blocks_with_embeddings = Vec::with_capacity(total_blocks);
            let mut processed = 0usize;
            
            for parsed_file in parsed_files {
                for block in parsed_file.blocks {
                    let text = format!(
                        "Language: {}\nFile: {}\nFunction: {}\n\n{}",
                        block.language,
                        block.file_path,
                        block.function_name,
                        block.code
                    );
                    
                    let embedding = engine
                        .embed(&text)
                        .context("Failed to generate embedding")?;
                    
                    blocks_with_embeddings.push((block, embedding));
                    processed += 1;
                    
                    let progress = 50 + ((processed as u32 * 30) / total_blocks.max(1) as u32);
                    SCAN_PROGRESS.insert(scan_key_clone.clone(), ScanProgress {
                        progress,
                        status: format!("Embedding: {}/{}", processed, total_blocks),
                        finished: false,
                    });
                }
            }
            
            SCAN_PROGRESS.insert(scan_key_clone.clone(), ScanProgress {
                progress: 80,
                status: "Storing to vector database...".to_string(),
                finished: false,
            });
            
            let data_dir = get_data_directory()
                .context("Failed to get data directory")?;
            
            let db = VectorDatabase::new(&data_dir)
                .await
                .context("Failed to initialize vector database")?;
            
            db.clear_collection()
                .await
                .context("Failed to clear existing collection")?;
            
            let total = blocks_with_embeddings.len();
            db.insert_blocks(&blocks_with_embeddings, |current, _| {
                let progress = 80 + ((current as u32 * 19) / total.max(1) as u32);
                SCAN_PROGRESS.insert(scan_key_clone.clone(), ScanProgress {
                    progress,
                    status: format!("Storing: {}/{}", current, total),
                    finished: false,
                });
            })
            .await
            .context("Failed to insert blocks into database")?;
            
            SCAN_PROGRESS.insert(scan_key_clone.clone(), ScanProgress {
                progress: 100,
                status: format!("Indexed {} code blocks successfully!", total),
                finished: true,
            });
            
            Ok::<(), anyhow::Error>(())
        }.await;
        
        if let Err(e) = result {
            SCAN_PROGRESS.insert(scan_key_clone.clone(), ScanProgress {
                progress: 0,
                status: format!("Error: {}", e),
                finished: true,
            });
            eprintln!("Scan error: {}", e);
        }
    });
    
    Ok(0)
}

#[tauri::command]
pub async fn get_scan_progress(directory: String) -> Result<ScanProgress, String> {
    let scan_key = get_scan_key(&directory);
    
    SCAN_PROGRESS
        .get(&scan_key)
        .map(|p| p.clone())
        .ok_or_else(|| "No scan in progress".to_string())
}

#[tauri::command]
pub async fn search_code(
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchResult>, String> {
    let limit = limit.unwrap_or(10);
    
    let engine = EmbeddingEngine::get()
        .map_err(|e| format!("Failed to load embedding model: {}", e))?;
    
    let query_embedding = engine
        .embed(&query)
        .map_err(|e| format!("Failed to embed query: {}", e))?;
    
    let data_dir = get_data_directory()
        .map_err(|e| e.to_string())?;
    
    let db = VectorDatabase::new(&data_dir)
        .await
        .map_err(|e| format!("Failed to load vector database: {}", e))?;
    
    let results = db
        .search(&query_embedding, limit)
        .await
        .map_err(|e| format!("Search failed: {}", e))?;
    
    Ok(results)
}
