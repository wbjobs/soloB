import pyarrow as pa
from federated_query_gateway.core.query_engine import QueryEngine
from federated_query_gateway.core.arrow_handler import ArrowHandler
from federated_query_gateway.connectors.parquet_connector import ParquetConnector
import os


def create_sample_data():
    arrow_handler = ArrowHandler()
    
    users_data = [
        {"id": 1, "name": "Alice", "age": 30, "city": "New York"},
        {"id": 2, "name": "Bob", "age": 25, "city": "London"},
        {"id": 3, "name": "Charlie", "age": 35, "city": "Paris"},
        {"id": 4, "name": "Diana", "age": 28, "city": "Tokyo"},
    ]
    
    orders_data = [
        {"id": 1, "user_id": 1, "product": "Laptop", "amount": 999.99},
        {"id": 2, "user_id": 1, "product": "Mouse", "amount": 29.99},
        {"id": 3, "user_id": 2, "product": "Keyboard", "amount": 59.99},
        {"id": 4, "user_id": 3, "product": "Monitor", "amount": 299.99},
    ]
    
    users_table = arrow_handler.to_arrow_table(users_data)
    orders_table = arrow_handler.to_arrow_table(orders_data)
    
    os.makedirs('./data/parquet', exist_ok=True)
    
    connector = ParquetConnector({'path': './data/parquet'})
    connector.write_table(users_table, 'users')
    connector.write_table(orders_table, 'orders')
    
    print("Sample data created successfully!")
    return arrow_handler, users_table, orders_table


def example_query():
    print("\n=== Example Query Execution ===")
    
    engine = QueryEngine()
    
    print("\n1. Query users table:")
    result = engine.execute("SELECT * FROM users")
    print(f"Rows: {result.num_rows}")
    for batch in result.to_batches():
        print(batch.to_pylist())
    
    print("\n2. Query with filter:")
    result = engine.execute("SELECT * FROM users WHERE age > 25")
    print(f"Rows: {result.num_rows}")
    for batch in result.to_batches():
        print(batch.to_pylist())
    
    print("\n3. Streaming query:")
    for batch in engine.execute_streaming("SELECT * FROM users", batch_size=2):
        print(f"Batch with {batch.num_rows} rows")
        print(batch.to_pylist())
    
    engine.close()


def example_cache():
    print("\n=== Example Cache Usage ===")
    
    engine = QueryEngine()
    
    print("First query (not cached):")
    result1 = engine.execute("SELECT * FROM users")
    print(f"Rows: {result1.num_rows}")
    
    print("\nSecond query (cached):")
    result2 = engine.execute("SELECT * FROM users")
    print(f"Rows: {result2.num_rows}")
    
    print("\nCache stats:")
    print(engine.get_cache_stats())
    
    engine.close()


def example_arrow_operations():
    print("\n=== Example Arrow Operations ===")
    
    arrow_handler = ArrowHandler()
    
    data = [
        {"id": 1, "name": "Test1", "value": 100},
        {"id": 2, "name": "Test2", "value": 200},
    ]
    
    table = arrow_handler.to_arrow_table(data)
    print(f"Created table with {table.num_rows} rows")
    print(f"Schema: {table.schema}")
    
    serialized = arrow_handler.serialize_table(table)
    print(f"Serialized size: {len(serialized)} bytes")
    
    deserialized = arrow_handler.deserialize_table(serialized)
    print(f"Deserialized table rows: {deserialized.num_rows}")


if __name__ == '__main__':
    create_sample_data()
    example_arrow_operations()
    example_query()
    example_cache()
