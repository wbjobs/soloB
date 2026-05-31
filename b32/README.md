# Semantic Code Search

一个基于 Tauri + Rust + Vue.js 的跨平台桌面应用，用于对本地代码库进行语义搜索。

## 功能特性

- **语义搜索**: 使用 BAAI/bge-small-zh-v1.5 嵌入模型进行自然语言代码搜索
- **多语言支持**: 支持 Rust (.rs)、Python (.py)、JavaScript (.js) 文件
- **本地向量存储**: 使用 Qdrant 嵌入式向量数据库
- **实时索引**: 扫描目录并自动提取函数和类定义

## 技术栈

### 前端
- Vue 3 + TypeScript
- Vite
- Tauri API

### 后端 (Rust)
- Tauri: 桌面应用框架
- ONNX Runtime: 嵌入模型推理
- Hugging Face Tokenizers: 文本分词
- Qdrant: 向量数据库
- Walkdir: 文件系统遍历

## 前置要求

### 系统依赖
1. **Node.js 18+** (推荐 20 LTS)
2. **Rust 工具链** (1.70+)
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
3. **Tauri 系统依赖**:
   - Windows: WebView2 运行时 (Windows 11 已预装)
   - macOS: Xcode 命令行工具
   - Linux: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev` 等

### Windows 额外配置
确保设置以下环境变量：
```powershell
$env:Path += ";C:\Program Files\Git\mingw64\bin"
$env:Path += ";C:\Program Files\7-Zip"
```

## 安装

1. 安装前端依赖：
```bash
npm install
```

2. 构建 Rust 后端：
```bash
npm run tauri build
```

## 开发模式

```bash
npm run tauri dev
```

## 使用说明

1. 启动应用后，点击"选择目录"按钮选择要索引的代码目录
2. 等待应用扫描文件、生成嵌入向量并存储到向量数据库
3. 在搜索框中输入自然语言查询，例如：
   - "找出所有处理用户登录的逻辑"
   - "查找数据库连接相关的代码"
   - "搜索错误处理函数"
4. 查看匹配的代码片段及其相似度分数

## 项目结构

```
.
├── src/                    # Vue.js 前端
│   ├── App.vue            # 主应用组件
│   ├── main.ts            # 入口文件
│   └── style.css          # 全局样式
├── src-tauri/             # Rust 后端
│   ├── src/
│   │   ├── main.rs        # 主入口
│   │   ├── lib.rs         # 库文件
│   │   ├── embedding.rs   # 嵌入模型模块
│   │   ├── code_parser.rs # 代码解析模块
│   │   ├── vector_db.rs   # 向量数据库模块
│   │   └── commands.rs    # Tauri 命令接口
│   ├── Cargo.toml         # Rust 依赖
│   └── tauri.conf.json    # Tauri 配置
├── package.json           # Node.js 依赖
└── vite.config.ts         # Vite 配置
```

## 核心模块说明

### embedding.rs
- 集成 BAAI/bge-small-zh-v1.5 ONNX 模型
- 自动从 Hugging Face 下载模型
- 文本嵌入向量化

### code_parser.rs
- 遍历 .rs, .py, .js 文件
- 基于语法特征提取函数和类定义
- 支持嵌套结构解析

### vector_db.rs
- Qdrant 嵌入式模式集成
- 向量存储和相似度搜索
- 余弦相似度计算

## 注意事项

1. **首次运行**: 会自动下载嵌入模型（约 100MB），需要网络连接
2. **索引时间**: 大代码库的索引可能需要较长时间
3. **磁盘空间**: 向量数据库会占用额外的磁盘空间

## License

MIT
