import json
import logging
import os
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)


@dataclass
class DocumentRecord:
    document_id: str
    filename: str
    total_chunks: int
    total_pages: Optional[int]
    total_tables: Optional[int]
    uploaded_at: str
    file_size_kb: Optional[float] = None

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "DocumentRecord":
        return cls(
            document_id=data["document_id"],
            filename=data["filename"],
            total_chunks=data["total_chunks"],
            total_pages=data.get("total_pages"),
            total_tables=data.get("total_tables"),
            uploaded_at=data["uploaded_at"],
            file_size_kb=data.get("file_size_kb"),
        )


class DocumentRegistry:
    def __init__(self, settings: Optional[Settings] = None):
        self.settings = settings or get_settings()
        self._storage_path = Path(self.settings.chroma_persist_directory) / "document_registry.json"
        self._ensure_storage_dir()
        self._registry: Dict[str, DocumentRecord] = self._load_registry()

    def _ensure_storage_dir(self):
        self._storage_path.parent.mkdir(parents=True, exist_ok=True)

    def _load_registry(self) -> Dict[str, DocumentRecord]:
        if not self._storage_path.exists():
            return {}
        
        try:
            with open(self._storage_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return {
                    doc_id: DocumentRecord.from_dict(doc_data)
                    for doc_id, doc_data in data.items()
                }
        except Exception as e:
            logger.error(f"Failed to load document registry: {e}")
            return {}

    def _save_registry(self):
        try:
            data = {
                doc_id: record.to_dict()
                for doc_id, record in self._registry.items()
            }
            with open(self._storage_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            logger.info(f"Saved document registry with {len(self._registry)} documents")
        except Exception as e:
            logger.error(f"Failed to save document registry: {e}")

    def register_document(
        self,
        document_id: str,
        filename: str,
        total_chunks: int,
        total_pages: Optional[int] = None,
        total_tables: Optional[int] = None,
        file_size_bytes: Optional[int] = None,
    ) -> DocumentRecord:
        file_size_kb = file_size_bytes / 1024 if file_size_bytes else None
        
        record = DocumentRecord(
            document_id=document_id,
            filename=filename,
            total_chunks=total_chunks,
            total_pages=total_pages,
            total_tables=total_tables,
            uploaded_at=datetime.utcnow().isoformat(),
            file_size_kb=file_size_kb,
        )
        
        self._registry[document_id] = record
        self._save_registry()
        
        logger.info(f"Registered document: {filename} (ID: {document_id[:8]}...)")
        return record

    def unregister_document(self, document_id: str) -> Optional[DocumentRecord]:
        if document_id not in self._registry:
            logger.warning(f"Document not found in registry: {document_id}")
            return None
        
        record = self._registry.pop(document_id)
        self._save_registry()
        
        logger.info(f"Unregistered document: {record.filename} (ID: {document_id[:8]}...)")
        return record

    def get_document(self, document_id: str) -> Optional[DocumentRecord]:
        return self._registry.get(document_id)

    def list_documents(self) -> List[DocumentRecord]:
        return sorted(
            self._registry.values(),
            key=lambda x: x.uploaded_at,
            reverse=True
        )

    def clear_all(self) -> int:
        count = len(self._registry)
        self._registry.clear()
        self._save_registry()
        logger.info(f"Cleared document registry ({count} documents)")
        return count

    def document_exists(self, document_id: str) -> bool:
        return document_id in self._registry

    def get_document_count(self) -> int:
        return len(self._registry)

    def get_total_chunks(self) -> int:
        return sum(record.total_chunks for record in self._registry.values())
