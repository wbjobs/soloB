use thiserror::Error;

#[derive(Error, Debug)]
pub enum WellLogError {
    #[error("LAS parsing error: {0}")]
    LasParseError(String),
    
    #[error("Wavelet processing error: {0}")]
    WaveletError(String),
    
    #[error("PELT algorithm error: {0}")]
    PeltError(String),
    
    #[error("WITSML export error: {0}")]
    WitsmlError(String),
    
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    
    #[error("JSON serialization error: {0}")]
    JsonError(#[from] serde_json::Error),
    
    #[error("XML serialization error: {0}")]
    XmlError(#[from] quick_xml::DeError),
    
    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),
}

pub type Result<T> = std::result::Result<T, WellLogError>;
