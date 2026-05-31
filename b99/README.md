# 冷链监控数据处理服务

一个高性能的冷链物流温湿度监控数据处理服务，支持物联网设备数据接入、实时压缩、异常检测和数据回溯。

## 功能特性

1. **物联网数据接入**：接收 5000+ 设备每 10 秒上报的温湿度时间序列数据
2. **Douglas-Peucker 算法压缩**：在线数据压缩，保留温度突变关键点
3. **TimescaleDB 时序存储**：高效存储和查询时序数据
4. **智能异常检测**：
   - 温度连续超标检测
   - 传感器离线检测
   - 数据跳变检测
5. **虚拟探针 (Virtual Probe)**：
   - 设备离线后重新上线时，根据离线前后数据生成虚拟温度曲线
   - 线性插值 + 卡尔曼滤波算法优化预测
   - 精确追溯离线期间实际故障时间
   - 虚拟数据标记存储，支持数据连续性
6. **轨迹重放系统**：
   - Web 可视化界面，基于 ECharts
   - 支持 1x、10x、50x、100x 倍速回放
   - 同步显示温湿度曲线和 GPS 轨迹地图
   - 异常事件高亮标记
   - 播放、暂停、拖拽进度条控制
   - 虚拟数据标识显示
7. **数据回溯 API**：按时间范围和 GPS 围栏查询异常片段及上下文（前后 30 分钟数据）
8. **gRPC + HTTP 双协议**：高性能 RPC 接口 + Web 服务

## 项目结构

```
coldchain-monitor/
├── src/
│   ├── index.ts              # 主入口文件
│   ├── config.ts             # 配置管理
│   ├── types.ts              # 类型定义
│   ├── database.ts           # 数据库操作
│   ├── compression.ts        # Douglas-Peucker 压缩算法
│   ├── anomalyDetector.ts    # 异常检测模块
│   └── grpcServer.ts         # gRPC 服务
├── proto/
│   └── coldchain.proto       # gRPC 协议定义
├── sql/
│   └── init.sql              # 数据库初始化脚本
├── package.json
├── tsconfig.json
└── .env                      # 环境配置
```

## 环境要求

- Node.js >= 18.0.0
- PostgreSQL >= 14.0
- TimescaleDB >= 2.0
- TypeScript >= 5.0

## 安装步骤

1. **安装依赖**：
```bash
npm install
```

2. **数据库准备**：
```sql
-- 创建数据库
CREATE DATABASE coldchain;

-- 连接到数据库
\c coldchain

-- 执行初始化脚本
\i sql/init.sql
```

3. **配置环境变量**：
```bash
cp .env.example .env
# 编辑 .env 文件，配置数据库连接和其他参数
```

4. **编译 TypeScript**：
```bash
npm run build
```

5. **启动服务**：
```bash
npm start
```

开发模式（自动重启）：
```bash
npm run dev
```

## 配置说明

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| PORT | gRPC 服务端口 | 50051 |
| HTTP_PORT | HTTP Web 服务端口 | 3000 |
| DB_HOST | 数据库地址 | localhost |
| DB_PORT | 数据库端口 | 5432 |
| DB_NAME | 数据库名 | coldchain |
| DB_USER | 数据库用户 | postgres |
| DB_PASSWORD | 数据库密码 | postgres |
| TEMPERATURE_THRESHOLD | 温度阈值(°C) | -18 |
| TEMPERATURE_MAX_JUMP | 最大温度跳变(°C) | 5 |
| OFFLINE_THRESHOLD_SECONDS | 离线阈值(秒) | 300 |
| COMPRESSION_EPSILON | 压缩精度参数 | 0.5 |
| VIRTUAL_PROBE_MIN_INTERVAL | 虚拟探针最小间隔(秒) | 60 |

## 轨迹重放系统使用

### 1. 生成测试数据

```bash
npm run generate:testdata
```

### 2. 启动服务

```bash
npm run build && npm start
```

### 3. 访问 Web 界面

打开浏览器访问：http://localhost:3000

### 4. 操作说明

1. **选择设备**：在下拉菜单中选择要查看的设备
2. **选择时间范围**：设置开始和结束时间
3. **加载数据**：点击"📊 加载数据"按钮
4. **控制播放**：
   - ▶ 播放：开始自动播放
   - ⏸ 暂停：暂停播放
   - ↺ 重置：回到起始位置
5. **调整倍速**：点击 1x、10x、50x、100x 按钮调整播放速度
6. **拖动进度条**：直接跳转到指定时间点

### 5. 界面说明

- **左侧地图**：显示 GPS 运输轨迹
- **右侧图表**：温湿度变化曲线，红色虚线为温度阈值
- **信息面板**：显示当前温度、湿度、数据点数、异常事件数
- **异常告警**：检测到的异常事件列表

## gRPC API 接口

### 1. SubmitData - 单条数据上报

```protobuf
rpc SubmitData(SubmitDataRequest) returns (SubmitDataResponse);
```

**请求参数**：
```protobuf
message SensorData {
  string device_id = 1;
  int64 timestamp = 2;
  double temperature = 3;
  double humidity = 4;
  double latitude = 5;
  double longitude = 6;
  int32 battery = 7;
}
```

### 2. BatchSubmitData - 批量数据上报

```protobuf
rpc BatchSubmitData(BatchSubmitDataRequest) returns (BatchSubmitDataResponse);
```

### 3. QueryAnomalies - 查询异常

```protobuf
rpc QueryAnomalies(QueryAnomaliesRequest) returns (QueryAnomaliesResponse);
```

**请求参数**：
- `device_id`: 设备 ID（可选）
- `start_time`/`end_time`: 时间范围
- `min_lat`/`max_lat`/`min_lng`/`max_lng`: GPS 围栏范围
- `anomaly_types`: 异常类型过滤
- `context_minutes`: 上下文数据分钟数（默认 30）

### 4. GetDeviceStatus - 获取设备状态

```protobuf
rpc GetDeviceStatus(GetDeviceStatusRequest) returns (GetDeviceStatusResponse);
```

## 异常类型说明

| 异常类型 | 说明 |
|---------|------|
| TEMPERATURE_JUMP | 温度突变 |
| TEMPERATURE_EXCEED_START | 温度开始超标 |
| TEMPERATURE_EXCEED_CONTINUOUS | 温度持续超标 |
| TEMPERATURE_EXCEED_END | 温度恢复正常 |
| DEVICE_OFFLINE | 设备离线 |

## 性能优化

1. **批量写入**：使用批量插入减少数据库连接开销
2. **数据压缩**：Douglas-Peucker 算法可将数据压缩 70%-90%
3. **索引优化**：TimescaleDB 索引加速时间范围查询
4. **内存缓冲**：设备数据缓冲，批量压缩和存储

## 监控与运维

- 日志输出：标准输出，建议配合 ELK/Loki 采集
- 健康检查：可通过 gRPC 健康检查协议扩展
- 数据清理：建议配置 TimescaleDB 数据保留策略

## 许可证

MIT
