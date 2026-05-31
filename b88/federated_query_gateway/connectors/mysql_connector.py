import pyarrow as pa
import pymysql
from typing import List, Dict, Any, Optional
from .base import BaseConnector


class MySQLConnector(BaseConnector):
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.host = config.get('host', 'localhost')
        self.port = config.get('port', 3306)
        self.user = config.get('user', 'root')
        self.password = config.get('password', '')
        self.database = config.get('database', '')
        self.charset = config.get('charset', 'utf8mb4')
        self.connection = None

    def connect(self) -> None:
        if not self._connected:
            self.connection = pymysql.connect(
                host=self.host,
                port=self.port,
                user=self.user,
                password=self.password,
                database=self.database,
                charset=self.charset,
                cursorclass=pymysql.cursors.DictCursor
            )
            self._connected = True

    def disconnect(self) -> None:
        if self._connected and self.connection:
            self.connection.close()
            self._connected = False

    def execute_query(self, query: str, **kwargs) -> pa.Table:
        self.connect()
        
        with self.connection.cursor() as cursor:
            cursor.execute(query)
            results = cursor.fetchall()
        
        if not results:
            return pa.Table.from_pylist([])
        
        return self.arrow_handler.to_arrow_table(results)

    def get_tables(self) -> List[str]:
        self.connect()
        
        with self.connection.cursor() as cursor:
            cursor.execute("SHOW TABLES")
            results = cursor.fetchall()
        
        table_key = f"Tables_in_{self.database}"
        return [row[table_key] for row in results]

    def get_schema(self, table_name: str) -> pa.Schema:
        self.connect()
        
        with self.connection.cursor() as cursor:
            cursor.execute(f"DESCRIBE {table_name}")
            columns = cursor.fetchall()
        
        fields = []
        type_mapping = {
            'int': pa.int32(),
            'bigint': pa.int64(),
            'smallint': pa.int16(),
            'tinyint': pa.int8(),
            'float': pa.float32(),
            'double': pa.float64(),
            'decimal': pa.decimal128(10, 2),
            'varchar': pa.string(),
            'char': pa.string(),
            'text': pa.string(),
            'datetime': pa.timestamp('ms'),
            'date': pa.date32(),
            'time': pa.time64('us'),
            'boolean': pa.bool_(),
            'json': pa.string()
        }
        
        for col in columns:
            col_type = col['Type'].lower()
            arrow_type = pa.string()
            
            for sql_type, mapped in type_mapping.items():
                if sql_type in col_type:
                    arrow_type = mapped
                    break
            
            fields.append(pa.field(col['Field'], arrow_type))
        
        return pa.schema(fields)

    def execute_pushdown_query(self, query: str, filters: Optional[Dict[str, Any]] = None, **kwargs) -> pa.Table:
        if filters:
            where_clauses = []
            for col, value in filters.items():
                if isinstance(value, dict):
                    if 'eq' in value:
                        where_clauses.append(f"{col} = '{value['eq']}'")
                    elif 'gt' in value:
                        where_clauses.append(f"{col} > {value['gt']}")
                    elif 'gte' in value:
                        where_clauses.append(f"{col} >= {value['gte']}")
                    elif 'lt' in value:
                        where_clauses.append(f"{col} < {value['lt']}")
                    elif 'lte' in value:
                        where_clauses.append(f"{col} <= {value['lte']}")
                    elif 'in' in value and isinstance(value['in'], list):
                        placeholders = ', '.join([f"'{v}'" for v in value['in']])
                        where_clauses.append(f"{col} IN ({placeholders})")
                else:
                    where_clauses.append(f"{col} = '{value}'")
            
            if where_clauses:
                where_str = " AND ".join(where_clauses)
                if "WHERE" in query.upper():
                    query = query.replace("WHERE", f"WHERE {where_str} AND", 1)
                else:
                    query = f"{query} WHERE {where_str}"
        
        return self.execute_query(query, **kwargs)

    def get_table_count(self, table_name: str) -> int:
        self.connect()
        
        with self.connection.cursor() as cursor:
            cursor.execute(f"SELECT COUNT(*) as count FROM {table_name}")
            result = cursor.fetchone()
        
        return result['count'] if result else 0
