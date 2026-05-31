# Industrial IoT Hub

工业物联网后端系统，通过MQTT协议接入大量智能电表，实现实时数据聚合、异常检测和RESTful API查询。

## 功能特性

### 1. 高并发MQTT数据接入层
- 基于Go语言和Goroutine实现高并发消息消费
- 支持200个工作线程并行处理消息
- 批量写入数据库，优化性能
- 自动重连和错误恢复机制

### 2. 实时数据聚合
- 5分钟时间窗口聚合
- 计算电压最小值、最大值、平均值、标准差
- 计算电压波动率（最大值-最小值）
- 功率因数平均值统计
- 内存缓冲+异步落盘机制

### 3. 孤立森林异常检测
- 基于Isolation Forest算法的实时异常检测
- 支持4维特征：电压、电流、功率因数、THD（总谐波失真）
- 定期使用最新数据重新训练模型
- 异常类型分类：电压异常、低功率因数、高THD、其他异常模式
- 检测到异常时触发Webhook回调

### 4. RESTful API接口
- `/api/v1/health` - 健康检查
- `/api/v1/meters/{meter_id}/aggregated` - 查询聚合数据
- `/api/v1/meters/{meter_id}/readings` - 查询原始读数
- `/api/v1/anomalies` - 查询所有异常事件
- `/api/v1/anomalies/{meter_id}` - 查询指定电表的异常事件
- `/api/v1/webhook` - Webhook接收端点（示例）

### 5. TimescaleDB时序数据库
- 基于PostgreSQL + TimescaleDB扩展
- 超表（Hypertable）优化时序数据存储和查询
- 90天数据自动保留策略
- 批量插入优化（CopyFrom）
- 自动创建索引优化查询性能

### 6. 智能电表模拟器
- 支持1000+虚拟电表并行仿真
- 每10秒上报一次数据（可配置）
- 数据包含：电压、电流、功率因数、THD
- 0.5%概率注入异常数据用于测试

### 7. LSTM负荷预测功能 (新增)
- **基于LSTM神经网络的时间序列预测**
- 7天历史数据训练，预测未来1小时负荷
- 15分钟粒度预测，共4个预测点
- 每15分钟自动重新预测，保持结果时效性
- 支持按电表订阅，WebSocket实时推送
- 置信度评估，量化预测不确定性

**详细文档**: 见 [PREDICTION_README.md](file:///e:/soloB/b82/PREDICTION_README.md)

## 技术栈

- **语言**: Go 1.21
- **MQTT Broker**: Eclipse Mosquitto 2.0
- **数据库**: PostgreSQL 15 + TimescaleDB 2.13
- **Web框架**: Gin
- **WebSocket**: Gorilla WebSocket
- **机器学习**: 自研LSTM神经网络实现
- **MQTT客户端**: Eclipse Paho
- **容器化**: Docker & Docker Compose

## 快速开始

### 使用Docker Compose启动

```bash
# 启动所有服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

### 手动构建运行

#### 1. 启动依赖服务

```bash
# 启动PostgreSQL+TimescaleDB
docker run -d --name timescaledb -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres \
  timescale/timescaledb:2.13.0-pg15

# 启动Mosquitto MQTT Broker
docker run -d --name mosquitto -p 1883:1883 \
  eclipse-mosquitto:2.0.18
```

#### 2. 运行IoT Hub服务

```bash
cd cmd/server
go run main.go
```

#### 3. 运行电表模拟器

```bash
cd simulator
go run simulator.go
```

## API使用示例

### 健康检查
```bash
curl http://localhost:8080/api/v1/health
```

### 查询聚合数据
```bash
curl "http://localhost:8080/api/v1/meters/meter-0001/aggregated?start=2024-01-01T00:00:00Z&end=2024-01-02T00:00:00Z"
```

### 查询异常事件
```bash
curl "http://localhost:8080/api/v1/anomalies?start=2024-01-01T00:00:00Z&end=2024-01-02T00:00:00Z"
```

### 查询原始读数
```bash
curl "http://localhost:8080/api/v1/meters/meter-0001/readings?limit=100"
```

## 配置说明

配置文件位于 `configs/config.yaml`：

```yaml
mqtt:
  broker: "tcp://localhost:1883"
  topic: "meters/+/data"

database:
  host: "localhost"
  port: 5432
  user: "postgres"
  password: "postgres"
  dbname: "iiothub"
  retention_days: 90

aggregation:
  window_minutes: 5

anomaly_detection:
  enabled: true
  threshold: 0.7
  num_trees: 100
  sample_size: 256
  webhook_url: "http://localhost:8080/api/v1/webhook"

api:
  port: 8080

simulator:
  num_meters: 1000
  interval_ms: 10000
```

## 项目结构

```
iiothub/
├── cmd/
│   └── server/
│       └── main.go          # 主服务入口
├── internal/
│   ├── mqtt/
│   │   └── consumer.go      # MQTT消费者
│   ├── database/
│   │   └── database.go      # 数据库操作
│   ├── aggregation/
│   │   └── aggregator.go    # 实时聚合引擎
│   ├── anomaly/
│   │   └── isolation_forest.go  # 孤立森林异常检测
│   └── api/
│       └── server.go        # REST API服务
├── pkg/
│   └── models/
│       └── models.go        # 数据模型定义
├── simulator/
│   └── simulator.go         # 电表模拟器
├── configs/
│   ├── config.yaml          # 配置文件
│   └── mosquitto.conf       # Mosquitto配置
├── docker-compose.yml       # Docker Compose配置
├── Dockerfile               # 服务Dockerfile
├── Dockerfile.simulator     # 模拟器Dockerfile
├── go.mod
└── go.sum
```

## 架构设计

### 数据流程
```
MQTT消息 → MQTT消费者 → 批量写入器 → TimescaleDB
                        ↓
                    聚合引擎 → 5分钟窗口数据
                        ↓
                    异常检测器 → 异常事件 → Webhook
                        ↓
                    REST API → 查询接口
```

### 关键设计决策
1. **批量写入**: 使用PostgreSQL COPY协议批量插入，大幅提升写入吞吐量
2. **工作池模式**: 限制并发Goroutine数量，避免资源耗尽
3. **内存聚合**: 窗口数据在内存中聚合，定期落盘
4. **异步检测**: 异常检测在独立Goroutine中运行，不阻塞主流程
5. **超表优化**: TimescaleDB超表按时间自动分区，提升查询性能

## 性能指标

在标准配置下，系统可支持：
- 1000+并发电表接入
- 每秒100+条消息处理
- 数据写入延迟 < 100ms
- API查询响应时间 < 500ms

## 许可证

MIT License
