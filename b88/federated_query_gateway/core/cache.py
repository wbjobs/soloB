import pyarrow as pa
import hashlib
import time
from typing import Dict, Any, Optional, Tuple
from collections import OrderedDict
from dataclasses import dataclass


@dataclass
class CacheEntry:
    key: str
    table_bytes: bytes
    schema: pa.Schema
    created_at: float
    access_count: int
    size_bytes: int


class LRUCache:
    def __init__(self, 
                 max_size: int = 100, 
                 ttl_seconds: int = 3600,
                 memory_limit_mb: int = 512):
        self.max_size = max_size
        self.ttl_seconds = ttl_seconds
        self.memory_limit_bytes = memory_limit_mb * 1024 * 1024
        self.cache: OrderedDict[str, CacheEntry] = OrderedDict()
        self.total_memory_bytes = 0

    def _generate_key(self, query: str, params: Optional[Dict[str, Any]] = None) -> str:
        key_string = query
        if params:
            key_string += str(sorted(params.items()))
        
        return hashlib.sha256(key_string.encode('utf-8')).hexdigest()

    def get(self, 
            query: str, 
            params: Optional[Dict[str, Any]] = None
            ) -> Optional[pa.Table]:
        key = self._generate_key(query, params)
        
        if key not in self.cache:
            return None
        
        entry = self.cache[key]
        
        if self._is_expired(entry):
            self._remove_entry(key)
            return None
        
        self.cache.move_to_end(key)
        entry.access_count += 1
        
        reader = pa.RecordBatchStreamReader(pa.py_buffer(entry.table_bytes))
        return reader.read_all()

    def put(self, 
            query: str, 
            table: pa.Table, 
            params: Optional[Dict[str, Any]] = None) -> None:
        key = self._generate_key(query, params)
        
        sink = pa.BufferOutputStream()
        writer = pa.RecordBatchStreamWriter(sink, table.schema)
        writer.write_table(table)
        writer.close()
        table_bytes = sink.getvalue().to_pybytes()
        
        size_bytes = len(table_bytes)
        
        if key in self.cache:
            old_entry = self.cache[key]
            self.total_memory_bytes -= old_entry.size_bytes
            del self.cache[key]
        
        while len(self.cache) >= self.max_size:
            self._evict_lru()
        
        while (self.total_memory_bytes + size_bytes) > self.memory_limit_bytes:
            if not self.cache:
                break
            self._evict_lru()
        
        entry = CacheEntry(
            key=key,
            table_bytes=table_bytes,
            schema=table.schema,
            created_at=time.time(),
            access_count=1,
            size_bytes=size_bytes
        )
        
        self.cache[key] = entry
        self.total_memory_bytes += size_bytes

    def _is_expired(self, entry: CacheEntry) -> bool:
        return (time.time() - entry.created_at) > self.ttl_seconds

    def _remove_entry(self, key: str) -> None:
        if key in self.cache:
            entry = self.cache[key]
            self.total_memory_bytes -= entry.size_bytes
            del self.cache[key]

    def _evict_lru(self) -> None:
        if self.cache:
            oldest_key = next(iter(self.cache))
            self._remove_entry(oldest_key)

    def invalidate(self, query: str, params: Optional[Dict[str, Any]] = None) -> None:
        key = self._generate_key(query, params)
        self._remove_entry(key)

    def invalidate_all(self) -> None:
        self.cache.clear()
        self.total_memory_bytes = 0

    def cleanup_expired(self) -> int:
        expired_keys = [
            key for key, entry in self.cache.items()
            if self._is_expired(entry)
        ]
        for key in expired_keys:
            self._remove_entry(key)
        return len(expired_keys)

    def get_stats(self) -> Dict[str, Any]:
        total_accesses = sum(entry.access_count for entry in self.cache.values())
        return {
            'total_entries': len(self.cache),
            'total_memory_bytes': self.total_memory_bytes,
            'total_memory_mb': self.total_memory_bytes / (1024 * 1024),
            'total_accesses': total_accesses,
            'max_size': self.max_size,
            'memory_limit_mb': self.memory_limit_bytes / (1024 * 1024),
            'avg_access_count': total_accesses / len(self.cache) if self.cache else 0
        }

    def contains(self, query: str, params: Optional[Dict[str, Any]] = None) -> bool:
        key = self._generate_key(query, params)
        if key not in self.cache:
            return False
        
        if self._is_expired(self.cache[key]):
            self._remove_entry(key)
            return False
        
        return True

    def get_metadata(self, query: str, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        key = self._generate_key(query, params)
        
        if key not in self.cache:
            return None
        
        entry = self.cache[key]
        
        if self._is_expired(entry):
            self._remove_entry(key)
            return None
        
        return {
            'key': entry.key,
            'created_at': entry.created_at,
            'access_count': entry.access_count,
            'size_bytes': entry.size_bytes,
            'schema': str(entry.schema),
            'age_seconds': time.time() - entry.created_at
        }
