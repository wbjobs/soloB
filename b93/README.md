# 调用链分析平台 - Trace Analysis Platform

基于 OpenTelemetry + Jaeger + Go + Gin + ECharts 的微服务调用链分析与根因分析平台。

## 功能特性

### 1. 微服务模拟
- **订单服务** (order-service:8081) - 处理订单创建与查询
- **库存服务** (inventory-service:8082) - 管理库存预留与查询
- **支付服务** (payment-service:8083) - 处理支付流程

### 2. 链路追踪
- 集成 OpenTelemetry SDK 自动生成 Trace
- Jaeger 收集与存储链路数据
- 支持分布式上下文传播

### 3. 可视化展示
- **调用链拓扑图** - 使用 ECharts 力导向图展示服务调用关系
- **时序瀑布图** - 展示各 Span 的时间分布与耗时
- **服务状态面板** - 实时展示各服务健康状态

### 4. 根因分析 (RCA)
- 自动检测慢调用（阈值：500ms）
- 识别性能瓶颈类型：
  - `SLOW_SQL` - 数据库慢查询
  - `SLOW_EXTERNAL_CALL` - 外部服务调用慢
  - `SLOW_BUSINESS_LOGIC` - 业务逻辑处理慢
- 标注具体代码位置与 SQL 语句
- 提供针对性优化建议

## 项目结构

```
b93/
├── backend/
│   ├── common/
│   │   ├── telemetry/       # OpenTelemetry 配置
│   │   ├── middleware/      # Gin 中间件
│   │   ├── database/        # 数据库模拟
│   │   └── rca/             # 根因分析算法
│   ├── api/                 # API 服务 (8080)
│   ├── order/               # 订单服务 (8081)
│   ├── inventory/           # 库存服务 (8082)
│   ├── payment/             # 支付服务 (8083)
│   ├── go.mod
│   └── Dockerfile.*
├── frontend/
│   └── index.html           # 前端界面 (ECharts + Tailwind)
├── docker-compose.yml
├── start.ps1                # Windows 启动脚本
└── README.md
```

## 快速开始

### 方式一：本地启动 (推荐)

1. **前置依赖**
   - Go 1.21+
   - Node.js (用于启动前端静态服务)

2. **启动服务**
   ```powershell
   # 进入项目目录
   cd e:\soloB\b93
   
   # 运行启动脚本
   .\start.ps1
   ```

3. **访问界面**
   - 前端：http://localhost:3000
   - API：http://localhost:8080

4. **生成示例数据**
   - 点击页面右上角「生成慢调用示例」按钮
   - 查看调用链列表，点击「查看分析」
   - 观察拓扑图、时序图和根因分析结果

### 方式二：Docker Compose 启动

1. **启动所有服务**
   ```bash
   docker-compose up -d
   ```

2. **访问服务**
   - 前端：http://localhost:3000
   - Jaeger UI：http://localhost:16686

3. **停止服务**
   ```bash
   docker-compose down
   ```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/traces | 获取所有调用链列表 |
| GET | /api/traces/{traceId} | 获取单个调用链详情 |
| GET | /api/analyze/{traceId} | 执行根因分析并返回结果 |
| POST | /api/generate-slow-trace | 生成慢调用示例数据 |
| GET | /api/services | 获取服务列表 |
| GET | /health | 健康检查 |

## 根因分析算法

### 检测逻辑
1. **阈值判断**：超过 500ms 的 Span 标记为潜在瓶颈
2. **严重分级**：
   - WARNING：500ms - 1000ms
   - CRITICAL：> 1000ms
3. **类型识别**：
   - 通过 Span 属性中的 `db.statement` 识别数据库操作
   - 通过 `external.service` 识别外部调用
   - 通过 operation name 识别业务逻辑

### 代码定位
每个 Span 包含以下属性用于精确定位：
- `code.filepath` - 文件路径
- `code.function` - 函数名
- `code.lineno` - 行号

### 优化建议
根据不同问题类型提供针对性建议：
- **SQL 问题**：索引优化、分页查询、缓存策略
- **外部调用**：超时设置、重试机制、熔断降级
- **业务逻辑**：异步处理、算法优化、数据结构优化

## 技术栈

### 后端
- **Go 1.21** - 高性能编程语言
- **Gin** - Web 框架
- **OpenTelemetry** - 可观测性框架
- **Jaeger** - 分布式追踪系统

### 前端
- **HTML5 + JavaScript** - 原生实现
- **ECharts 5.4** - 数据可视化图表库
- **Tailwind CSS** - 原子化 CSS 框架

### 部署
- **Docker** - 容器化
- **Docker Compose** - 服务编排

## 使用演示

1. **启动服务**
   ```powershell
   .\start.ps1
   ```

2. **生成测试数据**
   - 打开 http://localhost:3000
   - 点击「生成慢调用示例」

3. **查看分析结果**
   - 在调用链列表中点击「查看分析」
   - 观察：
     - 拓扑图：展示服务间调用关系，节点大小代表耗时
     - 时序图：瀑布图展示各操作的时间分布
     - 根因分析：显示检测到的瓶颈、代码位置和优化建议

## 核心代码参考

- **根因分析算法**: [backend/common/rca/analyzer.go](file:///e:/soloB/b93/backend/common/rca/analyzer.go)
- **OpenTelemetry 配置**: [backend/common/telemetry/otel.go](file:///e:/soloB/b93/backend/common/telemetry/otel.go)
- **API 服务**: [backend/api/main.go](file:///e:/soloB/b93/backend/api/main.go)
- **前端界面**: [frontend/index.html](file:///e:/soloB/b93/frontend/index.html)

## 注意事项

1. **Jaeger 集成**：本项目内置模拟 Trace 数据，实际使用时需启动 Jaeger 并配置 OTLP exporter
2. **端口占用**：确保 8080-8083、3000 端口未被占用
3. **Go Modules**：首次运行会自动下载依赖，需确保网络畅通

## 扩展方向

- [ ] 集成真实数据库（MySQL/PostgreSQL）
- [ ] 添加 Metrics 和 Logs 收集
- [ ] 实现实时告警功能
- [ ] 支持自定义分析规则
- [ ] 添加压力测试工具
- [ ] 实现多环境配置管理
