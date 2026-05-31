import os
import tempfile
from typing import List, Optional
from pathlib import Path

from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document

from backend.config import (
    CHUNK_SIZE,
    CHUNK_OVERLAP,
    EMBEDDING_MODEL,
    MILVUS_HOST,
    MILVUS_PORT,
    COLLECTION_NAME,
    EMBEDDING_DIM
)


class DocumentIngestor:
    def __init__(self, use_milvus: bool = True):
        self.use_milvus = use_milvus
        self.embedding_model = None
        self.milvus_collection = None
        self._init_embedding()
        if use_milvus:
            self._init_milvus()
        else:
            self._init_faiss()
    
    def _init_embedding(self):
        from sentence_transformers import SentenceTransformer
        self.embedding_model = SentenceTransformer(EMBEDDING_MODEL)
    
    def _init_milvus(self):
        try:
            from pymilvus import MilvusClient, DataType
            self.milvus_client = MilvusClient(uri=f"http://{MILVUS_HOST}:{MILVUS_PORT}")
            
            if not self.milvus_client.has_collection(COLLECTION_NAME):
                schema = self.milvus_client.create_schema(
                    auto_id=True,
                    enable_dynamic_field=True
                )
                schema.add_field(field_name="id", datatype=DataType.INT64, is_primary=True)
                schema.add_field(field_name="embedding", datatype=DataType.FLOAT_VECTOR, dim=EMBEDDING_DIM)
                schema.add_field(field_name="text", datatype=DataType.VARCHAR, max_length=65535)
                schema.add_field(field_name="source", datatype=DataType.VARCHAR, max_length=1000)
                schema.add_field(field_name="page", datatype=DataType.INT64)
                
                index_params = self.milvus_client.prepare_index_params()
                index_params.add_index(
                    field_name="embedding",
                    index_type="IVF_FLAT",
                    metric_type="COSINE",
                    params={"nlist": 128}
                )
                
                self.milvus_client.create_collection(
                    collection_name=COLLECTION_NAME,
                    schema=schema,
                    index_params=index_params
                )
            
            self.milvus_collection = COLLECTION_NAME
        except Exception as e:
            print(f"Milvus initialization failed: {e}. Switching to FAISS fallback.")
            self.use_milvus = False
            self._init_faiss()
    
    def _init_faiss(self):
        self.use_milvus = False
        self.documents = []
        self.embeddings = []
        self.metadata_list = []
    
    def load_document(self, file_path: str, original_name: Optional[str] = None) -> List[Document]:
        path = Path(file_path)
        file_name = original_name or path.name
        ext = path.suffix.lower()
        
        if ext == ".pdf":
            loader = PyPDFLoader(file_path)
            docs = loader.load()
            for doc in docs:
                doc.metadata["source"] = file_name
        elif ext == ".md":
            loader = TextLoader(file_path, encoding="utf-8")
            docs = loader.load()
            for doc in docs:
                doc.metadata["source"] = file_name
                doc.metadata["page"] = 0
        else:
            raise ValueError(f"Unsupported file format: {ext}")
        
        return docs
    
    def split_documents(self, docs: List[Document]) -> List[Document]:
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=CHUNK_SIZE,
            chunk_overlap=CHUNK_OVERLAP,
            separators=["\n\n", "\n", " ", ""],
            length_function=len
        )
        chunks = text_splitter.split_documents(docs)
        return chunks
    
    def create_embeddings(self, texts: List[str]):
        return self.embedding_model.encode(texts, convert_to_numpy=True)
    
    def ingest_document(self, file_bytes: bytes, original_name: str) -> int:
        ext = Path(original_name).suffix.lower()
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp_file:
            tmp_file.write(file_bytes)
            tmp_path = tmp_file.name
        
        try:
            docs = self.load_document(tmp_path, original_name)
            chunks = self.split_documents(docs)
            
            if not chunks:
                return 0
            
            texts = [chunk.page_content for chunk in chunks]
            embeddings = self.create_embeddings(texts)
            
            if self.use_milvus:
                data = [
                    {
                        "embedding": emb.tolist(),
                        "text": chunk.page_content,
                        "source": chunk.metadata.get("source", original_name),
                        "page": int(chunk.metadata.get("page", 0))
                    }
                    for chunk, emb in zip(chunks, embeddings)
                ]
                
                self.milvus_client.insert(
                    collection_name=self.milvus_collection,
                    data=data
                )
            else:
                for chunk, emb in zip(chunks, embeddings):
                    self.documents.append(chunk.page_content)
                    self.embeddings.append(emb)
                    self.metadata_list.append({
                        "source": chunk.metadata.get("source", original_name),
                        "page": int(chunk.metadata.get("page", 0))
                    })
            
            return len(chunks)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
    
    def get_collection_stats(self):
        if self.use_milvus:
            stats = self.milvus_client.get_collection_stats(collection_name=self.milvus_collection)
            return {"status": "connected", "type": "milvus", "stats": stats}
        else:
            return {"status": "connected", "type": "faiss", "document_count": len(self.documents)}
