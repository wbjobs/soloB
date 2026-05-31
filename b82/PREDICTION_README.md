# 负荷预测功能文档

## 功能概述

本系统实现了基于LSTM（长短期记忆）神经网络的智能电表负荷预测功能。通过分析过去7天的历史数据，预测未来1小时内每15分钟粒度的负荷曲线。预测结果通过WebSocket实时推送给订阅客户端。

## 核心组件

### 1. LSTM预测模型 (`internal/prediction/lstm_model.go`)

**核心特性：**
- 输入窗口大小：96个时间点（对应24小时15分钟粒度数据）
- 隐藏层大小：64个LSTM单元
- 输出步数：4步（预测未来1小时，每15分钟一个点）
- 支持在线学习，使用新数据持续优化模型
- 数据标准化：Z-score normalization

**主要类：**
```go
type LSTMModel struct {
    inputSize    int        // 输入窗口大小
    hiddenSize   int        // LSTM隐藏层大小
    outputSize   int        // 输出预测步数
    // ... 网络权重参数
}

type LoadPredictor struct {
    model       *LSTMModel  // LSTM模型实例
    history     map[string][]HistoricalData  // 各电表历史数据
    windowSize  int        // 历史窗口大小
    predSteps   int        // 预测步数
}
```

### 2. 预测调度器 (`internal/prediction/scheduler.go`)

负责定期执行预测任务：
- 可配置的预测间隔（默认15分钟）
- 并发控制：最多10个并行预测任务
- 自动注册新出现的电表
- 从数据库加载7天历史聚合数据

**主要方法：**
```go
Start()                         // 启动调度器
Stop()                          // 停止调度器
GetPrediction(meterID string)   // 立即获取单次预测
RegisterMeter(meterID string)   // 注册电表进行预测
AddRealTimeReading(reading)     // 添加实时数据到历史库
```

### 3. WebSocket服务 (`internal/websocket/server.go`)

实时推送预测结果：
- 支持多客户端连接
- 按电表ID订阅机制
- 心跳检测和自动重连
- 消息广播优化

**消息格式：**
```json
{
    "type": "prediction_update",
    "meter_id": "meter-0001",
    "time": "2024-01-15T10:30:00Z",
    "payload": {
        "meter_id": "meter-0001",
        "timestamp": "2024-01-15T10:30:00Z",
        "load_values": [45.2, 46.8, 44.5, 43.0],
        "time_labels": ["10:30", "10:45", "11:00", "11:15"],
        "confidence": [0.92, 0.88, 0.85, 0.82]
    }
}
```

## API接口

### REST API

**1. 获取电表预测结果**
```
GET /api/v1/prediction/{meter_id}
```

响应示例：
```json
{
    "meter_id": "meter-0001",
    "timestamp": "2024-01-15T10:30:00Z",
    "prediction_time": "2024-01-15T10:30:00Z",
    "load_values": [45.2, 46.8, 44.5, 43.0],
    "time_labels": ["10:30", "10:45", "11:00", "11:15"],
    "confidence": [0.92, 0.88, 0.85, 0.82]
}
```

**2. 获取已注册电表列表**
```
GET /api/v1/prediction/meters
```

响应示例：
```json
{
    "count": 3,
    "meters": ["meter-0001", "meter-0002", "meter-0003"]
}
```

**3. 注册电表进行预测**
```
POST /api/v1/prediction/meters/{meter_id}
```

**4. 取消注册电表**
```
DELETE /api/v1/prediction/meters/{meter_id}
```

### WebSocket连接

**连接地址：**
```
ws://localhost:8080/api/v1/ws?client_id=your_client_id
```

**订阅消息：**
```json
{
    "type": "subscribe",
    "meter_id": "meter-0001"
}
```

**取消订阅：**
```json
{
    "type": "unsubscribe",
    "meter_id": "meter-0001"
}
```

**心跳检测：**
```json
{
    "type": "ping"
}
```

## 配置参数

在 `configs/config.yaml` 中配置：

```yaml
prediction:
  enabled: true              # 是否启用预测功能
  window_size: 96            # 历史窗口大小（96 = 24小时 x 15分钟）
  prediction_steps: 4        # 预测步数（4 = 未来1小时）
  interval_minutes: 15       # 预测间隔（分钟）
  historical_days: 7         # 使用多少天历史数据
```

## 使用示例

### 1. JavaScript客户端示例

```javascript
const ws = new WebSocket('ws://localhost:8080/api/v1/ws?client_id=webapp');

ws.onopen = () => {
    console.log('Connected to prediction service');
    ws.send(JSON.stringify({ type: 'subscribe', meter_id: 'meter-0001' }));
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'prediction_update') {
        console.log(`Prediction for ${data.meter_id}:`, data.payload);
        updateChart(data.payload);
    }
};

function updateChart(prediction) {
    const labels = prediction.time_labels;
    const values = prediction.load_values;
    // ... 更新图表
}
```

### 2. 使用提供的客户端类

```javascript
const client = new IoTLoadPredictionClient('ws://localhost:8080/api/v1/ws');

client.onPredictionUpdate = (data) => {
    console.log('Prediction:', data.payload);
};

client.connect();
client.subscribe('meter-0001');
```

### 3. REST API调用示例

```bash
# 获取预测结果
curl http://localhost:8080/api/v1/prediction/meter-0001

# 获取已注册电表
curl http://localhost:8080/api/v1/prediction/meters

# 注册新电表
curl -X POST http://localhost:8080/api/v1/prediction/meters/meter-0010

# 取消注册
curl -X DELETE http://localhost:8080/api/v1/prediction/meters/meter-0010
```

## 数据流说明

```
实时数据 → MQTT消费者 → 历史数据缓存
                                ↓
预测调度器(15分钟间隔) → 加载7天聚合数据
                                ↓
                           LSTM模型预测
                                ↓
                           生成预测结果
                                ↓
WebSocket服务 → 广播给所有订阅客户端
```

## 预测精度优化建议

### 1. 数据质量
- 确保原始数据完整性，缺失值不超过5%
- 定期清理异常值（电压、电流超出物理范围的数据）
- 保持数据采集频率稳定

### 2. 模型训练
- 初始训练数据不少于30天
- 季节性数据需要至少1年历史数据
- 定期（每天）使用新数据重新训练

### 3. 参数调优
- 增大window_size提高短期精度
- 减少prediction_steps提高近点精度
- 根据实际使用场景调整预测间隔

### 4. 集成学习
- 可结合ARIMA、Prophet等传统时间序列模型
- 使用加权平均或Stacking方法融合多模型结果
- 异常检测结果作为辅助特征

## 性能指标

- 单电表预测耗时：< 100ms
- 10个并发预测：< 500ms
- 内存占用：每个电表约1MB历史数据
- WebSocket消息延迟：< 50ms

## 故障恢复

1. **数据库连接中断**：缓存最近数据，恢复后补写
2. **模型训练失败**：使用上一个有效模型继续预测
3. **WebSocket断开**：客户端自动重连，自动恢复订阅
4. **内存不足**：自动清理最早的历史数据
