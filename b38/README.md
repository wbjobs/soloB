# 系统资源监控应用

一个基于 Electron + React + Python 开发的跨平台桌面应用，用于记录和分析系统资源使用情况。

## 功能特性

- **实时监控**：每隔5秒自动采集系统资源数据
- **数据存储**：使用 SQLite 数据库本地存储所有历史数据
- **可视化展示**：通过折线图直观展示 CPU 和内存使用趋势
- **时间范围选择**：支持查看过去1小时、24小时、7天的历史数据
- **实时状态**：显示当前 CPU 使用率、内存使用率、总内存和可用内存

## 技术栈

- **前端**：Electron + React + Recharts
- **后端**：Python + Flask + psutil + SQLite
- **通信**：RESTful API

## 项目结构

```
.
├── backend/                 # Python 后端
│   ├── app/
│   │   ├── __init__.py
│   │   ├── api.py          # Flask API 服务
│   │   ├── database.py     # SQLite 数据库操作
│   │   └── monitor.py      # 系统资源监控
│   ├── data/               # 数据库文件存储目录
│   ├── main.py             # 后端入口文件
│   └── requirements.txt    # Python 依赖
├── frontend/               # Electron + React 前端
│   ├── electron/
│   │   └── main.js         # Electron 主进程
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard.css
│   │   │   └── Dashboard.js
│   │   ├── App.css
│   │   ├── App.js
│   │   ├── index.css
│   │   └── index.js
│   └── package.json        # 前端依赖
└── package.json            # 根项目配置
```

## 安装步骤

### 1. 安装 Python 依赖

```bash
cd backend
pip install -r requirements.txt
```

### 2. 安装 Node.js 依赖

```bash
cd ../frontend
npm install
```

或者使用根目录的一键安装命令：

```bash
npm run install:all
```

## 运行应用

### 方式一：分别启动前后端（推荐用于开发）

1. **启动 Python 后端**（在第一个终端窗口）：
```bash
cd backend
python main.py
```
后端将在 http://127.0.0.1:5000 运行

2. **启动 React 开发服务器**（在第二个终端窗口）：
```bash
cd frontend
npm start
```
React 应用将在 http://localhost:3000 运行

3. **启动 Electron 应用**（在第三个终端窗口）：
```bash
cd frontend
ELECTRON_START_URL=http://localhost:3000 npm run electron
```

### 方式二：使用根目录脚本

1. 启动后端：
```bash
npm run start:backend
```

2. 启动前端开发服务器：
```bash
npm run start:frontend
```

3. 启动 Electron：
```bash
npm run start:electron
```

## API 接口

后端提供以下 RESTful API 接口：

- `GET /api/health` - 健康检查
- `GET /api/current` - 获取当前系统资源使用情况
- `GET /api/metrics?hours=24` - 获取指定时间范围内的历史数据（默认24小时）

## 数据采集内容

应用每隔5秒采集以下系统资源数据：

- **CPU 使用率**：百分比形式
- **内存使用情况**：使用率、总内存、可用内存
- **网络 IO**：发送字节数、接收字节数

所有数据都带有时间戳，存储在本地 SQLite 数据库中。

## 浏览器兼容性

- Chrome
- Firefox
- Safari
- Edge

## 许可证

MIT License
