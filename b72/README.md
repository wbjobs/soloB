# 乐谱协同批注系统

一个支持多人实时协作的 PDF 乐谱批注 Web 应用，使用 WebRTC 技术实现低延迟批注同步。

## 功能特性

- 🔐 **用户认证**: 注册登录，JWT 身份验证
- 📄 **PDF 乐谱管理**: 上传、预览、分页浏览
- ✏️ **批注工具**:
  - 高亮标注
  - 自由画笔
  - 文本标签
  - 节拍器标记
- 👥 **实时协作**: WebRTC 点对点实时同步批注
- 📝 **版本控制**: 自动保存版本，支持历史版本查看和恢复
- 🛡️ **权限管理**: 创建者、协作者、只读三种角色权限

## 技术栈

### 后端
- Node.js + Express
- MongoDB + Mongoose
- Socket.io (WebRTC 信令)
- Multer (文件上传)
- JWT (认证)
- bcrypt (密码加密)

### 前端
- React 18
- Vite (构建工具)
- Fabric.js (画布渲染)
- PDF.js (PDF 渲染)
- Socket.io-client
- Zustand (状态管理)
- Ant Design (UI 组件)
- Tailwind CSS (样式)

## 项目结构

```
score-collab/
├── server/                 # 后端服务
│   ├── src/
│   │   ├── models/        # 数据模型
│   │   ├── controllers/   # 控制器
│   │   ├── routes/        # 路由
│   │   ├── middleware/    # 中间件
│   │   ├── socket/        # Socket.io 处理
│   │   └── server.js      # 入口文件
│   ├── uploads/           # 上传文件存储
│   ├── .env               # 环境变量
│   └── package.json
│
├── client/                 # 前端应用
│   ├── src/
│   │   ├── components/    # React 组件
│   │   ├── hooks/         # 自定义 Hooks
│   │   ├── store/         # Zustand 状态
│   │   ├── pages/         # 页面组件
│   │   └── main.jsx       # 入口文件
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── package.json
│
└── README.md
```

## 快速开始

### 环境要求
- Node.js 18+
- MongoDB 6.0+

### 安装依赖

```bash
# 后端
cd server
npm install

# 前端
cd ../client
npm install
```

### 配置环境变量

在 `server/.env` 中配置：

```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/score-collab
JWT_SECRET=your-secret-key
UPLOAD_PATH=./uploads
```

### 启动服务

```bash
# 启动后端 (端口 5000)
cd server
npm run dev

# 启动前端 (端口 3000)
cd ../client
npm run dev
```

### 访问应用

打开浏览器访问: http://localhost:3000

## API 接口

### 认证接口
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录
- `GET /api/auth/me` - 获取当前用户

### 乐谱接口
- `GET /api/scores` - 获取乐谱列表
- `POST /api/scores` - 上传乐谱
- `GET /api/scores/:id` - 获取乐谱详情
- `DELETE /api/scores/:id` - 删除乐谱
- `POST /api/scores/:id/share` - 分享乐谱

### 批注接口
- `GET /api/scores/:id/annotations` - 获取批注列表
- `POST /api/scores/:id/annotations` - 添加批注
- `PUT /api/annotations/:id` - 更新批注
- `DELETE /api/annotations/:id` - 删除批注

### 版本接口
- `GET /api/scores/:id/versions` - 获取版本列表
- `POST /api/scores/:id/versions` - 创建版本
- `POST /api/versions/:id/restore` - 恢复版本

## Socket.io 事件

### 连接事件
- `join-room` - 加入乐谱房间
- `leave-room` - 离开乐谱房间
- `user-connected` - 用户加入通知
- `user-disconnected` - 用户离开通知

### 数据同步事件
- `annotation-add` - 新增批注
- `annotation-update` - 更新批注
- `annotation-delete` - 删除批注
- `page-change` - 页码切换

## 核心功能演示

1. **注册登录**: 创建账户并登录系统
2. **上传乐谱**: 上传 PDF 格式的乐谱文件
3. **添加批注**: 使用工具栏工具在乐谱上添加批注
4. **实时协作**: 多人同时打开同一乐谱，批注实时同步
5. **版本管理**: 保存版本，查看历史，恢复到任意版本

## 数据模型

### User
- email: 邮箱
- password: 加密密码
- name: 姓名
- avatar: 头像

### Score
- title: 乐谱标题
- fileName: 文件名
- filePath: 文件路径
- fileSize: 文件大小
- pageCount: 页数
- createdBy: 创建者
- collaborators: 协作者列表 (userId, role)

### Annotation
- scoreId: 关联乐谱
- page: 页码
- type: 批注类型 (highlight/pen/text/metronome)
- data: 批注数据
- color: 颜色
- createdBy: 创建者

### Version
- scoreId: 关联乐谱
- version: 版本号
- snapshot: 批注快照
- createdBy: 创建者
- description: 版本描述

## 许可证

MIT License
