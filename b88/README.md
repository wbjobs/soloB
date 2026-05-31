# Federation Query Gateway - 联邦查询网关

类似 Presto 的轻量级联邦查询网关，支持同时查询 MySQL、PostgreSQL、MongoDB 和 Parquet 文件。

## 功能特性

1. **Apache Arrow 内存列式格式** - 使用 Apache Arrow 作为内存数据格式，减少序列化开销
2. **SQL 解析与查询下推优化** - 支持标准 SQL 查询，过滤条件自动下推到各数据源
3. **跨数据源 Join** - 支持 MySQL、PostgreSQL、MongoDB、Parquet 之间的跨源 Join
4. **HTTP API 和 gRPC 双接口** - 同时提供 RESTful HTTP API 和高性能 gRPC 接口
5. **LRU 缓存策略** - 高频查询结果自动缓存，存储 Arrow 格式
6. **流式查询结果** - 支持流式返回查询结果，避免 OOM

## 项目结构

```
federated_query_gateway/
├── core/
│   ├── __init__.py
│   ├── arrow_handler.py      # Apache Arrow 处理核心
│   ├── query_optimizer.py    # SQL 解析与查询优化器
│   ├── join_engine.py        # 跨数据源 Join 引擎
│   ├── cache.py              # LRU 缓存实现
│   ├── streaming.py          # 流式处理模块
│   └── query_engine.py       # 查询执行引擎（核心）
├── connectors/
│   ├── __init__.py
│   ├── base.py               # 连接器基类
│   ├── mysql_connector.py    # MySQL 连接器
│   ├── postgresql_connector.py  # PostgreSQL 连接器
│   ├── mongodb_connector.py  # MongoDB 连接器
│   └── parquet_connector.py  # Parquet 文件连接器
├── api/
│   ├── __init__.py
│   ├── http_api.py           # FastAPI HTTP 接口
│   └── grpc_server.py        # gRPC 服务
└── proto/
    └── query.proto           # gRPC Protocol Buffer 定义
```

## 安装依赖

```bash
pip install -r requirements.txt
```

## 配置

编辑 `config.yaml` 配置数据源：

```yaml
server:
  http_port: 8000
  grpc_port: 50051
  host: "0.0.0.0"

datasources:
  mysql:
    - name: "mysql_db1"
      host: "localhost"
      port: 3306
      user: "root"
      password: "password"
      database: "test_db"
  
  postgresql:
    - name: "pg_db1"
      host: "localhost"
      port: 5432
      user: "postgres"
      password: "password"
      database: "test_db"
  
  mongodb:
    - name: "mongo_db1"
      host: "localhost"
      port: 27017
      user: ""
      password: ""
      database: "test_db"
  
  parquet:
    - name: "parquet_data"
      path: "./data/parquet"

cache:
  enabled: true
  lru_max_size: 100
  ttl_seconds: 3600
  memory_limit_mb: 512

query:
  timeout_seconds: 300
  max_rows_per_batch: 10000
  enable_pushdown: true
  enable_join_optimization: true
```

## 启动服务

### 启动 HTTP 服务

```bash
# 方式1: 使用主入口
python main.py --mode http

# 方式2: 直接使用 uvicorn
uvicorn federated_query_gateway.api.http_api:app --host 0.0.0.0 --port 8000
```

### 启动 gRPC 服务

```bash
python main.py --mode grpc
```

### 同时启动 HTTP 和 gRPC 服务

```bash
python main.py --mode both
```

## HTTP API 文档

启动后访问 `http://localhost:8000/docs` 查看 Swagger API 文档。

### 主要接口

1. **POST /api/v1/query** - 执行 SQL 查询
   ```json
   {
     "sql": "SELECT * FROM users WHERE age > 25",
     "use_cache": true
   }
   ```

2. **POST /api/v1/query/stream** - 流式执行 SQL 查询
   ```json
   {
     "sql": "SELECT * FROM large_table",
     "batch_size": 10000
   }
   ```

3. **POST /api/v1/validate** - 验证 SQL 查询
   ```json
   {
     "sql": "SELECT * FROM users"
   }
   ```

4. **GET /api/v1/tables** - 获取所有数据表
5. **GET /api/v1/schema/{table_name}** - 获取表结构
6. **GET /api/v1/cache/stats** - 获取缓存统计
7. **POST /api/v1/cache/invalidate** - 清空缓存
8. **GET /api/v1/health** - 健康检查

## gRPC 使用示例

```python
import grpc
import query_pb2
import query_pb2_grpc

channel = grpc.insecure_channel('localhost:50051')
stub = query_pb2_grpc.QueryServiceStub(channel)

# 执行查询
response = stub.ExecuteQuery(query_pb2.QueryRequest(
    sql="SELECT * FROM users",
    use_cache=True
))

# 流式查询
for batch in stub.ExecuteQueryStream(query_pb2.QueryRequest(
    sql="SELECT * FROM large_table",
    batch_size=10000
)):
    print(f"Received batch with {batch.row_count} rows")
```

## Python SDK 使用示例

```python
from federated_query_gateway.core.query_engine import QueryEngine

# 初始化查询引擎
with QueryEngine() as engine:
    # 执行 SQL 查询
    result = engine.execute("SELECT * FROM users WHERE age > 25")
    
    # 转换为 Python 对象
    data = engine.arrow_handler.from_arrow_table(result)
    
    # 流式查询
    for batch in engine.execute_streaming("SELECT * FROM large_table", batch_size=10000):
        print(f"Processing {batch.num_rows} rows")
    
    # 获取缓存统计
    print(engine.get_cache_stats())
```

## 示例运行

```bash
# 生成示例数据并运行示例
python example_usage.py
```

## 跨数据源 Join 示例

```sql
-- Join Parquet 表 (users) 和 MySQL 表 (orders)
SELECT u.name, o.product, o.amount
FROM parquet_data.users u
JOIN mysql_db1.orders o ON u.id = o.user_id
WHERE u.age > 25
```

## 生成 gRPC Python 代码

```bash
python -m grpc_tools.protoc -I./proto --python_out=./proto --grpc_python_out=./proto ./proto/query.proto
```

## 技术栈

- **Apache Arrow** - 内存列式数据格式
- **SQLGlot** - SQL 解析与转换
- **FastAPI** - HTTP API 框架
- **gRPC** - 高性能 RPC 框架
- **PyMySQL** - MySQL 驱动
- **psycopg2-binary** - PostgreSQL 驱动
- **pymongo** - MongoDB 驱动
- **pyarrow** - Parquet 文件处理

## 注意事项

1. 确保已安装所有依赖
2. 配置文件中的数据库连接信息需要正确
3. Parquet 文件需要放在配置的路径下
4. 跨数据源 Join 会将数据加载到内存进行处理，注意内存使用
5. 使用流式查询处理大数据量结果

## License

MIT License
