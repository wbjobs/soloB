# 任务调度模拟系统

一个前后端分离的任务调度模拟系统，实现了多优先级队列的非整数时间片轮转调度算法。

## 功能特性

### 后端
- ✅ 基于 Go 语言开发，使用 Gin 框架
- ✅ Redis 缓存支持
- ✅ SQLite 持久化存储任务历史
- ✅ 3 个优先级队列，时间片可独立配置（支持浮点数）
- ✅ 非整数时间片轮转调度算法
- ✅ 记录每个任务的等待时间、周转时间、抢占次数
- ✅ 调度熵值实时计算

### 前端
- ✅ React + ECharts 实时可视化
- ✅ 时间轴甘特图展示任务执行过程
- ✅ 调度熵值变化曲线
- ✅ 任务提交表单（支持非整数执行时间）
- ✅ 队列时间片配置界面
- ✅ 实时任务状态监控
- ✅ 任务历史记录查看

## 项目结构

```
.
├── backend/                 # Go 后端
│   ├── main.go             # 主入口文件
│   ├── config/             # 配置模块（Redis、SQLite）
│   ├── models/             # 数据模型
│   ├── scheduler/          # 调度器核心逻辑
│   ├── handlers/           # API 处理器
│   └── go.mod              # Go 依赖管理
├── frontend/               # React 前端
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── index.js
│   │   └── App.js
│   └── package.json        # npm 依赖管理
└── README.md
```

## 环境要求

- Go 1.21+
- Node.js 16+
- Redis 6+ (可选)

## 运行指南

### 1. 启动后端

```bash
cd backend
go mod download
go run main.go
```

后端服务将在 `http://localhost:8080` 启动。

### 2. 启动前端

```bash
cd frontend
npm install
npm start
```

前端应用将在 `http://localhost:3000` 启动。

## API 接口

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | /api/tasks | 提交新任务 |
| GET | /api/tasks | 获取所有任务 |
| GET | /api/tasks/:id | 获取指定任务 |
| DELETE | /api/tasks/:id | 删除指定任务 |
| GET | /api/scheduler/status | 获取调度器状态 |
| POST | /api/scheduler/start | 启动调度器 |
| POST | /api/scheduler/stop | 停止调度器 |
| POST | /api/scheduler/reset | 重置调度器 |
| GET | /api/scheduler/queues | 获取队列配置 |
| PUT | /api/scheduler/queues | 更新队列配置 |
| GET | /api/scheduler/entropy | 获取熵值历史 |
| GET | /api/history | 获取任务历史记录 |

## 使用说明

1. **提交任务**：填写任务名称、选择优先级（1-3）、设置执行时间（支持小数，如 0.5s、1.7s）
2. **配置队列**：在队列配置区域可以调整每个优先级队列的时间片大小
3. **启动调度**：点击"开始调度"按钮启动调度器
4. **观察图表**：
   - 甘特图：实时显示任务执行的时间轴
   - 熵值曲线：显示调度系统的熵值变化，反映系统的无序程度
5. **查看任务**：在任务列表中可以查看每个任务的详细状态（剩余时间、等待时间、抢占次数等）

## 调度算法说明

本系统采用**多级反馈队列调度算法**的变种：

1. **3 个优先级队列**：优先级 1（最高）、优先级 2、优先级 3（最低）
2. **时间片轮转**：每个队列独立配置时间片，高优先级队列时间片更短
3. **非整数时间片**：支持小数精度的时间片配置
4. **抢占机制**：当任务用完分配的时间片后，被抢占并放入队列尾部
5. **熵值计算**：基于任务分布情况实时计算调度熵值

## 数据持久化

- 任务执行历史自动保存到 SQLite 数据库 `task_history.db`
- 熵值变化历史同时保存到数据库
- 支持重启后查看历史记录
