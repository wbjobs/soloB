# WebRTC 音视频录制平台

一个基于 WebRTC 的音视频录制平台，支持麦克风与屏幕共享同时录制，自动生成双语字幕并烧录到视频中。

## 功能特性

### 🎥 录制功能
- **麦克风 + 屏幕共享同时录制**
- **每 5 分钟自动分段保存**
- **实时预览录制画面**
- **支持暂停/继续/停止控制**

### 🎬 视频处理
- **FFmpeg 视频转码和压缩**
- **Bull 队列异步处理**
- **实时处理进度反馈**

### 💬 字幕功能
- **OpenAI Whisper API 自动生成字幕**
- **中英文双语字幕支持**
- **字幕烧录到视频中**
- **字幕时间轴点击跳转**

### 📁 会话管理
- **录制会话列表**
- **视频播放器**
- **字幕时间轴展示**
- **会话删除和重试处理**

## 技术栈

### 后端
- **Node.js + Express** - Web 服务器
- **TypeScript** - 类型安全
- **Socket.IO** - 实时数据传输
- **Bull + Redis** - 任务队列
- **Prisma + PostgreSQL** - ORM 和数据库
- **FFmpeg** - 视频处理
- **OpenAI Whisper API** - 语音识别

### 前端
- **React 18 + TypeScript**
- **Vite** - 构建工具
- **Tailwind CSS** - 样式框架
- **React Router** - 路由管理
- **Socket.IO Client** - WebSocket 客户端
- **WebRTC API** - 媒体录制

## 项目结构

```
.
├── client/                 # 前端项目
│   ├── src/
│   │   ├── components/    # React 组件
│   │   ├── pages/         # 页面组件
│   │   ├── services/       # API 和 Socket 服务
│   │   ├── types/          # TypeScript 类型
│   │   └── hooks/        # 自定义 Hooks
│   ├── package.json
│   └── vite.config.ts
├── server/                 # 后端项目
│   ├── src/
│   │   ├── controllers/   # API 控制器
│   │   ├── routes/        # 路由定义
│   │   ├── socket/         # Socket.IO 处理
│   │   ├── queues/      # Bull 队列定义
│   │   ├── workers/     # 任务处理 Worker
│   │   ├── services/   # 业务逻辑服务
│   │   ├── middleware/   # 中间件
│   │   └── utils/        # 工具函数
│   ├── prisma/          # Prisma Schema
│   ├── package.json
│   └── tsconfig.json
└── uploads/                # 视频文件存储
    ├── temp/            # 临时分段文件
    └── processed/       # 最终处理文件
```

## 快速开始

### 前置要求

- Node.js 18+
- PostgreSQL 13+
- Redis 6+
- FFmpeg 6+
- OpenAI API Key

### 安装依赖

```bash
# 安装后端依赖
cd server
npm install

# 安装前端依赖
cd ../client
npm install
```

### 配置环境变量

在 `server` 目录创建 `.env` 文件：

```env
PORT=4000
NODE_ENV=development

# 数据库配置
DATABASE_URL="postgresql://user:password@localhost:5432/webrtc_recorder?schema=public"

# Redis 配置
REDIS_URL="redis://localhost:6379"

# OpenAI API
OPENAI_API_KEY="your_openai_api_key_here"

# 文件存储路径
UPLOAD_PATH="../uploads"
MAX_FILE_SIZE="10737418240"

# FFmpeg 路径
FFMPEG_PATH="ffmpeg"
FFPROBE_PATH="ffprobe"

# CORS 配置
CORS_ORIGIN="http://localhost:3000"
```

### 初始化数据库

```bash
cd server

# 生成 Prisma Client
npx prisma generate

# 运行数据库迁移
npx prisma migrate dev --name init
```

### 启动服务

```bash
# 启动后端服务 (端口 4000)
cd server
npm run dev

# 启动 Bull Worker (新终端)
cd server
npm run worker

# 启动前端开发服务器 (端口 3000)
cd client
npm run dev
```

## 使用说明

1. 访问 http://localhost:3000
2. 输入录制标题
3. 点击"开始录制"按钮
4. 授权麦克风和屏幕共享权限
5. 录制完成后点击"停止录制"
6. 等待视频处理完成
7. 在"历史会话"中查看录制结果

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/sessions` | 获取所有录制会话 |
| GET | `/api/sessions/:id` | 获取会话详情 |
| GET | `/api/sessions/:id/video` | 播放视频流 |
| GET | `/api/sessions/:id/subtitles` | 获取字幕数据 |
| DELETE | `/api/sessions/:id` | 删除录制会话 |
| POST | `/api/sessions/:id/retry` | 重试视频处理 |

## Socket.IO 事件

| 事件 | 方向 | 说明 |
|------|------|------|
| `recorder:start` | Client → Server | 开始录制 |
| `recorder:data` | Client → Server | 发送视频数据块 |
| `recorder:segment` | Client → Server | 创建新分段 |
| `recorder:stop` | Client → Server | 停止录制 |
| `processing:progress` | Server → Client | 处理进度更新 |

## 数据库模型

### RecordingSession
- id: UUID
- title: 录制标题
- startedAt: 开始时间
- endedAt: 结束时间
- duration: 时长（秒）
- status: 状态 (recording/processing/completed/error)
- videoPath: 视频文件路径
- createdAt: 创建时间
- updatedAt: 更新时间

### VideoSegment
- id: UUID
- sessionId: 会话 ID
- segmentNumber: 分段序号
- startTime: 开始时间
- duration: 时长
- filePath: 文件路径
- sizeBytes: 文件大小
- createdAt: 创建时间

### Subtitle
- id: UUID
- sessionId: 会话 ID
- startTime: 开始时间
- endTime: 结束时间
- textZh: 中文字幕
- textEn: 英文字幕
- createdAt: 创建时间

### ProcessingTask
- id: UUID
- sessionId: 会话 ID
- type: 任务类型
- status: 状态
- progress: 进度 (0-100)
- errorMessage: 错误信息
- createdAt: 创建时间
- completedAt: 完成时间

## 注意事项

1. 首次使用需要授予浏览器麦克风和屏幕共享权限
2. 视频处理时间取决于视频长度和服务器性能
3. 请确保 OpenAI API Key 有足够的额度
4. FFmpeg 需要正确安装并配置路径
5. Redis 和 PostgreSQL 服务需要预先启动

## 开发说明

### 前端使用 TypeScript 编写，主要组件包括：
- `useRecorder.ts - 录制核心逻辑 Hook
- RecorderConsole.tsx - 录制控制台
- VideoPlayerPage.tsx - 视频播放器
- SessionsPage.tsx - 会话列表

后端使用 TypeScript + Express 开发：
- StreamManager.ts - 视频流管理
- VideoProcessor.ts - 视频处理 Worker
- SessionController.ts - 会话 API 控制器
- socket/handler.ts - Socket.IO 事件处理

## 许可证

MIT
