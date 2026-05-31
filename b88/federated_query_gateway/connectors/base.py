import pyarrow as pa
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional, Iterator
from ..core.arrow_handler import ArrowHandler


class BaseConnector(ABC):
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.arrow_handler = ArrowHandler()
        self._connected = False

    @abstractmethod
    def connect(self) -> None:
        pass

    @abstractmethod
    def disconnect(self) -> None:
        pass

    @abstractmethod
    def execute_query(self, query: str, **kwargs) -> pa.Table:
        pass

    @abstractmethod
    def get_tables(self) -> List[str]:
        pass

    @abstractmethod
    def get_schema(self, table_name: str) -> pa.Schema:
        pass

    def execute_query_streaming(self, query: str, batch_size: int = 10000, **kwargs) -> Iterator[pa.RecordBatch]:
        table = self.execute_query(query, **kwargs)
        for i in range(0, table.num_rows, batch_size):
            end = min(i + batch_size, table.num_rows)
            yield table.slice(i, end - i).to_batches()[0]

    def execute_pushdown_query(self, query: str, filters: Optional[Dict[str, Any]] = None, **kwargs) -> pa.Table:
        return self.execute_query(query, **kwargs)

    def supports_pushdown(self) -> bool:
        return True

    def is_connected(self) -> bool:
        return self._connected

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.disconnect()
