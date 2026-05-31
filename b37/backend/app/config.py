from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "PDF Q&A System"
    version: str = "1.0.0"
    
    chroma_persist_directory: str = "./chroma_db"
    chroma_collection_name: str = "pdf_documents"
    
    embedding_model_name: str = "BAAI/bge-small-en-v1.5"
    
    llm_provider: str = "ollama"
    llm_model_name: str = "qwen2:7b"
    llm_api_url: str = "http://localhost:11434"
    llm_api_key: Optional[str] = None
    
    text_chunk_size: int = 1000
    text_chunk_overlap: int = 200
    
    top_k_retrieval: int = 5
    
    max_file_size_mb: int = 50
    
    cors_origins: list = ["http://localhost:3000", "http://127.0.0.1:3000"]
    
    class Config:
        env_file = ".env"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
