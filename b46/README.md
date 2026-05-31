# Nonlinear Curve Fitting Microservice

一个用于实验数据非线性曲线拟合的微服务系统。

## 架构概述

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   FastAPI API   │────>│   Redis Queue   │────>│   RQ Worker     │
│  (Python)       │     │                 │     │  (Python/C++)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                                              │
         └────────────────── /fit, /result ──────────────┘
```

## 项目结构

```
b46/
├── cpp/                          # C++ 核心计算库
│   ├── levenberg_marquardt.h    # 头文件
│   ├── levenberg_marquardt.cpp  # 实现文件
│   └── CMakeLists.txt           # CMake 构建配置
├── python/                       # Python 服务层
│   ├── __init__.py
│   ├── main.py                  # FastAPI 主服务
│   ├── worker.py                # RQ Worker
│   └── lm_wrapper.py            # C++ 库 Python 封装
├── requirements.txt             # Python 依赖
└── README.md
```

## 功能特性

1. **Levenberg-Marquardt 算法**: 使用 C++ 实现高效的非线性最小二乘拟合
2. **动态函数表达式**: 支持自定义函数形式（如 `a * exp(-b * x) + c`）
3. **异步任务队列**: 使用 Redis + RQ 处理耗时的拟合任务
4. **RESTful API**: FastAPI 提供简洁的 HTTP 接口
5. **跨平台支持**: Windows (.dll) / Linux (.so) / macOS (.dylib)

## 支持的函数语法

### 变量
- `x`: 自变量
- `a, b, c, d, e`: 待拟合参数（最多5个）

### 运算
- `+`, `-`, `*`, `/`, `^` (幂运算)

### 数学函数
- `exp()`, `log()`, `sin()`, `cos()`, `tan()`, `sqrt()`

### 常用示例
```
"a * exp(-b * x) + c"                    # 指数衰减
"a * x^2 + b * x + c"                    # 二次多项式
"a * sin(b * x + c)"                     # 正弦函数
"a / (1 + exp(-b * (x - c)))"            # Logistic 函数
```

## 安装与配置

### 1. 编译 C++ 库

#### Windows
```bash
cd cpp
mkdir build
cd build
cmake .. -G "Visual Studio 17 2022"
cmake --build . --config Release
```

生成的 `levenberg_marquardt.dll` 会在 `cpp/build/Release/` 目录下。

#### Linux
```bash
cd cpp
mkdir build
cd build
cmake ..
make
```

生成的 `liblevenberg_marquardt.so` 会在 `cpp/build/` 目录下。

#### macOS
```bash
cd cpp
mkdir build
cd build
cmake ..
make
```

生成的 `liblevenberg_marquardt.dylib` 会在 `cpp/build/` 目录下。

### 2. 安装 Python 依赖

```bash
pip install -r requirements.txt
```

### 3. 启动 Redis

确保 Redis 服务器运行在 `localhost:6379`

```bash
# 使用 Docker
docker run -d -p 6379:6379 redis

# 或使用本地 Redis
redis-server
```

## 运行服务

### 启动 Worker

```bash
cd b46
python -m python.worker
```

### 启动 API 服务

```bash
cd b46
python -m python.main
```

或使用 uvicorn:

```bash
uvicorn python.main:app --reload --host 0.0.0.0 --port 8000
```

## API 使用

### 1. 提交拟合任务

**POST** `/fit`

请求体:
```json
{
    "x": [0.0, 1.0, 2.0, 3.0, 4.0, 5.0],
    "y": [5.0, 3.5, 2.5, 1.8, 1.3, 1.0],
    "func_expression": "a * exp(-b * x) + c",
    "initial_params": [1.0, 0.5, 1.0]
}
```

响应:
```json
{
    "task_id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "queued",
    "message": "Task has been queued successfully. Use /result/{task_id} to check status."
}
```

### 2. 查询任务结果

**GET** `/result/{task_id}`

处理中:
```json
{
    "task_id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "processing",
    "result": null,
    "error_message": null
}
```

完成:
```json
{
    "task_id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "finished",
    "result": {
        "status": "completed",
        "timestamp": "2024-01-01T00:00:00.000000",
        "success": true,
        "params": [4.0, 0.5, 1.0],
        "chi_squared": 0.00123,
        "iterations": 15,
        "error_message": ""
    },
    "error_message": null
}
```

### 3. 健康检查

**GET** `/health`

响应:
```json
{
    "status": "healthy",
    "timestamp": "2024-01-01T00:00:00.000000"
}
```

## 使用示例

### cURL

```bash
# 提交任务
curl -X POST http://localhost:8000/fit \
  -H "Content-Type: application/json" \
  -d '{
    "x": [0, 1, 2, 3, 4, 5],
    "y": [5, 3.5, 2.5, 1.8, 1.3, 1],
    "func_expression": "a * exp(-b * x) + c",
    "initial_params": [1, 0.5, 1]
  }'

# 查询结果
curl http://localhost:8000/result/your-task-id
```

### Python

```python
import requests
import time

# 提交任务
response = requests.post(
    "http://localhost:8000/fit",
    json={
        "x": [0, 1, 2, 3, 4, 5],
        "y": [5, 3.5, 2.5, 1.8, 1.3, 1],
        "func_expression": "a * exp(-b * x) + c",
        "initial_params": [1, 0.5, 1]
    }
)
task_id = response.json()["task_id"]

# 轮询结果
while True:
    result = requests.get(f"http://localhost:8000/result/{task_id}").json()
    if result["status"] == "finished":
        print("拟合结果:", result["result"])
        break
    elif result["status"] == "failed":
        print("任务失败:", result.get("error_message"))
        break
    time.sleep(0.5)
```

## 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `REDIS_URL` | `redis://localhost:6379/0` | Redis 连接地址 |

## 注意事项

1. **初始参数**: 提供合适的初始参数可以显著提高拟合成功率和速度
2. **数据点数量**: 至少需要 3 个数据点
3. **参数数量**: 最多支持 5 个参数 (a, b, c, d, e)
4. **库文件位置**: Python 会自动在以下位置查找编译好的库:
   - `cpp/build/Release/`
   - `cpp/build/`
   - `cpp/`
   - `libs/`

## 故障排除

### 问题: 找不到动态链接库
**解决**: 确保已按照说明编译 C++ 库，并将生成的 DLL/SO 文件放在 Python 能找到的位置。

### 问题: Redis 连接失败
**解决**: 确保 Redis 服务器正在运行，检查 `REDIS_URL` 环境变量。

### 问题: 拟合失败或结果不好
**解决**: 
- 检查函数表达式语法是否正确
- 尝试提供更合理的初始参数
- 确保数据点足够多且分布合理

## 技术栈

- **C++17**: 核心算法实现
- **CMake**: C++ 构建系统
- **Python 3.8+**: 服务层
- **FastAPI**: Web 框架
- **Redis**: 消息队列
- **RQ (Redis Queue)**: 任务队列
