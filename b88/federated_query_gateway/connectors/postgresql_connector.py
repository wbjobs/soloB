import pyarrow as pa
import psycopg2
from psycopg2 import extras
from typing import List, Dict, Any, Optional
from .base import BaseConnector


class PostgreSQLConnector(BaseConnector):
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.host = config.get('host', 'localhost')
        self.port = config.get('port', 5432)
        self.user = config.get('user', 'postgres')
        self.password = config.get('password', '')
        self.database = config.get('database', '')
        self.schema = config.get('schema', 'public')
        self.connection = None

    def connect(self) -> None:
        if not self._connected:
            self.connection = psycopg2.connect(
                host=self.host,
                port=self.port,
                user=self.user,
                password=self.password,
                dbname=self.database,
                options=f'-c search_path={self.schema}'
            )
            self._connected = True

    def disconnect(self) -> None:
        if self._connected and self.connection:
            self.connection.close()
            self._connected = False

    def execute_query(self, query: str, **kwargs) -> pa.Table:
        self.connect()
        
        with self.connection.cursor(cursor_factory=extras.RealDictCursor) as cursor:
            cursor.execute(query)
            results = cursor.fetchall()
        
        if not results:
            return pa.Table.from_pylist([])
        
        results_list = [dict(row) for row in results]
        return self.arrow_handler.to_arrow_table(results_list)

    def get_tables(self) -> List[str]:
        self.connect()
        
        with self.connection.cursor() as cursor:
            cursor.execute("""
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = %s
            """, (self.schema,))
            results = cursor.fetchall()
        
        return [row[0] for row in results]

    def get_schema(self, table_name: str) -> pa.Schema:
        self.connect()
        
        with self.connection.cursor() as cursor:
            cursor.execute("""
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = %s AND table_schema = %s
            """, (table_name, self.schema))
            columns = cursor.fetchall()
        
        fields = []
        type_mapping = {
            'integer': pa.int32(),
            'bigint': pa.int64(),
            'smallint': pa.int16(),
            'real': pa.float32(),
            'double precision': pa.float64(),
            'numeric': pa.decimal128(10, 2),
            'character varying': pa.string(),
            'character': pa.string(),
            'text': pa.string(),
            'timestamp without time zone': pa.timestamp('ms'),
            'timestamp with time zone': pa.timestamp('ms'),
            'date': pa.date32(),
            'time without time zone': pa.time64('us'),
            'boolean': pa.bool_(),
            'json': pa.string(),
            'jsonb': pa.string(),
            'uuid': pa.string()
        }
        
        for col_name, data_type in columns:
            arrow_type = type_mapping.get(data_type, pa.string())
            fields.append(pa.field(col_name, arrow_type))
        
        return pa.schema(fields)

    def execute_pushdown_query(self, query: str, filters: Optional[Dict[str, Any]] = None, **kwargs) -> pa.Table:
        if filters:
            where_clauses = []
            params = []
            
            for col, value in filters.items():
                if isinstance(value, dict):
                    if 'eq' in value:
                        where_clauses.append(f"{col} = %s")
                        params.append(value['eq'])
                    elif 'gt' in value:
                        where_clauses.append(f"{col} > %s")
                        params.append(value['gt'])
                    elif 'gte' in value:
                        where_clauses.append(f"{col} >= %s")
                        params.append(value['gte'])
                    elif 'lt' in value:
                        where_clauses.append(f"{col} < %s")
                        params.append(value['lt'])
                    elif 'lte' in value:
                        where_clauses.append(f"{col} <= %s")
                        params.append(value['lte'])
                    elif 'in' in value and isinstance(value['in'], list):
                        placeholders = ', '.join(['%s'] * len(value['in']))
                        where_clauses.append(f"{col} IN ({placeholders})")
                        params.extend(value['in'])
                else:
                    where_clauses.append(f"{col} = %s")
                    params.append(value)
            
            if where_clauses:
                where_str = " AND ".join(where_clauses)
                if "WHERE" in query.upper():
                    query = query.replace("WHERE", f"WHERE {where_str} AND", 1)
                else:
                    query = f"{query} WHERE {where_str}"
                
                kwargs['params'] = params
        
        return self.execute_query(query, **kwargs)

    def execute_query(self, query: str, **kwargs) -> pa.Table:
        self.connect()
        
        params = kwargs.get('params', None)
        
        with self.connection.cursor(cursor_factory=extras.RealDictCursor) as cursor:
            cursor.execute(query, params)
            results = cursor.fetchall()
        
        if not results:
            return pa.Table.from_pylist([])
        
        results_list = [dict(row) for row in results]
        return self.arrow_handler.to_arrow_table(results_list)

    def get_table_count(self, table_name: str) -> int:
        self.connect()
        
        with self.connection.cursor() as cursor:
            cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
            result = cursor.fetchone()
        
        return result[0] if result else 0
