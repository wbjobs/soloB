import pyarrow as pa
from typing import Dict, Any, Optional, List, Iterator
import yaml
import asyncio
from .query_optimizer import QueryOptimizer, OptimizedQuery
from .join_engine import JoinEngine
from .cache import LRUCache
from .streaming import StreamProcessor
from .arrow_handler import ArrowHandler
from ..connectors import (
    BaseConnector,
    MySQLConnector,
    PostgreSQLConnector,
    MongoDBConnector,
    ParquetConnector
)


class QueryEngine:
    def __init__(self, config_path: str = 'config.yaml'):
        self.config = self._load_config(config_path)
        self.connectors: Dict[str, BaseConnector] = {}
        self.table_to_connector: Dict[str, str] = {}
        self.arrow_handler = ArrowHandler()
        self.join_engine = JoinEngine(self.arrow_handler)
        self.stream_processor = StreamProcessor()
        self.cache = None
        self.query_optimizer = None
        
        self._init_cache()
        self._init_connectors()
        self._init_optimizer()

    def _load_config(self, config_path: str) -> Dict[str, Any]:
        with open(config_path, 'r', encoding='utf-8') as f:
            return yaml.safe_load(f)

    def _init_cache(self) -> None:
        cache_config = self.config.get('cache', {})
        if cache_config.get('enabled', True):
            self.cache = LRUCache(
                max_size=cache_config.get('max_size', 100),
                ttl_seconds=cache_config.get('ttl_seconds', 3600),
                memory_limit_mb=cache_config.get('memory_limit_mb', 512)
            )

    def _init_connectors(self) -> None:
        datasources = self.config.get('datasources', {})
        
        for ds_type, ds_configs in datasources.items():
            for ds_config in ds_configs:
                name = ds_config.pop('name')
                
                if ds_type == 'mysql':
                    connector = MySQLConnector(ds_config)
                elif ds_type == 'postgresql':
                    connector = PostgreSQLConnector(ds_config)
                elif ds_type == 'mongodb':
                    connector = MongoDBConnector(ds_config)
                elif ds_type == 'parquet':
                    connector = ParquetConnector(ds_config)
                else:
                    continue
                
                self.connectors[name] = connector
                
                tables = connector.get_tables()
                for table in tables:
                    self.table_to_connector[table] = name

    def _init_optimizer(self) -> None:
        self.query_optimizer = QueryOptimizer(self.table_to_connector)

    def execute(self, sql: str, use_cache: bool = True, **kwargs) -> pa.Table:
        if use_cache and self.cache:
            cached_result = self.cache.get(sql, kwargs)
            if cached_result is not None:
                return cached_result
        
        optimized = self.query_optimizer.parse_and_optimize(sql)
        
        table_data = {}
        for table_ref in optimized.tables:
            connector_name = table_ref.datasource
            if connector_name not in self.connectors:
                continue
            
            connector = self.connectors[connector_name]
            pushdown_query = optimized.pushdown_queries.get(table_ref.name, f"SELECT * FROM {table_ref.name}")
            
            if isinstance(connector, MongoDBConnector):
                data = connector.execute_query(
                    pushdown_query,
                    collection=table_ref.name,
                    filters=optimized.filters.get(table_ref.name),
                    **kwargs
                )
            elif isinstance(connector, ParquetConnector):
                data = connector.execute_query(
                    pushdown_query,
                    file_pattern=table_ref.name,
                    **kwargs
                )
            else:
                data = connector.execute_pushdown_query(
                    pushdown_query,
                    filters=optimized.filters.get(table_ref.name),
                    **kwargs
                )
            
            table_data[table_ref.name] = data
        
        if len(table_data) == 1:
            result = list(table_data.values())[0]
        elif len(table_data) > 1:
            result = self.join_engine.execute_join(
                table_data,
                optimized.joins,
                select_columns=optimized.select_columns
            )
        else:
            result = pa.Table.from_pylist([])
        
        if use_cache and self.cache:
            self.cache.put(sql, result, kwargs)
        
        return result

    def execute_streaming(self, sql: str, batch_size: int = 10000, **kwargs) -> Iterator[pa.RecordBatch]:
        table = self.execute(sql, **kwargs)
        return self.stream_processor.stream_table(table, batch_size=batch_size)

    def execute_to_json(self, sql: str, **kwargs) -> List[Dict[str, Any]]:
        table = self.execute(sql, **kwargs)
        return self.arrow_handler.from_arrow_table(table)

    def validate_query(self, sql: str) -> tuple[bool, List[str]]:
        return self.query_optimizer.validate_query(sql)

    def get_table_schema(self, table_name: str) -> Optional[pa.Schema]:
        connector_name = self.table_to_connector.get(table_name)
        if not connector_name or connector_name not in self.connectors:
            return None
        
        connector = self.connectors[connector_name]
        return connector.get_schema(table_name)

    def get_all_tables(self) -> Dict[str, List[str]]:
        tables_by_connector = {}
        for name, connector in self.connectors.items():
            tables_by_connector[name] = connector.get_tables()
        return tables_by_connector

    def get_cache_stats(self) -> Optional[Dict[str, Any]]:
        if self.cache:
            return self.cache.get_stats()
        return None

    def invalidate_cache(self, sql: str = None) -> None:
        if self.cache:
            if sql:
                self.cache.invalidate(sql)
            else:
                self.cache.invalidate_all()

    async def execute_async(self, sql: str, **kwargs) -> pa.Table:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, lambda: self.execute(sql, **kwargs))

    def close(self) -> None:
        for connector in self.connectors.values():
            connector.disconnect()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
