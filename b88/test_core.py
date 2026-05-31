import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

print("=== Testing Apache Arrow Handler ===")
from federated_query_gateway.core.arrow_handler import ArrowHandler
import pyarrow as pa

handler = ArrowHandler()
print("ArrowHandler initialized successfully")

test_data = [
    {"id": 1, "name": "Alice", "age": 30},
    {"id": 2, "name": "Bob", "age": 25},
    {"id": 3, "name": "Charlie", "age": 35},
]

table = handler.to_arrow_table(test_data)
print(f"Created table with {table.num_rows} rows")
print(f"Schema: {table.schema}")

serialized = handler.serialize_table(table)
print(f"Serialized size: {len(serialized)} bytes")

deserialized = handler.deserialize_table(serialized)
print(f"Deserialized table rows: {deserialized.num_rows}")

print("\n=== Testing LRU Cache ===")
from federated_query_gateway.core.cache import LRUCache

cache = LRUCache(max_size=10)
print("LRUCache initialized successfully")

cache.put("query1", table)
print("Table cached successfully")

cached_result = cache.get("query1")
print(f"Retrieved from cache: {cached_result is not None}, rows: {cached_result.num_rows if cached_result else 0}")

stats = cache.get_stats()
print(f"Cache stats: {stats}")

print("\n=== Testing Streaming ===")
from federated_query_gateway.core.streaming import StreamProcessor

streamer = StreamProcessor()
print("StreamProcessor initialized successfully")

batches = list(streamer.stream_table(table, batch_size=2))
print(f"Generated {len(batches)} batches")
for i, batch in enumerate(batches):
    print(f"Batch {i}: {batch.row_count} rows")

print("\n=== Testing Query Optimizer ===")
from federated_query_gateway.core.query_optimizer import QueryOptimizer

optimizer = QueryOptimizer({"users": "parquet_data", "orders": "parquet_data"})
print("QueryOptimizer initialized successfully")

optimized = optimizer.parse_and_optimize("SELECT * FROM users WHERE age > 25")
print(f"Parsed SQL successfully")
print(f"Tables: {[t.name for t in optimized.tables]}")
print(f"Pushdown queries: {optimized.pushdown_queries}")

print("\n=== Testing Join Engine ===")
from federated_query_gateway.core.join_engine import JoinEngine

join_engine = JoinEngine(handler)
print("JoinEngine initialized successfully")

print("\n=== ALL TESTS PASSED ===")
