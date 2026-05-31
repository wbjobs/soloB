# Modbus/TCP Fuzzer

基于Go开发的Modbus/TCP模糊测试工具，包含从站模拟器、主站模糊器、异常检测和REST API接口。

## 功能特性

### 1. Modbus从站模拟器
- 支持多个从站设备
- 保持寄存器 (Holding Registers) 读写
- 线圈 (Coils) 读写
- 完整的Modbus功能码支持：01, 03, 05, 06, 15, 16
- **看门狗恢复机制**：检测到从站无响应时自动发送暖启动指令

### 2. 多级报文变异模糊测试
#### 2.1 基础变异策略
- **Bit翻转**：随机翻转报文中的bit位
- **异常功能码**：注入无效的功能码
- **长度溢出**：修改报文长度字段造成溢出
- **非法从站ID**：使用无效的从站地址
- **随机字节**：随机修改报文内容

#### 2.2 协议语法树变异 (高级)
基于Modbus规范生成语义正确但逻辑错误的报文：
- **无效地址**：访问超出范围的寄存器/线圈
- **无效数量**：使用0或超大量的读写数量
- **只读写入**：尝试写入只读寄存器（如输入寄存器）
- **边界值测试**：0x0000, 0x0001, 0xFFFE, 0xFFFF等边界地址
- **功能码组合错误**：读写组合功能的非法参数
- **数据长度不匹配**：MBAP长度与实际数据不符
- **保留功能码**：使用未定义/保留的功能码
- **地址范围溢出**：起始地址+数量超出设备范围

### 3. 实时响应检测与看门狗
- 超时检测
- 非法数据格式检测
- 连接状态监控
- 异常响应识别 (异常码解析)
- CRC校验检测
- **连续无响应计数**：连续3次无响应触发恢复机制
- **自动暖启动**：发送诊断功能码恢复设备状态
- **手动恢复API**：支持手动触发从站恢复

### 4. 孤立森林异常检测
- 基于机器学习的异常检测
- 使用响应时间、数据包大小、状态作为特征
- 自动训练和预测
- 生成异常报告和建议

### 5. REST API接口
完整的RESTful API支持：
- 从站管理 (添加、启动、停止、恢复)
- 模糊测试控制 (批量/单次测试、语法树变异测试)
- 看门狗状态监控
- 测试结果查询
- 统计信息获取
- 异常报告生成
- InfluxDB存储查询
- Modbus功能码信息查询

### 6. InfluxDB时序数据存储
- 测试结果持久化存储
- 从站状态监控
- 历史数据查询
- 异常数据检索

## 项目结构

```
modbus-fuzzer/
├── main.go              # 主程序入口
├── go.mod               # Go模块定义
├── slave/               # 从站模拟器
│   └── slave.go
├── fuzzer/              # 模糊测试器
│   └── fuzzer.go
├── detector/            # 响应检测器
│   └── detector.go
├── anomaly/             # 异常检测算法
│   └── isolation_forest.go
├── storage/             # InfluxDB存储
│   └── influxdb.go
└── api/                 # REST API服务
    └── server.go
```

## 快速开始

### 前置要求
- Go 1.21+

### 安装依赖
```bash
go mod download
```

### 运行程序
```bash
go run main.go
```

程序启动后：
- Slave 1 运行在端口 5020
- Slave 2 运行在端口 5021
- API服务运行在 http://localhost:8080

## API使用示例

### 1. 查看从站列表
```bash
curl http://localhost:8080/api/v1/slaves
```

### 2. 添加新从站
```bash
curl -X POST http://localhost:8080/api/v1/slaves \
  -H "Content-Type: application/json" \
  -d '{"id": 3, "holding_registers": 100, "coils": 100, "port": 5022}'
```

### 3. 启动从站
```bash
curl -X POST http://localhost:8080/api/v1/slaves/3/start \
  -H "Content-Type: application/json" \
  -d '{"port": 5022}'
```

### 4. 单次模糊测试
```bash
curl -X POST http://localhost:8080/api/v1/fuzz/single \
  -H "Content-Type: application/json" \
  -d '{"slave_id": 1}'
```

