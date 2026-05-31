# 分布式任务队列监控仪表盘

一个用于监控分布式任务队列（如 Celery 或 RQ）的实时仪表盘系统。

## 项目结构

```
b42/
├── server/                    # 后端服务 (Node.js)
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── index.js          # 主服务入口
│       ├── redisListener.js  # Redis 订阅监听
│       ├── influxdb.js       # InfluxDB 数据存储
│       └── mockGenerator.js  # 模拟数据生成器
└── client/                    # 前端应用 (Vue 3)
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.js
        ├── App.vue
        └── style.css
```

## 技术栈

### 后端
- **Node.js** + **Express** - Web 服务框架
- **Socket.IO** - 实时 WebSocket 通信
- **ioredis** - Redis 客户端
- **@influxdata/influxdb-client** - InfluxDB 数据写入

### 前端
- **Vue 3** - 组件化框架
- **Vite** - 构建工具
- **D3.js** - 数据可视化（有向图）
- **Socket.IO Client** - WebSocket 客户端

## 功能特性

### 实时监控
- 监听 Redis 频道中的任务状态更新
- WebSocket 实时广播到所有连接的客户端
- 支持任务状态：PENDING, STARTED, SUCCESS, FAILURE, RETRY, REVOKED

### 可视化仪表盘
- **统计卡片**：Worker 总数、忙碌/空闲/离线状态、任务成功率
- **有向图**：D3.js 力导向图，节点代表 Worker，边代表任务流转
- **Worker 列表**：显示每个 Worker 的详细状态和统计
- **最近任务**：实时任务事件流

### 数据存储
- 所有任务状态变更事件写入 InfluxDB
- 支持历史数据分析
- Worker 心跳事件追踪

## 安装与运行

### 前置要求
- Node.js >= 16
- Redis 服务器
- InfluxDB 2.x（可选，用于历史数据存储）

### 1. 安装依赖

```bash
# 后端依赖
cd server
npm install

# 前端依赖
cd ../client
npm install
```

### 2. 配置环境变量

复制后端的 `.env.example` 为 `.env` 并根据实际情况修改：

```bash
cd server
cp .env.example .env
```

环境变量说明：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| PORT | 后端服务端口 | 3000 |
| REDIS_HOST | Redis 主机 | localhost |
| REDIS_PORT | Redis 端口 | 6379 |
| REDIS_PASSWORD | Redis 密码 | 空 |
| REDIS_CHANNEL | Redis 监听频道 | celery-task-monitor |
| INFLUXDB_URL | InfluxDB 地址 | http://localhost:8086 |
| INFLUXDB_TOKEN | InfluxDB Token | - |
| INFLUXDB_ORG | InfluxDB 组织 | - |
| INFLUXDB_BUCKET | InfluxDB Bucket | task-monitor |

### 3. 启动服务

确保 Redis 服务已运行：

```bash
# 方式一：使用 Docker
docker run -p 6379:6379 redis

# 方式二：本地启动
redis-server
```

#### 启动后端服务

```bash
cd server
npm start
```

#### 启动前端服务

```bash
cd client
npm run dev
```

访问 http://localhost:5173 查看仪表盘。

### 4. 使用模拟数据（测试）

如果没有实际的 Celery/RQ 任务队列，可以使用模拟数据生成器：

```bash
cd server
node src/mockGenerator.js
```

这会自动生成 4 个 Worker 和随机任务事件，方便测试仪表盘功能。

## 事件格式

Celery/RQ 集成需要将任务事件发布到 Redis 频道，支持以下格式：

### Worker 事件

```json
{
  "type": "worker-online",
  "workerId": "worker-1",
  "workerName": "Worker Alpha",
  "queue": "default",
  "timestamp": 1715300000000
}
```

### 任务状态事件

```json
{
  "status": "STARTED",
  "taskId": "task-abc123",
  "taskName": "process_image",
  "workerId": "worker-1",
  "queue": "default",
  "timestamp": 1715300000000,
  "duration": 2500,
  "error": null
}
```

支持的任务状态：
- `PENDING` - 任务已入队
- `STARTED` - 任务开始执行
- `SUCCESS` - 任务执行成功
- `FAILURE` - 任务执行失败
- `RETRY` - 任务重试
- `REVOKED` - 任务被取消

## Celery 集成示例

在 Celery 中，可以通过信号（signals）将事件发送到 Redis：

```python
import redis
import json
from celery import signals

redis_client = redis.Redis(host='localhost', port=6379)
CHANNEL = 'celery-task-monitor'

@signals.task_prerun.connect
def on_task_started(sender, task_id, task, *args, **kwargs):
    event = {
        'status': 'STARTED',
        'taskId': task_id,
        'taskName': task.name,
        'workerId': sender.request.hostname,
        'queue': sender.request.delivery_info.get('exchange', 'default'),
        'timestamp': int(time.time() * 1000)
    }
    redis_client.publish(CHANNEL, json.dumps(event))

@signals.task_postrun.connect
def on_task_done(sender, task_id, task, retval, state, *args, **kwargs):
    event = {
        'status': 'SUCCESS' if state == 'SUCCESS' else 'FAILURE',
        'taskId': task_id,
        'taskName': task.name,
        'workerId': sender.request.hostname,
        'queue': sender.request.delivery_info.get('exchange', 'default'),
        'timestamp': int(time.time() * 1000)
    }
    redis_client.publish(CHANNEL, json.dumps(event))
```

## API 端点

后端提供以下 REST API：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查和统计信息 |
| `/api/workers` | GET | 获取所有 Worker 列表 |
| `/api/tasks/recent?limit=50` | GET | 获取最近任务历史 |
| `/api/stats` | GET | 获取系统统计数据 |

## InfluxDB 数据模型

### task_events 测量

| Tag | Field | 说明 |
|-----|-------|------|
| task_id | task_id | 任务 ID |
| worker_id | worker_id | Worker ID |
| task_name | task_name | 任务名称 |
| status | status | 任务状态 |
| queue | duration_ms | 执行耗时（毫秒） |
| - | error | 错误信息 |

### worker_events 测量

| Tag | Field | 说明 |
|-----|-------|------|
| worker_id | worker_id | Worker ID |
| status | status | Worker 状态 |
| queue | - | 队列名称 |

## 开发模式

### 后端热重载

```bash
cd server
npm run dev
```

### 前端开发模式

前端开发模式已配置代理，自动转发 `/socket.io` 和 `/api` 请求到后端。

## 构建生产版本

```bash
cd client
npm run build
```

构建产物在 `client/dist` 目录，可以部署到任何静态文件服务器。

## 许可证

MIT License
