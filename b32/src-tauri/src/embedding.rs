use anyhow::{Context, Result};
use ndarray::s;
use parking_lot::RwLock;
use std::path::Path;
use std::sync::Arc;
use tokenizers::Tokenizer;
use once_cell::sync::Lazy;

const MODEL_URL: &str = "https://huggingface.co/BAAI/bge-small-zh-v1.5/resolve/main/";
const MODEL_FILE: &str = "model.onnx";
const TOKENIZER_FILE: &str = "tokenizer.json";
const EMBEDDING_DIM: usize = 512;
const MAX_SEQ_LENGTH: usize = 512;

static EMBEDDING_ENGINE: Lazy<Arc<RwLock<Option<EmbeddingEngine>>>> = 
    Lazy::new(|| Arc::new(RwLock::new(None)));

#[derive(Clone)]
pub struct EmbeddingEngine {
    session: Arc<dyn EmbeddingSession>,
    tokenizer: Arc<Tokenizer>,
}

trait EmbeddingSession: Send + Sync {
    fn infer(&self, input_ids: &[i64], attention_mask: &[i64]) -> Result<Vec<f32>>;
}

impl EmbeddingEngine {
    pub fn get() -> Result<Arc<EmbeddingEngine>> {
        let engine = EMBEDDING_ENGINE.read();
        if let Some(e) = engine.as_ref() {
            return Ok(Arc::new(e.clone()));
        }
        drop(engine);
        
        let new_engine = Self::init()?;
        let arc_engine = Arc::new(new_engine);
        *EMBEDDING_ENGINE.write() = Some((*arc_engine).clone());
        Ok(arc_engine)
    }
    
    fn init() -> Result<Self> {
        let model_dir = get_model_directory()?;
        let model_path = model_dir.join(MODEL_FILE);
        let tokenizer_path = model_dir.join(TOKENIZER_FILE);
        
        if !model_path.exists() || !tokenizer_path.exists() {
            download_model(&model_dir)?;
        }
        
        let tokenizer = Tokenizer::from_file(&tokenizer_path)
            .with_context(|| format!("Failed to load tokenizer from {:?}", tokenizer_path))?;
        let tokenizer = Arc::new(tokenizer);
        
        let session = create_onnx_session(&model_path)?;
        
        Ok(Self {
            session,
            tokenizer,
        })
    }
    
    pub fn embed(&self, text: &str) -> Result<Vec<f32>> {
        let encoding = self.tokenizer
            .encode(text, true)
            .context("Failed to encode text")?;
        
        let mut input_ids = encoding.get_ids().to_vec();
        let mut attention_mask = encoding.get_attention_mask().to_vec();
        
        while input_ids.len() < MAX_SEQ_LENGTH {
            input_ids.push(0);
            attention_mask.push(0);
        }
        if input_ids.len() > MAX_SEQ_LENGTH {
            input_ids.truncate(MAX_SEQ_LENGTH);
            attention_mask.truncate(MAX_SEQ_LENGTH);
        }
        
        let embedding = self.session.infer(&input_ids, &attention_mask)?;
        
        Ok(normalize_vector(&embedding))
    }
    
    pub fn embedding_dim() -> usize {
        EMBEDDING_DIM
    }
}

struct OnnxSession {
    inner: onnxruntime::Session,
}

impl EmbeddingSession for OnnxSession {
    fn infer(&self, input_ids: &[i64], attention_mask: &[i64]) -> Result<Vec<f32>> {
        let input_ids_array = ndarray::Array2::from_shape_vec(
            (1, MAX_SEQ_LENGTH),
            input_ids.to_vec(),
        )?;
        let attention_mask_array = ndarray::Array2::from_shape_vec(
            (1, MAX_SEQ_LENGTH),
            attention_mask.to_vec(),
        )?;
        
        let outputs = self.inner.run(vec![
            ("input_ids".to_string(), input_ids_array.into_dyn()),
            ("attention_mask".to_string(), attention_mask_array.into_dyn()),
        ])?;
        
        let output_tensor = outputs
            .first()
            .context("No output from model")?;
        
        let output_view = output_tensor
            .try_extract::<f32>()
            .context("Failed to extract output tensor")?;
        
        let output_shape = output_view.shape();
        let embedding = if output_shape.len() == 3 {
            let cls_token = output_view.slice(s![0, 0, ..]);
            cls_token.to_vec()
        } else if output_shape.len() == 2 {
            output_view.slice(s![0, ..]).to_vec()
        } else {
            return Err(anyhow::anyhow!("Unexpected output shape: {:?}", output_shape));
        };
        
        Ok(embedding)
    }
}

fn create_onnx_session(model_path: &Path) -> Result<Arc<dyn EmbeddingSession>> {
    let environment = onnxruntime::Environment::builder()
        .with_name("semantic-code-search")
        .with_log_level(onnxruntime::LoggingLevel::Warning)
        .build()?;
    let environment = Arc::new(environment);
    
    let session = onnxruntime::SessionBuilder::new(&environment)?
        .with_optimization_level(onnxruntime::GraphOptimizationLevel::Level3)?
        .with_model_from_file(model_path)
        .with_context(|| format!("Failed to load ONNX model from {:?}", model_path))?;
    
    Ok(Arc::new(OnnxSession { inner: session }))
}

fn get_model_directory() -> Result<std::path::PathBuf> {
    let data_dir = dirs::data_local_dir()
        .context("Failed to get local data directory")?
        .join("semantic-code-search")
        .join("models");
    
    std::fs::create_dir_all(&data_dir)
        .with_context(|| format!("Failed to create model directory at {:?}", data_dir))?;
    
    Ok(data_dir)
}

fn download_model(model_dir: &Path) -> Result<()> {
    use std::io::Write;
    
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()?;
    
    let model_url = format!("{}{}", MODEL_URL, MODEL_FILE);
    let tokenizer_url = format!("{}{}", MODEL_URL, TOKENIZER_FILE);
    
    for (url, filename) in [(model_url, MODEL_FILE), (tokenizer_url, TOKENIZER_FILE)] {
        let filepath = model_dir.join(filename);
        if filepath.exists() {
            continue;
        }
        
        println!("Downloading {}...", filename);
        
        let mut response = client.get(&url).send()?;
        let total_size = response.content_length().unwrap_or(0);
        
        let mut file = std::fs::File::create(&filepath)?;
        let mut downloaded = 0u64;
        let mut buffer = [0u8; 8192];
        
        loop {
            let bytes_read = response.read(&mut buffer)?;
            if bytes_read == 0 {
                break;
            }
            file.write_all(&buffer[..bytes_read])?;
            downloaded += bytes_read as u64;
            
            if total_size > 0 {
                let percent = (downloaded as f64 / total_size as f64) * 100.0;
                print!("\rDownloading {}: {:.1}%", filename, percent);
            }
        }
        println!("\rDownloading {}: 100.0%", filename);
    }
    
    Ok(())
}

fn normalize_vector(v: &[f32]) -> Vec<f32> {
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm == 0.0 {
        return v.to_vec();
    }
    v.iter().map(|x| x / norm).collect()
}