### 5. 批量模糊测试
```bash
curl -X POST http://localhost:8080/api/v1/fuzz/start \
  -H "Content-Type: application/json" \
  -d '{"slave_id": 1, "test_count": 100, "interval_ms": 10}'
```

### 6. 查看测试结果
```bash
curl http://localhost:8080/api/v1/results
```

### 7. 查看统计信息
```bash
curl http://localhost:8080/api/v1/results/statistics
```

### 8. 查看异常结果
```bash
curl http://localhost:8080/api/v1/results/anomalies
```

### 9. 训练异常检测模型
```bash
curl -X POST http://localhost:8080/api/v1/anomaly/train
```

### 10. 生成异常报告
```bash
curl "http://localhost:8080/api/v1/anomaly/report?threshold=0.5"
```

## 配置说明

在 `main.go` 中可以修改以下配置：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| APIPort | API服务端口 | :8080 |
| Slave1Port | 从站1端口 | 5020 |
| Slave2Port | 从站2端口 | 5021 |
| DetectorTimeout | 响应超时时间(秒) | 5 |
| EnableInfluxDB | 是否启用InfluxDB | false |
| InfluxDBURL | InfluxDB地址 | http://localhost:8086 |
| InfluxDBToken | InfluxDB认证Token | your-token-here |
| InfluxDBOrg | InfluxDB组织名 | modbus |
| InfluxDBBucket | InfluxDB存储桶 | fuzzer |

## 启用InfluxDB存储

1. 安装并启动InfluxDB 2.x
2. 在InfluxDB中创建组织 `modbus` 和存储桶 `fuzzer`
3. 生成访问Token
4. 修改 `main.go` 中的配置：
   ```go
   EnableInfluxDB: true,
   InfluxDBToken: "your-actual-token",
   ```

## 模糊测试类型说明

### 基础变异策略

| 类型 | 说明 | 测试目标 |
|------|------|----------|
| Bit翻转 | 随机翻转报文中的bit位 | 协议解析器健壮性 |
| 异常功能码 | 使用未定义的功能码 | 异常处理逻辑 |
| 长度溢出 | 修改长度字段为异常值 | 边界条件处理 |
| 非法从站ID | 使用无效从站地址 | 从站识别逻辑 |
| 随机字节 | 随机插入/修改字节 | 容错能力 |
| 设备卡死 | 模拟从站进入无响应状态 | 看门狗恢复机制 |

### 协议语法树变异策略（高级）

| 类型 | 说明 | 测试目标 |
|------|------|----------|
| 无效地址 | 访问超出范围的寄存器/线圈 | 地址范围检查 |
| 无效数量 | 使用0或超大量的读写数量 | 数量限制验证 |
| 只读写入 | 尝试写入只读内存区域 | 内存保护机制 |
| 边界值测试 | 使用0x0000, 0xFFFF等边界地址 | 边界条件处理 |
| 功能码组合错误 | 读写组合功能的非法参数 | 复杂功能处理 |
| 数据长度不匹配 | MBAP长度与实际数据不符 | 数据包完整性验证 |
| 保留功能码 | 使用未定义/保留的功能码 | 未知指令处理 |
| 地址范围溢出 | 起始地址+数量超出设备范围 | 地址范围溢出处理 |

## 看门狗机制说明

### 工作原理
1. 每次测试检测从站响应状态
2. 连续3次无响应后触发看门狗恢复机制
3. 自动发送Modbus诊断功能码(0x08)进行暖启动
4. 重置从站状态，恢复正常通信

### 恢复流程
```
正常响应 → 连续无响应计数=0
第1次无响应 → 连续无响应计数=1
第2次无响应 → 连续无响应计数=2
第3次无响应 → 触发看门狗恢复 → 发送暖启动指令 → 重置计数器=0
```

## 异常检测原理

使用孤立森林(Isolation Forest)算法，基于以下特征检测异常：
- **响应时间**：异常长的响应时间可能表示设备崩溃
- **数据包大小**：异常的响应长度可能表示数据损坏
- **响应状态**：异常的状态码表示协议错误

异常分数范围：0-1，分数越高表示越异常。

## 许可证

MIT License
