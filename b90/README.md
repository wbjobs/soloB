# DB Profiler - 数据库慢查询性能分析工具

基于 eBPF 技术的无侵入式数据库慢查询诊断与内核性能监控系统

## 功能特性

### 1. **eBPF 内核数据采集
- 挂载 kprobe 捕获文件读写系统调用
- TCP 网络流量监控
- 内存分配追踪
- 锁等待时间统计
- 页缓存命中率计算

### 2. **慢查询关联分析**
- 自动识别数据库慢查询
- 关联查询执行期间的内核资源消耗
- IO 延迟与查询性能相关性分析

### 3. **火焰图可视化**
- 查询执行路径可视化
- 系统调用耗时分布
- 性能瓶颈定位

### 4. **Web 管理面板**
- 仪表板概览
- 慢查询列表与详情
- 性能趋势图表
- 异常检测与告警
- 关联分析视图

### 5. **诊断报告**
- 自动生成 PDF 报告
- 性能优化建议
- 历史数据对比

## 项目结构

```
db-profiler/
├── web/
│   ├── frontend/          # Vue 3 前端应用
│   │   ├── src/
│   │   │   ├── views/    # 页面组件
│   │   │   ├── router/   # 路由配置
│   │   │   └── main.js   # 入口文件
│   │   ├── package.json
│   │   └── vite.config.js
│   └── backend/           # Go 后端 API
│       ├── main.go          # API 服务器
│       └── go.mod
├── data/                   # SQLite 数据目录
└── README.md
```

## 快速开始

### 前置要求

- Go 1.21+
- Node.js 18+
- Linux 内核 4.15+ (eBPF 支持)
- root 权限

### 启动前端

```bash
cd web/frontend
npm install
npm run dev
```

前端将在 http://localhost:3000 启动

### 启动后端

```bash
cd web/backend
go mod tidy
mkdir -p ../../data
go run main.go
```

后端 API 将在 http://localhost:8080 启动

## API 接口

### 查询相关

- `GET /api/queries` - 获取慢查询列表
- `GET /api/queries/:id` - 获取查询详情
- `GET /api/queries/top` - 获取 TOP 慢查询
- `GET /api/queries/trends` - 获取查询趋势

### 指标相关

- `GET /api/metrics` - 获取内核指标
- `GET /api/metrics/correlation` - 获取相关性分析

### 异常检测

- `GET /api/anomalies` - 获取异常列表
- `GET /api/anomalies/detect` - 执行异常检测

### 报告相关

- `POST /api/reports/generate` - 生成诊断报告
- `GET /api/reports` - 获取报告列表
- `GET /api/reports/:id` - 获取报告详情

## 核心数据模型

### SlowQuery (慢查询)
- SQL 语句与哈希
- 执行时间与时长
- 数据库与用户信息
- 进程/线程 ID

### KernelMetrics (内核指标)
- IO 读写字节数与次数
- IO 延迟统计
- 页缓存命中/未命中
- TCP 网络流量
- 内存分配
- 锁等待统计

### Anomaly (异常事件)
- 异常类型与严重程度
- 相关性分数
- 时间戳与描述

## 性能优化建议

1. **高 IO 延迟**
   - 检查磁盘健康状态
   - 考虑使用 SSD
   - 优化查询，添加索引
   - 增加数据库缓存

2. **锁竞争**
   - 优化事务隔离级别
   - 减少长事务
   - 考虑乐观锁

3. **低页缓存命中率**
   - 增加 innodb_buffer_pool_size
   - 优化数据访问模式
   - 考虑分区表

## 技术栈

- **前端**: Vue 3 + Element Plus + ECharts
- **后端**: Go + Gin + GORM
- **数据库**: SQLite
- **内核层**: eBPF + CO-RE

## 注意事项

1. eBPF 数据采集需要 root 权限
2. 支持 MySQL 和 PostgreSQL 协议解析
3. 生产环境建议配置数据保留策略
4. 建议配合数据库慢查询日志阈值设置

## 许可证

MIT License
