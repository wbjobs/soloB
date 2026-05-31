# HEVC 视频转码工具

基于 Tauri + FFmpeg 的 H.265/HEVC 视频转码桌面应用，支持硬件加速和批量转码。

## 功能特性

### 🎬 核心转码功能
- **H.265/HEVC 编码**：使用 libx265 进行高质量软件编码
- **硬件加速支持**：
  - NVIDIA NVENC (NVIDIA显卡硬件编码)
  - Intel QSV (Intel快速同步视频)
  - AMD AMF (AMD硬件编码)
- **自动硬件检测**：启动时自动检测可用硬件编码器

### 📋 队列管理
- **批量转码队列**：支持同时添加多个转码任务
- **并行任务控制**：可配置最大同时转码任务数 (1-8)
- **任务状态实时更新**：排队中、转码中、已完成、失败等状态

### 📊 实时进度监控
- **转码进度条**：百分比显示
- **实时 FPS**：当前编码帧率
- **已用时间/剩余时间**：智能估算
- **实时事件推送**：Tauri 事件系统推送进度更新

### ⚙️ 预设配置
- **4K → 1080p**：快速分辨率转换
- **HDR → SDR 色调映射**：转换高动态范围视频
- **快速编码**：优先速度，质量其次
- **高质量编码**：优先质量，速度其次
- **小体积输出**：优先压缩率

### 🖼️ 缩略图预览
- **9宫格缩略图**：转码完成后自动生成视频关键帧网格
- **快速预览**：直观查看转码结果质量

## 技术栈

### 后端 (Rust)
- **Tauri**：桌面应用框架
- **Tokio**：异步运行时
- **FFmpeg**：视频处理后端（外部依赖）
- **serde**：序列化/反序列化
- **sysinfo**：系统信息检测

### 前端 (React + TypeScript)
- **Vite**：构建工具
- **React 18**：UI框架
- **Tailwind CSS**：样式框架
- **Lucide React**：图标库

## 项目结构

```
b87/
├── src/                          # 前端源码
│   ├── App.tsx                   # 主应用组件
│   ├── main.tsx                  # 入口文件
│   ├── types.ts                  # TypeScript 类型定义
│   ├── tauriApi.ts               # Tauri API 封装
│   └── index.css                 # 全局样式
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── main.rs               # Tauri 主入口
│   │   ├── transcoder.rs         # 转码管理器核心
│   │   ├── types.rs              # Rust 类型定义
│   │   ├── hardware.rs           # 硬件加速检测
│   │   └── thumbnail.rs          # 缩略图生成
│   ├── Cargo.toml                # Rust 依赖配置
│   └── tauri.conf.json           # Tauri 配置
├── index.html                    # HTML 入口
├── vite.config.ts                # Vite 配置
├── tsconfig.json                 # TypeScript 配置
├── tailwind.config.js            # Tailwind 配置
├── postcss.config.js             # PostCSS 配置
└── package.json                  # Node.js 依赖
```

## 系统要求

### 前置依赖
1. **FFmpeg & FFprobe**：
   - 下载地址：https://ffmpeg.org/download.html
   - 需要添加到系统 PATH 环境变量
   - 建议使用 full 版本以支持所有编码器

2. **Rust 工具链**：
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

3. **Node.js 18+** 和 **npm**

## 安装与运行

### 开发模式

1. 安装前端依赖：
   ```bash
   npm install
   ```

2. 启动开发服务器：
   ```bash
   npm run tauri dev
   ```

### 构建生产版本

```bash
npm run tauri build
```

构建产物位于 `src-tauri/target/release/` 目录。

## 使用说明

### 1. 添加视频
- 点击主界面的文件选择区域
- 选择要转码的视频文件（支持 MP4, MKV, AVI, MOV, WMV, FLV, WEBM）
- 系统会自动分析视频信息并显示

### 2. 配置转码参数
右侧设置面板可配置：
- **预设配置**：快速选择常用配置
- **CRF 质量**：0-51，值越低质量越高
- **编码预设**：从超快到很慢，影响编码速度和压缩率
- **分辨率调整**：自定义输出分辨率
- **HDR → SDR**：启用色调映射
- **硬件加速**：选择硬件编码器
- **并行任务数**：最大同时转码任务数

### 3. 添加到队列
- 点击「添加到队列」按钮
- 选择输出文件路径
- 视频任务添加到转码队列

### 4. 开始转码
- 点击「开始转码」按钮
- 实时查看转码进度、FPS、剩余时间
- 转码完成后自动显示9宫格缩略图预览

## API 参考 (Tauri Commands)

后端提供的主要命令：

| 命令 | 功能 |
|------|------|
| `get_video_info(path)` | 获取视频文件信息 |
| `add_to_queue(input, output, config)` | 添加转码任务到队列 |
| `start_transcoding()` | 启动转码队列处理 |
| `cancel_transcoding(job_id)` | 取消指定转码任务 |
| `remove_from_queue(job_id)` | 从队列移除任务 |
| `get_queue_status()` | 获取所有队列任务状态 |
| `set_max_parallel(n)` | 设置最大并行任务数 |
| `detect_hardware_acceleration()` | 检测硬件加速支持 |
| `generate_thumbnail_grid(video_path)` | 生成视频缩略图网格 |

## 事件系统

转码进度通过 Tauri 事件实时推送：
- 事件名：`transcoding_progress`
- 数据结构：
  ```typescript
  {
    job_id: string,
    progress: number,    // 百分比 0-100
    fps: number,         // 当前帧率
    elapsed: number,     // 已用秒数
    remaining?: number,  // 剩余秒数
    frame: number        // 已编码帧数
  }
  ```

## 常见问题

### Q: 硬件加速选项不可用？
A: 请确保：
1. 你的显卡支持相应的硬件编码 (NVENC/QSV/AMF)
2. FFmpeg 已编译启用相应的编码器支持
3. 显卡驱动已更新到最新版本

### Q: 转码速度很慢？
A: 可以尝试：
- 启用硬件加速（如果可用）
- 选择更快的编码预设 (fast, faster)
- 提高 CRF 值 (降低质量要求)
- 减少并行任务数

### Q: 输出视频没有声音？
A: 本应用默认复制音频流，不进行重编码。请确保：
- 输入视频的音频编码被输出格式支持
- 输入视频没有损坏

## 许可证

MIT License
