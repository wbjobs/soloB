from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class QueryRequest(BaseModel):
    question: str = Field(..., description="The user's question")
    top_k: Optional[int] = Field(None, description="Number of document chunks to retrieve")
    document_ids: Optional[List[str]] = Field(
        None,
        description="List of document IDs to search in. If None, search all documents."
    )


class RetrievedDocument(BaseModel):
    content: str
    source: str
    chunk_index: int
    score: Optional[float] = None
    is_table_chunk: bool = False
    document_id: Optional[str] = None


class QueryResponse(BaseModel):
    answer: str
    retrieved_documents: List[RetrievedDocument]
    selected_document_ids: Optional[List[str]] = None


class UploadResponse(BaseModel):
    success: bool
    message: str
    filename: Optional[str] = None
    total_chunks: int = 0
    document_id: Optional[str] = None
    total_pages: Optional[int] = None
    total_tables: Optional[int] = None
    table_chunks: Optional[int] = None
    extractor: Optional[str] = None


class DocumentInfo(BaseModel):
    document_id: str
    filename: str
    total_chunks: int
    total_pages: Optional[int] = None
    total_tables: Optional[int] = None
    uploaded_at: datetime
    file_size_kb: Optional[float] = None


class DocumentListResponse(BaseModel):
    documents: List[DocumentInfo]
    total: int


class DeleteDocumentResponse(BaseModel):
    success: bool
    message: str
    deleted_chunks: int


class HealthResponse(BaseModel):
    status: str
    version: str
    document_count: int
    embedding_model: str
    pdfplumber_available: bool
    total_documents: int = 0
