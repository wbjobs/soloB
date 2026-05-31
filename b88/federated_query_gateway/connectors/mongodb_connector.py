import pyarrow as pa
from pymongo import MongoClient
from typing import List, Dict, Any, Optional
from .base import BaseConnector


class MongoDBConnector(BaseConnector):
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.host = config.get('host', 'localhost')
        self.port = config.get('port', 27017)
        self.user = config.get('user', '')
        self.password = config.get('password', '')
        self.database = config.get('database', '')
        self.auth_source = config.get('auth_source', 'admin')
        self.client = None
        self.db = None

    def connect(self) -> None:
        if not self._connected:
            if self.user and self.password:
                uri = f"mongodb://{self.user}:{self.password}@{self.host}:{self.port}/{self.auth_source}"
                self.client = MongoClient(uri)
            else:
                self.client = MongoClient(self.host, self.port)
            
            self.db = self.client[self.database]
            self._connected = True

    def disconnect(self) -> None:
        if self._connected and self.client:
            self.client.close()
            self._connected = False

    def execute_query(self, query: str, **kwargs) -> pa.Table:
        self.connect()
        
        collection = kwargs.get('collection', '')
        if not collection:
            raise ValueError("MongoDB query requires 'collection' parameter")
        
        filter_query = kwargs.get('filter', {})
        projection = kwargs.get('projection', None)
        limit = kwargs.get('limit', 0)
        skip = kwargs.get('skip', 0)
        
        coll = self.db[collection]
        cursor = coll.find(filter_query, projection, skip=skip, limit=limit)
        
        results = list(cursor)
        
        if not results:
            return pa.Table.from_pylist([])
        
        for doc in results:
            if '_id' in doc:
                doc['_id'] = str(doc['_id'])
        
        return self.arrow_handler.to_arrow_table(results)

    def get_tables(self) -> List[str]:
        self.connect()
        return self.db.list_collection_names()

    def get_schema(self, collection_name: str, sample_size: int = 100) -> pa.Schema:
        self.connect()
        
        coll = self.db[collection_name]
        sample_docs = list(coll.find().limit(sample_size))
        
        if not sample_docs:
            return pa.schema([])
        
        all_fields = {}
        for doc in sample_docs:
            for key, value in doc.items():
                if key not in all_fields:
                    all_fields[key] = self._infer_type(value)
        
        fields = [pa.field(name, dtype) for name, dtype in all_fields.items()]
        return pa.schema(fields)

    def _infer_type(self, value: Any) -> pa.DataType:
        if isinstance(value, bool):
            return pa.bool_()
        elif isinstance(value, int):
            return pa.int64()
        elif isinstance(value, float):
            return pa.float64()
        elif isinstance(value, str):
            return pa.string()
        elif isinstance(value, bytes):
            return pa.binary()
        elif isinstance(value, list):
            if value:
                return pa.list_(self._infer_type(value[0]))
            return pa.list_(pa.string())
        elif isinstance(value, dict):
            return pa.struct([
                pa.field(k, self._infer_type(v)) for k, v in value.items()
            ])
        elif value is None:
            return pa.string()
        else:
            return pa.string()

    def execute_pushdown_query(self, query: str, filters: Optional[Dict[str, Any]] = None, **kwargs) -> pa.Table:
        if filters:
            mongo_filter = {}
            for col, value in filters.items():
                if isinstance(value, dict):
                    if 'eq' in value:
                        mongo_filter[col] = value['eq']
                    elif 'gt' in value:
                        mongo_filter[col] = {'$gt': value['gt']}
                    elif 'gte' in value:
                        mongo_filter[col] = {'$gte': value['gte']}
                    elif 'lt' in value:
                        mongo_filter[col] = {'$lt': value['lt']}
                    elif 'lte' in value:
                        mongo_filter[col] = {'$lte': value['lte']}
                    elif 'in' in value and isinstance(value['in'], list):
                        mongo_filter[col] = {'$in': value['in']}
                    elif 'like' in value:
                        pattern = value['like'].replace('%', '.*').replace('_', '.')
                        mongo_filter[col] = {'$regex': pattern}
                else:
                    mongo_filter[col] = value
            
            kwargs['filter'] = mongo_filter
        
        return self.execute_query(query, **kwargs)

    def aggregate(self, collection_name: str, pipeline: List[Dict[str, Any]]) -> pa.Table:
        self.connect()
        
        coll = self.db[collection_name]
        results = list(coll.aggregate(pipeline))
        
        if not results:
            return pa.Table.from_pylist([])
        
        for doc in results:
            if '_id' in doc:
                doc['_id'] = str(doc['_id'])
        
        return self.arrow_handler.to_arrow_table(results)

    def get_collection_count(self, collection_name: str, filter_query: Optional[Dict[str, Any]] = None) -> int:
        self.connect()
        
        coll = self.db[collection_name]
        if filter_query:
            return coll.count_documents(filter_query)
        return coll.count_documents({})
