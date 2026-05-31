# MQTT 连接稳定性修复说明

## 问题描述
原系统存在MQTT连接频繁断开问题，表现为每30分钟断线重连一次，导致约5%的数据丢失。

## 根因分析
1. `CleanSession=true`：每次重连后会话状态丢失，服务器不再保留离线消息
2. `QoS=0`：消息仅发送一次，无确认机制，网络波动时容易丢失
3. 无本地消息缓存：断线期间的消息直接丢弃
4. 无重连后消息重放机制

## 修复方案

### 1. 会话持久化 (CleanSession=false)
**文件**: `internal/mqtt/consumer.go`

**更改**:
```go
// 原: opts.SetCleanSession(true)
opts.SetCleanSession(false)

// 新增文件存储
store := mqtt.NewFileStore(filepath.Join(c.persistenceDir, "msgstore"))
opts.SetStore(store)
opts.SetResumeSubs(true)
```

**效果**:
- 重连后自动恢复会话状态
- Broker为离线客户端缓存QoS 1/2消息
- 订阅状态自动恢复

### 2. QoS=1消息确认机制
**文件**: `internal/mqtt/consumer.go`

**更改**:
```go
// 消费者确认消息
if msg.Qos() >= 1 {
    msg.Ack()
}

// 订阅时使用QoS=1
qos := byte(1)
token := c.client.Subscribe(c.cfg.MQTT.Topic, qos, c.messageHandler)
```

**文件**: `simulator/simulator.go`

**更改**:
```go
// 发布者使用QoS=1
token := s.client.Publish(topic, 1, false, payload)
```

**效果**:
- 至少一次投递保证
- Broker等待客户端确认后移除消息
- 重连时自动重发未确认的消息

### 3. 本地消息缓存与重放
**文件**: `internal/mqtt/consumer.go`

**新增环形缓冲区**:
```go
type CachedMessage struct {
    Topic     string
    Payload   []byte
    QoS       byte
    Timestamp time.Time
}

msgCache: ring.New(cacheCapacity) // 默认100000条缓存
```

**重放逻辑**:
- 每次重连成功后自动触发重放
- 批量处理（每批100条）避免流量突增
- 统计重放成功和失败数量

**效果**:
- 断线期间消息缓存在内存
- 重连后自动补发缓存消息
- 环形缓冲区自动淘汰旧数据

### 4. 连接状态监控与优化
**新增功能**:
- `IsConnected()`: 原子性获取连接状态
- 30秒心跳间隔（原60秒）
- 15秒最大重连间隔（原30秒）
- 10秒Ping超时
- 30秒连接超时

**Last Will消息**:
```go
opts.WillEnabled = true
opts.WillTopic = "clients/{client_id}/status"
opts.WillPayload = []byte("offline")
opts.WillQos = 1
```

### 5. Mosquitto Broker优化
**文件**: `configs/mosquitto.conf`

**新增配置**:
```
max_inflight_messages 1000       # 最多1000条在途消息
max_queued_messages 10000        # 每个客户端最多缓存10000条消息
autosave_interval 60             # 每60秒持久化
queue_qos0_messages true         # 缓存QoS 0消息
connection_messages true         # 连接事件日志
```

### 6. 新增配置项
**文件**: `pkg/models/models.go` + `configs/config.yaml`

```yaml
mqtt:
  qos: 1
  cache_capacity: 100000         # 内存缓存容量
  persistence_dir: "./mqtt_persistence"  # 持久化文件目录
```

## 预期效果

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| 会话状态 | 每次重连重置 | 断线后保留 |
| 消息投递保证 | 最多一次 | 至少一次 |
| 断线数据丢失率 | ~5% | <0.1% |
| 重连间隔 | 30秒 | 15秒 |
| 心跳间隔 | 60秒 | 30秒 |
| 可缓存离线消息 | 0 | 100000条 |

## 监控指标

新增以下统计指标，每30秒打印一次：

```
MQTT Stats: Connected=true, Messages=12345, Errors=2, Replayed=567, Dropped=0, Workers active=0/200
```

- **Messages**: 成功处理的消息数
- **Errors**: 处理失败的消息数
- **Replayed**: 重放成功的消息数
- **Dropped**: 重放失败丢弃的消息数
- **Connected**: 当前连接状态

## 使用Docker验证修复

```bash
# 启动完整环境
docker-compose up -d

# 查看日志确认没有频繁断线
docker-compose logs -f iiothub

# 模拟网络中断测试重连
docker-compose pause mosquitto
sleep 60
docker-compose unpause mosquitto

# 观察重放日志
docker-compose logs iiothub | grep "Replayed"
```
