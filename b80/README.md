# HTTP Flow Analyzer

基于 eBPF 的 HTTP 请求实时监控与可视化系统。

## 架构

- **eBPF Agent** (Go): 使用 eBPF hook 内核 tcp_sendmsg/tcp_recvmsg，解析 HTTP 请求并上报数据
- **Backend** (Node.js + InfluxDB): 接收上报数据并存储到时序数据库，提供查询 API 和 WebSocket 实时推送
- **Frontend** (React + ECharts): 实时展示请求拓扑、延迟趋势、慢请求列表

## 快速开始

### 前置要求

- Linux 内核 4.16+ (支持 eBPF)
- Docker & Docker Compose
- Go 1.21+ (手动编译 eBPF Agent)
- 根权限 (运行 eBPF 程序)

### 使用 Docker Compose 启动后端和前端

```bash
# 启动 InfluxDB、后端、前端
docker-compose up -d

# 查看日志
docker-compose logs -f
```

### 编译并运行 eBPF Agent

```bash
cd ebpf-agent

# 编译
make build

# 运行 (需要 root 权限)
sudo ./http-tracer

# 指定后端地址
sudo ./http-tracer -backend http://localhost:3000/api/events

# 按 PID 过滤
sudo ./http-tracer -pid 1234
```

### 访问前端

打开浏览器访问: http://localhost:3001

## 手动启动各组件

### 1. 启动 InfluxDB

```bash
docker run -d \
  -p 8086:8086 \
  -v influxdb_data:/var/lib/influxdb2 \
  -e DOCKER_INFLUXDB_INIT_MODE=setup \
  -e DOCKER_INFLUXDB_INIT_USERNAME=admin \
  -e DOCKER_INFLUXDB_INIT_PASSWORD=password123 \
  -e DOCKER_INFLUXDB_INIT_ORG=my-org \
  -e DOCKER_INFLUXDB_INIT_BUCKET=http-events \
  -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=my-token \
  influxdb:2.7
```

### 2. 启动后端

```bash
cd backend
npm install
npm start
```

### 3. 启动前端

```bash
cd frontend
npm install
npm start
```

## 功能特性

- ✅ 实时抓取 HTTP 请求（URL、方法、状态码、延迟、请求体大小）
- ✅ 按进程 PID 过滤
- ✅ 请求拓扑图 (进程-端点关系)
- ✅ 平均延迟趋势图
- ✅ 慢请求列表 (Top 50)
- ✅ 实时事件流
- ✅ WebSocket 实时数据推送
- ✅ 深色主题 UI

## API 端点

- `POST /api/events` - 上报 HTTP 事件
- `GET /api/events` - 查询 HTTP 事件
- `GET /api/stats/latency-trend` - 延迟趋势数据
- `GET /api/stats/slow-requests` - 慢请求数据
- `GET /api/stats/topology` - 拓扑图数据
- `GET /api/health` - 健康检查

## 项目结构

```
.
├── ebpf-agent/          # Go eBPF 抓包工具
│   ├── http_trace.bpf.c # eBPF C 代码
│   ├── main.go          # Go 主程序
│   ├── go.mod
│   └── Makefile
├── backend/             # Node.js 后端
│   ├── server.js        # 主服务
│   ├── package.json
│   └── Dockerfile
├── frontend/            # React 前端
│   ├── src/
│   │   ├── components/  # React 组件
│   │   └── App.js
│   ├── package.json
│   ├── Dockerfile
│   └── nginx.conf
├── docker-compose.yml
└── README.md
```

## 注意事项

1. **eBPF 程序需要 root 权限运行**
2. **仅支持 Linux 系统** (eBPF 技术限制)
3. **内核版本建议 5.4+** 以获得最佳兼容性
4. **生产环境请修改默认密码和 token**
