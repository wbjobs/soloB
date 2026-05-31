# 低代码数据源连接器平台

一个功能完整的低代码平台，支持通过UI配置生成各种数据源的Node.js连接器代码。

## 功能特性

### 支持的数据源类型
- **MySQL** - 关系型数据库连接器
- **PostgreSQL** - 关系型数据库连接器  
- **MongoDB** - NoSQL数据库连接器
- **REST API** - HTTP API连接器

### 核心功能
1. **可视化配置** - 通过表单UI配置数据源连接参数
2. **代码生成** - 自动生成完整的Node.js连接器代码
3. **在线测试** - 在Docker容器中测试连接
4. **测试容器** - 动态创建临时数据库容器进行测试
5. **NPM导出** - 将连接器打包为可下载的NPM包
6. **代码编辑器** - 集成Monaco Editor展示生成的代码

## 技术栈

### 后端
- Node.js + Express
- TypeScript
- PostgreSQL + Sequelize
- Dockerode (Docker容器管理)
- Archiver (ZIP打包)

### 前端
- Vue 3 + TypeScript
- Vite
- Element Plus UI框架
- Monaco Editor (代码编辑器)
- Vue Router + Pinia

## 快速开始

### 环境要求
- Node.js 18+
- Docker (用于容器测试功能)
- PostgreSQL (用于存储配置)

### 安装依赖

```bash
# 安装根目录依赖
npm install

# 安装后端依赖
cd server && npm install

# 安装前端依赖
cd client && npm install
```

### 配置环境变量

在 `server` 目录创建 `.env` 文件：

```env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=lowcode_datasource
DB_USER=postgres
DB_PASSWORD=your_password
DOCKER_SOCKET_PATH=/var/run/docker.sock
```

### 启动开发服务

```bash
# 启动后端 (端口 3000)
cd server && npm run dev

# 启动前端 (端口 5173)
cd client && npm run dev
```

或者使用根目录的并发命令：
```bash
npm run dev
```

### 构建生产版本

```bash
npm run build
```

## 项目结构

```
lowcode-datasource-platform/
├── server/                 # 后端服务
│   ├── src/
│   │   ├── config/        # 配置文件
│   │   ├── controllers/   # 控制器
│   │   ├── models/        # 数据模型
│   │   ├── services/      # 业务服务
│   │   ├── routes/        # 路由
│   │   └── index.ts       # 入口文件
│   ├── package.json
│   └── tsconfig.json
├── client/                # 前端应用
│   ├── src/
│   │   ├── components/    # 组件
│   │   ├── views/        # 页面视图
│   │   ├── api/          # API调用
│   │   ├── types/        # TypeScript类型
│   │   └── main.ts       # 入口文件
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── package.json
└── README.md
```

## API 接口

### 数据源管理
- `POST /api/data-sources` - 创建数据源
- `GET /api/data-sources` - 获取数据源列表
- `GET /api/data-sources/:id` - 获取单个数据源
- `PUT /api/data-sources/:id` - 更新数据源
- `DELETE /api/data-sources/:id` - 删除数据源

### 代码生成与测试
- `POST /api/data-sources/generate-code` - 生成连接器代码
- `POST /api/data-sources/:id/test-connection` - 测试连接
- `POST /api/data-sources/test-container` - 创建测试容器
- `DELETE /api/data-sources/test-container/:id` - 停止容器
- `POST /api/data-sources/:id/export-npm` - 导出NPM包

## 使用说明

### 1. 创建数据源
1. 点击"新建数据源"按钮
2. 输入数据源名称
3. 选择数据源类型 (MySQL/PostgreSQL/MongoDB/REST API)
4. 填写连接配置信息
5. 点击"预览代码"查看生成的连接器
6. 点击"创建数据源"保存

### 2. 测试连接
- **方法一**：保存数据源后点击"测试连接"，系统会在隔离的Docker容器中测试连接
- **方法二**：点击"创建测试容器"创建一个临时数据库容器，自动填充凭据后测试

### 3. 导出NPM包
点击"导出NPM"按钮，输入版本号，系统会将生成的连接器代码打包为ZIP文件。

## 生成的连接器示例

每个数据源类型都会生成一个完整的Node.js类，包含以下功能：

- 连接管理 (connect/close)
- 测试连接 (testConnection)
- 数据库查询/操作方法
- 完整的类型支持

## License

MIT
