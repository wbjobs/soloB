import pyarrow as pa
import pyarrow.parquet as pq
import pyarrow.dataset as ds
from typing import List, Dict, Any, Optional, Iterator
import os
import glob
from .base import BaseConnector


class ParquetConnector(BaseConnector):
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.path = config.get('path', './data')
        self.file_extension = config.get('file_extension', '.parquet')
        self.partitioning = config.get('partitioning', None)
        self.partitioning_flavor = config.get('partitioning_flavor', 'hive')

    def connect(self) -> None:
        if not os.path.exists(self.path):
            os.makedirs(self.path, exist_ok=True)
        self._connected = True

    def disconnect(self) -> None:
        self._connected = False

    def execute_query(self, query: str, **kwargs) -> pa.Table:
        self.connect()
        
        file_pattern = kwargs.get('file_pattern', '*')
        columns = kwargs.get('columns', None)
        filters = kwargs.get('filters', None)
        
        full_pattern = os.path.join(self.path, f"{file_pattern}{self.file_extension}")
        files = glob.glob(full_pattern)
        
        if not files:
            return pa.Table.from_pylist([])
        
        if len(files) == 1:
            table = pq.read_table(files[0], columns=columns, filters=filters)
        else:
            dataset = ds.dataset(files, format='parquet', partitioning=self._get_partitioning())
            table = dataset.to_table(columns=columns, filter=filters)
        
        return table

    def _get_partitioning(self):
        if self.partitioning:
            return ds.partitioning(
                schema=pa.schema(self.partitioning),
                flavor=self.partitioning_flavor
            )
        return None

    def get_tables(self) -> List[str]:
        self.connect()
        
        files = glob.glob(os.path.join(self.path, f"*{self.file_extension}"))
        return [os.path.splitext(os.path.basename(f))[0] for f in files]

    def get_schema(self, table_name: str) -> pa.Schema:
        self.connect()
        
        file_path = os.path.join(self.path, f"{table_name}{self.file_extension}")
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Parquet file not found: {file_path}")
        
        parquet_file = pq.ParquetFile(file_path)
        return parquet_file.schema_arrow

    def execute_pushdown_query(self, query: str, filters: Optional[Dict[str, Any]] = None, **kwargs) -> pa.Table:
        if filters:
            pq_filters = []
            for col, value in filters.items():
                if isinstance(value, dict):
                    if 'eq' in value:
                        pq_filters.append((col, '=', value['eq']))
                    elif 'gt' in value:
                        pq_filters.append((col, '>', value['gt']))
                    elif 'gte' in value:
                        pq_filters.append((col, '>=', value['gte']))
                    elif 'lt' in value:
                        pq_filters.append((col, '<', value['lt']))
                    elif 'lte' in value:
                        pq_filters.append((col, '<=', value['lte']))
                    elif 'in' in value and isinstance(value['in'], list):
                        pq_filters.append((col, 'in', value['in']))
                else:
                    pq_filters.append((col, '=', value))
            
            kwargs['filters'] = pq_filters
        
        return self.execute_query(query, **kwargs)

    def execute_query_streaming(self, query: str, batch_size: int = 10000, **kwargs) -> Iterator[pa.RecordBatch]:
        self.connect()
        
        file_pattern = kwargs.get('file_pattern', '*')
        columns = kwargs.get('columns', None)
        filters = kwargs.get('filters', None)
        
        full_pattern = os.path.join(self.path, f"{file_pattern}{self.file_extension}")
        files = glob.glob(full_pattern)
        
        if not files:
            return
        
        for file_path in files:
            parquet_file = pq.ParquetFile(file_path)
            
            for batch in parquet_file.iter_batches(
                batch_size=batch_size,
                columns=columns,
                use_threads=True
            ):
                yield batch

    def write_table(self, table: pa.Table, table_name: str, 
                    compression: str = 'snappy', 
                    partition_cols: Optional[List[str]] = None) -> None:
        self.connect()
        
        file_path = os.path.join(self.path, f"{table_name}{self.file_extension}")
        
        if partition_cols:
            pq.write_to_dataset(
                table,
                root_path=self.path,
                partition_cols=partition_cols,
                compression=compression
            )
        else:
            pq.write_table(table, file_path, compression=compression)

    def get_file_metadata(self, table_name: str) -> Dict[str, Any]:
        self.connect()
        
        file_path = os.path.join(self.path, f"{table_name}{self.file_extension}")
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Parquet file not found: {file_path}")
        
        parquet_file = pq.ParquetFile(file_path)
        
        return {
            'num_rows': parquet_file.metadata.num_rows,
            'num_row_groups': parquet_file.num_row_groups,
            'schema': str(parquet_file.schema_arrow),
            'file_size': os.path.getsize(file_path),
            'compression': parquet_file.compression.name if hasattr(parquet_file, 'compression') else 'unknown'
        }

    def get_row_count(self, table_name: str) -> int:
        metadata = self.get_file_metadata(table_name)
        return metadata['num_rows']
