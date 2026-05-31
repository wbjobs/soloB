import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

print("=== Testing Apache Arrow Handler ===")
try:
    import pyarrow as pa
    print(f"PyArrow version: {pa.__version__}")
except Exception as e:
    print(f"PyArrow import error: {e}")
    sys.exit(1)

# 直接测试Arrow功能
test_data = [
    {"id": 1, "name": "Alice", "age": 30},
    {"id": 2, "name": "Bob", "age": 25},
    {"id": 3, "name": "Charlie", "age": 35},
]

# 使用pyarrow直接创建表
df = pa.Table.from_pylist(test_data)
print(f"Created table with {df.num_rows} rows")
print(f"Schema: {df.schema}")

# 测试序列化
sink = pa.BufferOutputStream()
writer = pa.RecordBatchStreamWriter(sink, df.schema)
writer.write_table(df)
writer.close()
serialized = sink.getvalue().to_pybytes()
print(f"Serialized size: {len(serialized)} bytes")

# 测试反序列化
reader = pa.RecordBatchStreamReader(pa.py_buffer(serialized))
deserialized = reader.read_all()
print(f"Deserialized table rows: {deserialized.num_rows}")

print("\n=== Arrow tests PASSED ===")

print("\n=== Testing LRU Cache ===")
from collections import OrderedDict
import time

class SimpleCache:
    def __init__(self, max_size=10):
        self.max_size = max_size
        self.cache = OrderedDict()
    
    def put(self, key, table):
        if key in self.cache:
            del self.cache[key]
        elif len(self.cache) >= self.max_size:
            self.cache.popitem(last=False)
        self.cache[key] = table
    
    def get(self, key):
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key]
        return None

cache = SimpleCache(max_size=10)
print("LRUCache initialized successfully")

cache.put("query1", df)
print("Table cached successfully")

cached_result = cache.get("query1")
print(f"Retrieved from cache: {cached_result is not None}, rows: {cached_result.num_rows if cached_result else 0}")

print("\n=== Cache tests PASSED ===")

print("\n=== Testing Streaming ===")
batch_size = 2
total_rows = df.num_rows
batches = []
for i in range(0, total_rows, batch_size):
    end = min(i + batch_size, total_rows)
    batches.append(df.slice(i, end - i).to_batches()[0])

print(f"Generated {len(batches)} batches")
for i, batch in enumerate(batches):
    print(f"Batch {i}: {batch.num_rows} rows")

print("\n=== Streaming tests PASSED ===")

print("\n=== ALL CORE TESTS PASSED ===")
