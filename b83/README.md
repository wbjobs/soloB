# Web SSH 堡垒机系统

一个功能完整的Web SSH堡垒机系统，提供安全的远程服务器访问控制、命令审计和会话回放功能。

## 功能特性

### 1. 用户认证与多租户隔离
- JWT令牌认证
- 多租户架构，不同团队数据完全隔离
- 用户注册和登录功能

### 2. Web终端访问
- 基于xterm.js的现代化Web终端
- WebSocket实时通信
- 支持SSH密码认证

### 3. 高危命令检测与阻断
- 实时检测危险命令
- 支持的危险命令类型：
  - `rm -rf /*` 等删除命令
  - `chmod 777` 权限修改
  - `mkfs` 格式化命令
  - `shutdown/reboot` 系统操作
  - Fork炸弹
  - 远程脚本执行（wget|curl ... | sh）
  - 修改/etc/passwd等系统文件

### 4. 会话审计与回放
- 实时记录所有终端输出
- 完整会话录制
- 视频级别的会话回放
- 支持多种回放速度（0.5x, 1x, 2x, 4x）

### 5. 告警系统
- 危险命令触发告警
- 告警级别分类（critical/high）
- 告警历史记录

## 技术栈

### 后端
- **Go 1.21+** - 主编程语言
- **Gin** - Web框架
- **Gorilla WebSocket** - WebSocket通信
- **MongoDB** - 数据存储
- **x/crypto/ssh** - SSH客户端库
- **JWT** - 身份认证

### 前端
- **Vue 3** - 前端框架
- **xterm.js** - Web终端组件
- **Vue Router** - 路由管理
- **Pinia** - 状态管理
- **Axios** - HTTP客户端
- **Vite** - 构建工具

## 项目结构

```
web-ssh-bastion/
├── main.go              # 后端入口
├── routes.go            # 路由定义
├── go.mod               # Go依赖
├── .env                 # 环境配置
├── models/              # 数据模型
│   └── models.go
├── security/            # 安全模块
│   └── command_checker.go
├── ssh/                 # SSH处理模块
│   └── ssh_handler.go
└── web/                 # 前端项目
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── main.js
        ├── App.vue
        ├── router.js
        ├── stores/
        │   └── auth.js
        └── views/
            ├── Login.vue
            ├── Register.vue
            ├── Dashboard.vue
            ├── SSH.vue
            └── Playback.vue
```

## 快速开始

### 前置要求

1. **MongoDB** - 确保MongoDB服务已启动并运行
2. **Go 1.21+** - 用于编译后端
3. **Node.js 16+** - 用于构建前端

### 后端启动

1. 配置环境变量（.env文件）：
```env
PORT=8080
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=web_ssh_bastion
JWT_SECRET=your-secret-key-change-in-production
```

2. 安装依赖并启动：
```bash
go mod download
go run main.go routes.go
```

后端服务将在 http://localhost:8080 启动

### 前端启动

1. 进入web目录：
```bash
cd web
```

2. 安装依赖：
```bash
npm install
```

3. 启动开发服务器：
```bash
npm run dev
```

前端服务将在 http://localhost:3000 启动

## 使用说明

### 1. 注册账号
- 访问 http://localhost:3000/register
- 输入用户名、密码和团队/租户名称
- 系统将自动创建新的租户和用户

### 2. 添加服务器
- 登录后进入仪表盘
- 点击"添加服务器"按钮
- 填写服务器信息：名称、主机地址、端口、SSH用户名和密码
- 保存后服务器将出现在服务器列表中

### 3. 连接SSH
- 在服务器列表中点击"连接"按钮
- 系统将打开Web终端并建立SSH连接
- 可以正常执行命令，高危命令将被阻断

### 4. 查看历史会话
- 在"历史会话"标签页查看所有会话记录
- 对于已结束的会话可以点击"回放"查看

### 5. 会话回放
- 在回放页面可以控制播放/暂停
- 调整回放速度
- 查看整个操作过程的完整记录

### 6. 查看告警
- 在"告警信息"标签页查看所有危险命令告警
- 包含命令内容、告警级别和时间戳

## API接口

### 认证接口
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录

### 服务器管理
- `GET /api/servers` - 获取服务器列表
- `POST /api/servers` - 添加服务器
- `DELETE /api/servers/:id` - 删除服务器

### 会话管理
- `GET /api/sessions` - 获取会话列表
- `GET /api/sessions/:id` - 获取会话详情
- `GET /api/sessions/:id/frames` - 获取会话帧数据
- `GET /api/sessions/:id/commands` - 获取命令记录

### 告警
- `GET /api/alerts` - 获取告警列表

### WebSocket
- `/ws/ssh` - SSH终端连接
- `/ws/playback` - 会话回放

## 数据模型

### Tenant（租户）
- ID: ObjectID
- Name: 租户名称
- CreatedAt: 创建时间

### User（用户）
- ID: ObjectID
- TenantID: 租户ID
- Username: 用户名
- Password: 加密密码
- Role: 角色
- CreatedAt: 创建时间

### Server（服务器）
- ID: ObjectID
- TenantID: 租户ID
- Name: 服务器名称
- Host: 主机地址
- Port: SSH端口
- SSHUser: SSH用户名
- SSHPassword: SSH密码（加密存储）
- CreatedAt: 创建时间

### Session（会话）
- ID: ObjectID
- TenantID: 租户ID
- UserID: 用户ID
- ServerID: 服务器ID
- StartTime: 开始时间
- EndTime: 结束时间
- Status: 状态（active/ended）
- ClientIP: 客户端IP

### CommandRecord（命令记录）
- ID: ObjectID
- SessionID: 会话ID
- TenantID: 租户ID
- UserID: 用户ID
- Command: 命令内容
- Output: 输出内容
- Timestamp: 时间戳
- IsDangerous: 是否危险
- Blocked: 是否已被阻断

### SessionFrame（会话帧）
- ID: ObjectID
- SessionID: 会话ID
- Timestamp: 时间戳
- Offset: 相对偏移（毫秒）
- Data: 终端输出数据

### Alert（告警）
- ID: ObjectID
- TenantID: 租户ID
- SessionID: 会话ID
- UserID: 用户ID
- Command: 触发告警的命令
- Message: 告警消息
- Level: 告警级别（critical/high）
- Timestamp: 时间戳

## 安全说明

1. **密码加密** - 用户密码和服务器密码都使用加密存储
2. **JWT认证** - 所有API接口需要JWT令牌认证
3. **多租户隔离** - 所有数据查询都带有租户ID过滤
4. **命令审计** - 所有输入命令都被记录
5. **高危阻断** - 危险命令实时检测并阻断执行

## 生产部署建议

1. **启用HTTPS** - 使用SSL证书加密所有通信
2. **强JWT密钥** - 使用复杂的JWT密钥并定期更换
3. **MongoDB认证** - 为MongoDB启用用户名密码认证
4. **SSH密钥认证** - 建议使用SSH密钥而非密码认证
5. **定期备份** - 定期备份MongoDB数据
6. **日志监控** - 监控系统日志和告警
7. **防火墙配置** - 限制后端API访问来源

## 许可证

MIT License
