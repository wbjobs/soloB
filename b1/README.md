# 分布式任务调度系统

一个基于 React + Vite (前端) 和 Node.js + Express + PostgreSQL (后端) 的分布式任务调度管理控制台。

## 功能特性

- 任务注册（支持 CRON 表达式）
- 任务实例列表管理
- 手动触发/停止任务
- 任务执行日志查看（包含 stdout/stderr）
- 锁机制防止同一任务并发执行
- 最近 10 次执行耗时趋势图

## 项目结构

```
.
├── backend/          # 后端服务
│   ├── routes/       # API 路由
│   ├── db.js         # 数据库连接
│   ├── scheduler.js  # 任务调度引擎
│   ├── server.js     # 服务器入口
│   └── init-db.sql   # 数据库初始化脚本
└── frontend/         # 前端应用
    ├── src/
    │   ├── components/  # React 组件
    │   ├── api.js       # API 服务
    │   └── App.jsx      # 主应用
    └── vite.config.js
```

## 快速开始

### 1. 准备 PostgreSQL 数据库

确保 PostgreSQL 已安装并运行。

```bash
# 使用 psql 或 pgAdmin 创建数据库
psql -U postgres -f backend/init-db.sql
```

或者手动执行：

```sql
CREATE DATABASE task_scheduler;
```

（后端启动时会自动创建表结构）

### 2. 配置后端环境变量

修改 `backend/.env` 文件（如果需要）：

```env
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_NAME=task_scheduler
DB_USER=postgres
DB_PASSWORD=postgres
```

### 3. 启动后端服务

```bash
cd backend
npm install
npm start
```

后端将在 http://localhost:3001 启动。

### 4. 启动前端应用

```bash
cd frontend
npm install
npm run dev
```

前端将在 http://localhost:5173 启动。

## API 接口

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | /api/tasks | 获取所有任务 |
| POST | /api/tasks | 创建新任务 |
| PUT | /api/tasks/:id | 更新任务 |
| DELETE | /api/tasks/:id | 删除任务 |
| POST | /api/tasks/:id/trigger | 手动触发任务 |
| POST | /api/tasks/:id/stop | 停止运行中的任务 |
| GET | /api/tasks/:id/executions | 获取任务执行记录 |
| GET | /api/tasks/:id/executions/stats | 获取执行统计数据 |

## CRON 表达式格式

使用 node-cron 库的格式：

```
* * * * * *
| | | | | |
| | | | | +--- 星期几 (0 - 6) (0=周日)
| | | | +----- 月份 (1 - 12)
| | | +------- 日期 (1 - 31)
| | +--------- 小时 (0 - 23)
| +----------- 分钟 (0 - 59)
+------------- 秒 (0 - 59, 可选)
```

示例：
- `* * * * *` - 每分钟执行一次
- `0 * * * *` - 每小时整点执行
- `0 0 * * *` - 每天午夜执行
- `0 0 * * 0` - 每周日午夜执行
- `*/10 * * * *` - 每 10 分钟执行一次

## 锁机制

系统使用数据库级别的分布式锁来防止同一任务并发执行：

1. 任务执行前尝试获取数据库锁
2. 如果锁已存在（被其他进程持有），则跳过执行
3. 任务完成后自动释放锁
4. 应用崩溃时，锁会在下次启动时清理（或手动清理）

## 安全注意事项

⚠️ **重要**：当前版本允许执行任意 shell 命令。在生产环境中使用时，请：

1. 限制可执行命令的范围
2. 添加命令白名单验证
3. 实现沙箱执行环境
4. 添加用户认证和权限控制

## 技术栈

**后端：**
- Node.js
- Express
- PostgreSQL (pg)
- node-cron (任务调度)
- child_process (命令执行)

**前端：**
- React 18
- Vite
- Recharts (图表)
