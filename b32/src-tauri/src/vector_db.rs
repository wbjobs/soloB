use anyhow::{Context, Result};
use qdrant_client::qdrant::*;
use qdrant_client::Qdrant;
use serde::{Deserialize, Serialize};
use std::path::Path;
use uuid::Uuid;

use crate::code_parser::CodeBlock;

const COLLECTION_NAME: &str = "code_embeddings";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub file_path: String,
    pub function_name: String,
    pub code: String,
    pub score: f32,
}

pub struct VectorDatabase {
    client: Qdrant,
}

impl VectorDatabase {
    pub async fn new(data_dir: &Path) -> Result<Self> {
        let db_path = data_dir.join("qdrant");
        std::fs::create_dir_all(&db_path)
            .with_context(|| format!("Failed to create Qdrant directory at {:?}", db_path))?;
        
        let db_path_str = db_path
            .to_str()
            .context("Failed to convert path to string")?;
        
        let config = qdrant_client::client::QdrantClientConfig::from_url(
            &format!("sqlite://{}", db_path_str)
        );
        
        let client = Qdrant::new(config)
            .context("Failed to create Qdrant client")?;
        
        let db = Self { client };
        db.ensure_collection().await?;
        
        Ok(db)
    }
    
    async fn ensure_collection(&self) -> Result<()> {
        let collections = self.client
            .list_collections()
            .await
            .context("Failed to list collections")?;
        
        let exists = collections.collections.iter()
            .any(|c| c.name == COLLECTION_NAME);
        
        if !exists {
            self.client
                .create_collection(&CreateCollection {
                    collection_name: COLLECTION_NAME.to_string(),
                    vectors_config: Some(VectorsConfig {
                        config: Some(vectors_config::Config::Params(VectorParams {
                            size: 512,
                            distance: Distance::Cosine.into(),
                            ..Default::default()
                        })),
                    }),
                    ..Default::default()
                })
                .await
                .context("Failed to create collection")?;
        }
        
        Ok(())
    }
    
    pub async fn insert_blocks(
        &self,
        blocks: &[(CodeBlock, Vec<f32>)],
        progress_cb: impl Fn(usize, usize),
    ) -> Result<()> {
        let total = blocks.len();
        
        for (idx, (block, embedding)) in blocks.iter().enumerate() {
            let point_id = PointId::from(Uuid::new_v4().to_string());
            
            let payload: serde_json::Value = serde_json::json!({
                "file_path": block.file_path,
                "function_name": block.function_name,
                "code": block.code,
                "language": block.language,
            });
            
            let point = PointStruct {
                id: Some(point_id),
                vectors: Some(vectors::Vectors::Vector(Vector {
                    data: embedding.clone(),
                    ..Default::default()
                })),
                payload: payload
                    .as_object()
                    .map(|obj| obj.into_iter()
                        .map(|(k, v)| (k.clone(), v.clone().into()))
                        .collect())
                    .unwrap_or_default(),
            };
            
            self.client
                .upsert_points(
                    COLLECTION_NAME,
                    vec![point],
                    None,
                )
                .await
                .with_context(|| format!("Failed to insert point {} of {}", idx + 1, total))?;
            
            progress_cb(idx + 1, total);
        }
        
        Ok(())
    }
    
    pub async fn search(
        &self,
        query_vector: &[f32],
        limit: usize,
    ) -> Result<Vec<SearchResult>> {
        let search_result = self.client
            .search_points(&SearchPoints {
                collection_name: COLLECTION_NAME.to_string(),
                vector: query_vector.to_vec(),
                limit: limit as u64,
                with_payload: Some(true.into()),
                ..Default::default()
            })
            .await
            .context("Failed to search points")?;
        
        let results = search_result
            .result
            .into_iter()
            .filter_map(|point| {
                let payload = point.payload?;
                let file_path = payload.get("file_path")?.as_str()?.to_string();
                let function_name = payload.get("function_name")?.as_str()?.to_string();
                let code = payload.get("code")?.as_str()?.to_string();
                
                Some(SearchResult {
                    file_path,
                    function_name,
                    code,
                    score: point.score,
                })
            })
            .collect();
        
        Ok(results)
    }
    
    pub async fn clear_collection(&self) -> Result<()> {
        self.client
            .delete_points(
                COLLECTION_NAME,
                &Filter::default(),
                None,
            )
            .await
            .context("Failed to clear collection")?;
        
        Ok(())
    }
    
    pub async fn count_points(&self) -> Result<u64> {
        let result = self.client
            .count(&CountPoints {
                collection_name: COLLECTION_NAME.to_string(),
                ..Default::default()
            })
            .await
            .context("Failed to count points")?;
        
        Ok(result.result.map(|r| r.count).unwrap_or(0))
    }
}
