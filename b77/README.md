# WebAssembly Ray Tracer

一个基于 WebAssembly 的实时光线追踪 Web 应用。

## 功能特性

- **React + TypeScript 前端**：现代化的用户界面，使用 Zustand 进行状态管理
- **Rust + WebAssembly 后端**：高性能光线追踪计算
- **OBJ 场景上传**：支持上传 OBJ 格式的 3D 模型文件
- **分块渐进式渲染**：16x16 像素分块渲染，通过 WebSocket 实时推送结果
- **调试模式**：查看每个像素的光线反弹路径、相交三角形、着色计算中间值
- **参数可配置**：采样数、反射深度、光源位置、渲染分辨率

## 技术栈

### 前端
- React 18 + TypeScript
- Vite
- Zustand (状态管理)
- Tailwind CSS (样式)
- WebSocket (实时通信)

### 后端
- Rust 1.75+
- Actix Web (Web 框架)
- WebAssembly (WASM)
- PostgreSQL (任务队列)

## 快速开始

### 方式一：使用 Docker Compose (推荐)

```bash
# 启动所有服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

访问 http://localhost:3000

### 方式二：本地开发

#### 后端

```bash
cd backend

# 开发模式运行
cargo run

# 或发布模式
cargo run --release
```

后端服务将在 http://localhost:8080 启动

#### 前端

```bash
cd frontend

# 安装依赖
npm install

# 开发模式运行
npm run dev
```

前端开发服务器将在 http://localhost:3000 启动

## 使用说明

### 1. 上传 OBJ 文件

- 点击左侧面板的文件上传区域，或拖拽 OBJ 文件到该区域。
- 项目根目录提供了 `example.obj` 作为测试文件。

### 2. 配置渲染参数

- **采样数 (Samples)**：每个像素的采样数量，值越高画面越平滑但渲染越慢
- **反射深度 (Max Depth)**：光线最大反弹次数，值越高反射效果越好
- **光源位置 (Light Position)**：3D 空间中光源的 X、Y、Z 坐标
- **分辨率 (Resolution)**：渲染图像的宽度和高度

### 3. 开始渲染

点击 "Start Render" 按钮开始渲染。渲染过程中可以看到：
- 分块渐进式显示渲染结果
- 实时渲染进度条
- 任务状态更新

### 4. 调试模式

1. 点击右侧面板启用调试模式
2. 在渲染画布上点击任意像素
3. 查看该像素的详细调试信息：
   - 光线反弹路径树
   - 相交三角形信息
   - 着色计算中间值

## 项目结构

```
.
├── frontend/              # React 前端
│   ├── src/
│   │   ├── components/  # React 组件
│   │   ├── store/     # Zustand 状态管理
│   │   ├── hooks/     # 自定义 Hooks
│   │   ├── App.tsx    # 主应用组件
│   │   └── main.tsx   # 入口文件
│   ├── package.json
│   ├── vite.config.ts
│   └── Dockerfile
├── backend/              # Rust 后端
│   ├── src/
│   │   ├── main.rs      # Actix Web 服务器
│   │   └── raytracer/   # 光线追踪核心
│   │       ├── vec3.rs      # 3D 向量
│   │       ├── ray.rs       # 光线
│   │       ├── hit.rs       # 碰撞检测
│   │       ├── camera.rs    # 摄像机
│   │       ├── material.rs  # 材质系统
│   │       ├── obj_loader.rs # OBJ 文件解析
│   │       └── renderer.rs  # 渲染器
│   ├── Cargo.toml
│   └── Dockerfile
├── docker-compose.yml
├── example.obj          # 示例 OBJ 文件
└── README.md
```

## API 接口

### WebSocket 消息格式

#### 渲染请求
```json
{
  "type": "render_request",
  "obj_data": "...",
  "params": {
    "samples": 8,
    "max_depth": 5,
    "light_position": { "x": 5, "y": 5, "z": 5 },
    "resolution": [512, 512]
  }
}
```

#### 分块结果
```json
{
  "type": "tile_result",
  "tile_x": 0,
  "tile_y": 0,
  "tile_width": 16,
  "tile_height": 16,
  "pixels": [...],
  "samples_completed": 8
}
```

#### 任务状态
```json
{
  "type": "task_status",
  "task_id": "...",
  "status": "rendering",
  "progress": 0.5,
  "total_tiles": 1024,
  "completed_tiles": 512
}
```

#### 调试像素请求
```json
{
  "type": "debug_pixel",
  "x": 256,
  "y": 256
}
```

## 开发计划

- [x] 前端项目结构搭建
- [x] 光线追踪核心算法实现
- [x] WebSocket 实时通信
- [x] OBJ 文件解析和上传
- [x] 分块渐进式渲染
- [x] 调试模式功能
- [x] Docker 容器化
- [ ] PostgreSQL 任务队列集成
- [ ] 更多材质类型支持
- [ ] 多线程渲染优化
- [ ] 纹理映射支持
- [ ] 动画渲染队列管理

## 许可证

MIT
