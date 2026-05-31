# WebRTC音视频录制平台 - 技术架构文档

## 1. 技术选型

### 1.1 前端技术栈
| 技术 | 版本 | 用途 |
|------|------|------|
| React | 18.x | UI框架 |
| TypeScript | 5.x | 类型安全 |
| Vite | 5.x | 构建工具 |
| Tailwind CSS | 3.x | 样式框架 |
| Socket.IO Client | 4.x | 实时通信 |
| React Router | 6.x | 路由管理 |

### 1.2 后端技术栈
| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | 20.x | 运行环境 |
| Express | 4.x | Web框架 |
| Socket.IO | 4.x | WebSocket服务 |
| Bull | 4.x | 任务队列 |
| Prisma | 5.x | ORM |
| PostgreSQL | 15.x | 数据库 |
| FFmpeg | 6.x | 视频处理 |
| Fluent-ffmpeg | 2.x | FFmpeg封装 |

### 1.3 外部服务
- **OpenAI Whisper API**: 语音识别生成字幕
- **Redis**: Bull队列的存储后端

## 2. 系统架构

### 2.1 整体架构图
```mermaid
graph TD
    A[浏览器前端] -->|WebRTC捕获| B[音视频流]
    B -->|Socket.IO| C[Node.js后端]
    C -->|分段存储| D[临时文件系统]
    C -->|触发任务| E[Bull队列]
    E -->|消费任务| F[视频处理Worker]
    F -->|调用| G[FFmpeg]
    F -->|调用| H[Whisper API]
    F -->|存储结果| I[PostgreSQL]
    F -->|输出| J[最终视频文件]
    A -->|HTTP请求| C
    A -->|播放| J
```

### 2.2 目录结构
```
project/
├── client/                 # 前端项目
│   ├── src/
│   │   ├── components/    # React组件
│   │   ├── hooks/         # 自定义Hooks
│   │   ├── services/      # API和Socket服务
│   │   ├── types/         # TypeScript类型
│   │   ├── pages/         # 页面组件
│   │   └── utils/         # 工具函数
│   ├── package.json
│   └── vite.config.ts
├── server/                 # 后端项目
│   ├── src/
│   │   ├── controllers/   # 路由控制器
│   │   ├── middleware/    # 中间件
│   │   ├── queues/        # Bull队列定义
│   │   ├── workers/       # 任务处理Worker
│   │   ├── services/      # 业务逻辑
│   │   ├── models/        # 数据模型
│   │   ├── routes/        # 路由定义
│   │   ├── socket/        # Socket.IO处理
│   │   └── utils/         # 工具函数
│   ├── prisma/            # Prisma Schema
│   ├── package.json
│   └── tsconfig.json
└── uploads/               # 视频文件存储
    ├── temp/              # 临时分段文件
    └── processed/         # 最终处理文件
```

## 3. 数据库设计

### 3.1 ER图
```mermaid
erDiagram
    RECORDING_SESSION ||--o{ VIDEO_SEGMENT : has
    RECORDING_SESSION ||--o{ SUBTITLE : has
    RECORDING_SESSION ||--o{ PROCESSING_TASK : has
    
    RECORDING_SESSION {
        uuid id PK
        string title
        datetime started_at
        datetime ended_at
        integer duration
        string status
        datetime created_at
    }
    
    VIDEO_SEGMENT {
        uuid id PK
        uuid session_id FK
        integer segment_number
        integer start_time
        integer duration
        string file_path
        integer size_bytes
        datetime created_at
    }
    
    SUBTITLE {
        uuid id PK
        uuid session_id FK
        integer segment_id FK
        float start_time
        float end_time
        string text_zh
        string text_en
        datetime created_at
    }
    
    PROCESSING_TASK {
        uuid id PK
        uuid session_id FK
        string type
        string status
        integer progress
        text error_message
        datetime created_at
        datetime completed_at
    }
```

### 3.2 表结构说明
- **RECORDING_SESSION**: 录制会话主表，存储每次录制的元信息
- **VIDEO_SEGMENT**: 视频分段表，每5分钟一条记录
- **SUBTITLE**: 字幕表，存储每条字幕的时间轴和双语内容
- **PROCESSING_TASK**: 处理任务表，跟踪队列任务状态

## 4. 核心模块设计

### 4.1 前端录制模块
**核心流程**:
1. 请求媒体权限（麦克风 + 屏幕共享）
2. 创建MediaRecorder实例
3. 定时触发分段（每5分钟）
4. 通过Socket.IO发送数据块到后端
5. 实时更新录制状态

