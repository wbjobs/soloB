import logging
from typing import List, Optional, Tuple

import chromadb
from chromadb.config import Settings as ChromaSettings
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import Chroma
from langchain_core.documents import Document

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)


class VectorStoreService:
    def __init__(self, settings: Optional[Settings] = None):
        self.settings = settings or get_settings()
        self._embeddings = None
        self._vector_store = None

    @property
    def embeddings(self):
        if self._embeddings is None:
            logger.info(f"Loading embedding model: {self.settings.embedding_model_name}")
            self._embeddings = HuggingFaceEmbeddings(
                model_name=self.settings.embedding_model_name,
                model_kwargs={"device": "cpu"},
                encode_kwargs={"normalize_embeddings": True}
            )
        return self._embeddings

    @property
    def vector_store(self) -> Chroma:
        if self._vector_store is None:
            logger.info(f"Initializing ChromaDB at: {self.settings.chroma_persist_directory}")
            client_settings = ChromaSettings(
                persist_directory=self.settings.chroma_persist_directory,
                is_persistent=True
            )
            
            client = chromadb.PersistentClient(
                path=self.settings.chroma_persist_directory,
                settings=client_settings
            )
            
            self._vector_store = Chroma(
                client=client,
                collection_name=self.settings.chroma_collection_name,
                embedding_function=self.embeddings
            )
        return self._vector_store

    def add_documents(self, documents: List[Document]) -> List[str]:
        logger.info(f"Adding {len(documents)} document chunks to vector store")
        ids = self.vector_store.add_documents(documents)
        logger.info(f"Successfully added {len(ids)} chunks")
        return ids

    def _build_filter(
        self,
        document_ids: Optional[List[str]] = None
    ) -> Optional[dict]:
        if not document_ids:
            return None
        
        if len(document_ids) == 1:
            return {"document_id": document_ids[0]}
        
        return {"document_id": {"$in": document_ids}}

    def similarity_search(
        self,
        query: str,
        k: Optional[int] = None,
        document_ids: Optional[List[str]] = None
    ) -> List[Document]:
        k = k or self.settings.top_k_retrieval
        filter_dict = self._build_filter(document_ids)
        
        if document_ids:
            logger.info(
                f"Searching for top {k} relevant documents in {len(document_ids)} document(s) for query: {query[:50]}..."
            )
        else:
            logger.info(f"Searching for top {k} relevant documents for query: {query[:50]}...")
        
        results = self.vector_store.similarity_search(
            query,
            k=k,
            filter=filter_dict
        )
        logger.info(f"Found {len(results)} relevant documents")
        return results

    def similarity_search_with_score(
        self,
        query: str,
        k: Optional[int] = None,
        document_ids: Optional[List[str]] = None
    ) -> List[Tuple[Document, float]]:
        k = k or self.settings.top_k_retrieval
        filter_dict = self._build_filter(document_ids)
        
        if document_ids:
            logger.info(
                f"Searching (with score) for top {k} relevant documents in {len(document_ids)} document(s)..."
            )
        
        results = self.vector_store.similarity_search_with_score(
            query,
            k=k,
            filter=filter_dict
        )
        return results

    def delete_by_document_id(self, document_id: str) -> int:
        logger.info(f"Deleting chunks for document: {document_id[:8]}...")
        
        try:
            collection = self.vector_store._collection
            
            results = collection.get(
                where={"document_id": document_id},
                include=[]
            )
            
            ids_to_delete = results["ids"]
            
            if ids_to_delete:
                collection.delete(ids=ids_to_delete)
                logger.info(f"Deleted {len(ids_to_delete)} chunks for document {document_id[:8]}...")
                return len(ids_to_delete)
            else:
                logger.warning(f"No chunks found for document {document_id[:8]}...")
                return 0
                
        except Exception as e:
            logger.error(f"Failed to delete document chunks: {e}")
            raise

    def clear_collection(self):
        logger.info("Clearing vector store collection")
        try:
            client = self.vector_store._client
            client.delete_collection(self.settings.chroma_collection_name)
            self._vector_store = None
            logger.info("Collection cleared successfully")
        except Exception as e:
            logger.warning(f"Failed to clear collection: {e}")

    def get_document_count(self) -> int:
        try:
            collection = self.vector_store._collection
            return collection.count()
        except Exception as e:
            logger.error(f"Failed to get document count: {e}")
            return 0

    def get_unique_document_ids(self) -> List[str]:
        try:
            collection = self.vector_store._collection
            results = collection.get(include=["metadatas"])
            
            doc_ids = set()
            for metadata in results["metadatas"]:
                if metadata and "document_id" in metadata:
                    doc_ids.add(metadata["document_id"])
            
            return list(doc_ids)
        except Exception as e:
            logger.error(f"Failed to get unique document IDs: {e}")
            return []
