import pyarrow as pa
import pyarrow.parquet as pq
from typing import List, Dict, Any, Optional, Iterator, Union
import pandas as pd
import json


class ArrowHandler:
    def __init__(self):
        self.supported_types = {
            'int8': pa.int8(),
            'int16': pa.int16(),
            'int32': pa.int32(),
            'int64': pa.int64(),
            'uint8': pa.uint8(),
            'uint16': pa.uint16(),
            'uint32': pa.uint32(),
            'uint64': pa.uint64(),
            'float32': pa.float32(),
            'float64': pa.float64(),
            'bool': pa.bool_(),
            'string': pa.string(),
            'binary': pa.binary(),
            'date32': pa.date32(),
            'date64': pa.date64(),
            'timestamp': pa.timestamp('ms'),
            'list': pa.list_(pa.string()),
            'struct': pa.struct([])
        }

    def infer_schema_from_data(self, data: List[Dict[str, Any]]) -> pa.Schema:
        if not data:
            return pa.schema([])
        
        fields = []
        sample = data[0]
        
        for key, value in sample.items():
            arrow_type = self._infer_type(value)
            fields.append(pa.field(key, arrow_type))
        
        return pa.schema(fields)

    def _infer_type(self, value: Any) -> pa.DataType:
        if isinstance(value, bool):
            return pa.bool_()
        elif isinstance(value, int):
            if -2**31 <= value <= 2**31 - 1:
                return pa.int32()
            return pa.int64()
        elif isinstance(value, float):
            return pa.float64()
        elif isinstance(value, str):
            return pa.string()
        elif isinstance(value, bytes):
            return pa.binary()
        elif isinstance(value, list):
            if value:
                inner_type = self._infer_type(value[0])
                return pa.list_(inner_type)
            return pa.list_(pa.string())
        elif isinstance(value, dict):
            return pa.struct([
                pa.field(k, self._infer_type(v)) 
                for k, v in value.items()
            ])
        elif value is None:
            return pa.string()
        else:
            return pa.string()

    def to_arrow_table(self, data: Union[List[Dict], pd.DataFrame], 
                       schema: Optional[pa.Schema] = None) -> pa.Table:
        if isinstance(data, pd.DataFrame):
            return pa.Table.from_pandas(data, schema=schema)
        
        if not schema:
            schema = self.infer_schema_from_data(data)
        
        columns = {field.name: [] for field in schema}
        
        for row in data:
            for field in schema:
                columns[field.name].append(row.get(field.name))
        
        arrays = []
        for field in schema:
            try:
                array = pa.array(columns[field.name], type=field.type)
            except:
                array = pa.array(columns[field.name])
            arrays.append(array)
        
        return pa.Table.from_arrays(arrays, schema=schema)

    def from_arrow_table(self, table: pa.Table) -> List[Dict[str, Any]]:
        return table.to_pylist()

    def to_dataframe(self, table: pa.Table) -> pd.DataFrame:
        return table.to_pandas()

    def serialize_table(self, table: pa.Table) -> bytes:
        sink = pa.BufferOutputStream()
        writer = pa.RecordBatchStreamWriter(sink, table.schema)
        writer.write_table(table)
        writer.close()
        return sink.getvalue().to_pybytes()

    def deserialize_table(self, data: bytes) -> pa.Table:
        reader = pa.RecordBatchStreamReader(pa.py_buffer(data))
        return reader.read_all()

    def write_parquet(self, table: pa.Table, path: str, 
                      compression: str = 'snappy') -> None:
        pq.write_table(table, path, compression=compression)

    def read_parquet(self, path: str, columns: Optional[List[str]] = None,
                     filters: Optional[List] = None) -> pa.Table:
        return pq.read_table(path, columns=columns, filters=filters)

    def stream_batches(self, table: pa.Table, batch_size: int = 10000) -> Iterator[pa.RecordBatch]:
        for i in range(0, table.num_rows, batch_size):
            end = min(i + batch_size, table.num_rows)
            yield table.slice(i, end - i).to_batches()[0]

    def merge_tables(self, tables: List[pa.Table]) -> pa.Table:
        if not tables:
            return pa.Table.from_pylist([])
        
        unified_schema = self._unify_schemas([t.schema for t in tables])
        
        aligned_tables = []
        for table in tables:
            aligned = self._align_schema(table, unified_schema)
            aligned_tables.append(aligned)
        
        return pa.concat_tables(aligned_tables)

    def _unify_schemas(self, schemas: List[pa.Schema]) -> pa.Schema:
        all_fields = {}
        for schema in schemas:
            for field in schema:
                if field.name not in all_fields:
                    all_fields[field.name] = field
                else:
                    existing = all_fields[field.name]
                    if not existing.type.equals(field.type):
                        all_fields[field.name] = pa.field(field.name, pa.string())
        
        return pa.schema(list(all_fields.values()))

    def _align_schema(self, table: pa.Table, target_schema: pa.Schema) -> pa.Table:
        columns = []
        for field in target_schema:
            if field.name in table.schema.names:
                col = table.column(field.name)
                if not col.type.equals(field.type):
                    col = col.cast(field.type)
                columns.append(col)
            else:
                null_array = pa.nulls(table.num_rows, type=field.type)
                columns.append(null_array)
        
        return pa.Table.from_arrays(columns, schema=target_schema)

    def filter_table(self, table: pa.Table, predicate: Dict[str, Any]) -> pa.Table:
        df = self.to_dataframe(table)
        
        for col, condition in predicate.items():
            if col not in df.columns:
                continue
            
            if isinstance(condition, dict):
                if 'eq' in condition:
                    df = df[df[col] == condition['eq']]
                elif 'gt' in condition:
                    df = df[df[col] > condition['gt']]
                elif 'gte' in condition:
                    df = df[df[col] >= condition['gte']]
                elif 'lt' in condition:
                    df = df[df[col] < condition['lt']]
                elif 'lte' in condition:
                    df = df[df[col] <= condition['lte']]
                elif 'in' in condition:
                    df = df[df[col].isin(condition['in'])]
                elif 'like' in condition:
                    pattern = condition['like'].replace('%', '.*').replace('_', '.')
                    df = df[df[col].str.match(pattern, na=False)]
            else:
                df = df[df[col] == condition]
        
        return self.to_arrow_table(df)

    def select_columns(self, table: pa.Table, columns: List[str]) -> pa.Table:
        existing_cols = [c for c in columns if c in table.schema.names]
        if not existing_cols:
            return pa.Table.from_pylist([], schema=table.schema)
        return table.select(existing_cols)

    def get_table_metadata(self, table: pa.Table) -> Dict[str, Any]:
        return {
            'num_rows': table.num_rows,
            'num_columns': table.num_columns,
            'schema': {
                field.name: str(field.type)
                for field in table.schema
            },
            'size_bytes': table.get_total_buffer_size()
        }