**关键组件**:
- `Recorder`: 录制控制核心类
- `useRecorder`: React Hook封装录制逻辑
- `PreviewWindow`: 实时预览组件

### 4.2 后端Socket模块
**核心流程**:
1. 建立WebSocket连接
2. 接收前端发送的视频数据块
3. 写入临时文件缓冲区
4. 接收分段信号，关闭当前文件，创建新文件
5. 录制结束时，触发Bull队列任务

**关键文件**:
- `socket/handler.ts`: Socket.IO事件处理器
- `services/StreamManager.ts`: 流管理服务

### 4.3 视频处理Worker
**核心流程**:
```
输入: sessionId
  ↓
1. 合并所有分段视频
  ↓
2. 提取音频轨用于Whisper
  ↓
3. 调用Whisper API生成字幕
  ↓
4. 翻译字幕为双语
  ↓
5. 生成ASS字幕文件
  ↓
6. FFmpeg烧录字幕到视频
  ↓
7. 压缩视频优化大小
  ↓
8. 更新数据库记录
输出: 处理完成的视频文件
```

### 4.4 Bull队列设计
**队列类型**:
- `video-processing`: 视频主处理队列（并发: 2）
- `subtitle-generation`: 字幕生成队列（并发: 3）
- `video-merge`: 视频合并队列（并发: 1）

**任务优先级**:
- 新录制任务: 高优先级 (10)
- 重试任务: 中优先级 (5)
- 批量处理: 低优先级 (1)

## 5. 关键技术实现

### 5.1 WebRTC录制
```typescript
// 同时捕获麦克风和屏幕共享
const [audioStream, screenStream] = await Promise.all([
  navigator.mediaDevices.getUserMedia({ audio: true }),
  navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
]);

// 合并音轨
const combinedStream = new MediaStream([
  ...screenStream.getVideoTracks(),
  ...audioStream.getAudioTracks()
]);
```

### 5.2 视频分段逻辑
```typescript
const SEGMENT_DURATION = 5 * 60 * 1000; // 5分钟

// 定时触发分段
setInterval(() => {
  if (isRecording) {
    mediaRecorder.requestData(); // 触发dataavailable
    startNewSegment();
  }
}, SEGMENT_DURATION);
```

### 5.3 FFmpeg字幕烧录
```bash
# 使用ASS字幕滤镜烧录双语字幕
ffmpeg -i input.mp4 \
  -vf "ass=subtitles.ass" \
  -c:v libx264 -crf 23 \
  -c:a aac -b:a 128k \
  output.mp4
```

### 5.4 Whisper API调用
```typescript
const transcription = await openai.audio.transcriptions.create({
  file: fs.createReadStream(audioPath),
  model: "whisper-1",
  response_format: "verbose_json",
  timestamp_granularities: ["word", "segment"],
  language: "zh"
});
```

## 6. API接口设计

### 6.1 REST API
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/sessions` | 获取录制会话列表 |
| GET | `/api/sessions/:id` | 获取会话详情 |
| GET | `/api/sessions/:id/video` | 获取视频流 |
| GET | `/api/sessions/:id/subtitles` | 获取字幕数据 |
| DELETE | `/api/sessions/:id` | 删除录制会话 |

### 6.2 Socket.IO事件
| 事件 | 方向 | 说明 |
|------|------|------|
| `recorder:start` | Client → Server | 开始录制 |
| `recorder:data` | Client → Server | 发送视频数据块 |
| `recorder:segment` | Client → Server | 视频分段标记 |
| `recorder:stop` | Client → Server | 停止录制 |
| `processing:progress` | Server → Client | 处理进度更新 |

## 7. 部署配置

### 7.1 环境变量
```env
# 数据库
DATABASE_URL="postgresql://user:pass@localhost:5432/recorder"

# Redis
REDIS_URL="redis://localhost:6379"

# OpenAI
OPENAI_API_KEY="sk-xxx"

# 文件存储
UPLOAD_PATH="./uploads"
MAX_FILE_SIZE="10GB"

# FFmpeg
FFMPEG_PATH="/usr/local/bin/ffmpeg"
FFPROBE_PATH="/usr/local/bin/ffprobe"
```

### 7.2 端口分配
- 前端开发服务器: 3000
- 后端API服务: 4000
- WebSocket: 4000 (同端口)
- PostgreSQL: 5432
- Redis: 6379
