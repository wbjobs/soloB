# 企业内部知识问答机器人

基于 RAG (Retrieval-Augmented Generation) 架构的企业内部知识问答系统。

## 架构概述

- **后端**: Python + FastAPI + LangChain + ChromaDB
- **前端**: Next.js + React + TypeScript + TailwindCSS
- **核心流程**: 用户提问 → Embedding 编码 → 向量检索 → 上下文拼接 → LLM 生成 → 流式返回答案

## 项目结构

```
b68/
├── backend/                 # 后端服务
│   ├── main.py             # FastAPI 应用入口
│   ├── config.py           # 配置管理
│   ├── schemas.py          # Pydantic 数据模型
│   ├── document_loader.py  # 文档加载与分块
│   ├── rag_pipeline.py     # RAG 检索与生成逻辑
│   ├── requirements.txt    # Python 依赖
│   └── .env.example        # 环境变量示例
├── frontend/               # 前端应用
│   ├── src/
│   │   ├── app/
│   │   │   ├── chat/
│   │   │   │   └── page.tsx    # 聊天界面
│   │   │   ├── layout.tsx      # 根布局
│   │   │   ├── page.tsx        # 首页（重定向）
│   │   │   └── globals.css     # 全局样式
│   │   └── lib/
│   │       └── api.ts          # API 客户端
│   ├── package.json        # Node.js 依赖
│   ├── tsconfig.json       # TypeScript 配置
│   ├── tailwind.config.js  # TailwindCSS 配置
│   ├── postcss.config.js   # PostCSS 配置
│   └── next.config.js      # Next.js 配置
└── README.md
```

## 快速开始

### 1. 环境准备

确保已安装：
- Python 3.9+
- Node.js 18+
- OpenAI API Key

### 2. 启动后端

```bash
cd backend

# 创建虚拟环境
python -m venv venv
venv\Scripts\activate  # Windows
# source venv/bin/activate  # Linux/Mac

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
copy .env.example .env
# 编辑 .env 文件，填入您的 OpenAI API Key

# 启动服务
python main.py
```

后端服务将在 http://localhost:8000 启动。

### 3. 启动前端

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

前端应用将在 http://localhost:3000 启动。

## 使用说明

### 上传文档

1. 访问 http://localhost:3000/chat
2. 点击右上角的「上传文档」按钮
3. 选择您的企业文档（支持 PDF、Markdown、TXT 格式）
4. 点击「上传并索引」

### 开始提问

文档上传完成后，直接在底部输入框输入问题即可：
- 系统会自动基于知识库内容进行检索
- 答案将实时流式显示在界面上

## API 接口

### 后端主要 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/v1/chat | 普通问答（非流式） |
| POST | /api/v1/chat/stream | 流式问答 |
| POST | /api/v1/documents/upload | 上传并索引文档 |
| POST | /api/v1/documents/upload/directory | 从目录加载文档 |
| GET | /api/v1/stats | 获取知识库统计 |
| DELETE | /api/v1/collection | 清空知识库 |

## 核心模块说明

### backend/document_loader.py

负责文档的加载和分块处理：
- 支持 PDF、Markdown、TXT 格式
- 使用 `RecursiveCharacterTextSplitter` 进行智能分块
- 可配置分块大小（CHUNK_SIZE）和重叠（CHUNK_OVERLAP）

### backend/rag_pipeline.py

实现完整的 RAG 流程：
- **向量存储**: 使用 ChromaDB 持久化存储
- **Embedding**: 使用 OpenAI 的 embedding 模型
- **检索**: 基于向量相似度检索相关文档
- **生成**: 结合上下文使用 LLM 生成答案
- **流式输出**: 支持 Server-Sent Events (SSE) 流式响应

### frontend/src/app/chat/page.tsx

聊天界面功能：
- 现代化的聊天 UI 设计
- 实时流式显示 AI 回答
- 文档上传与管理面板
- 知识库统计展示
- 打字指示器和光标动画
