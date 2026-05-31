# PDF Security Scanner

PDF安全扫描系统，使用Rust + WebAssembly实现PDF解析和恶意宏检测，后端使用FastAPI提供REST API服务。支持单文件扫描和ZIP批量扫描（最多50个PDF）。

## 功能特性

- ✅ **PDF解析**: 提取PDF中的JavaScript脚本、Action动作和嵌入式文件
- ✅ **静态分析**: 检测可疑模式（自动执行、文件写入、注册表修改等）
- ✅ **YARA规则匹配**: 使用YARA风格的规则进行恶意软件特征匹配
- ✅ **风险评估**: 五级风险等级（Safe/Low/Medium/High/Critical）
- ✅ **加密PDF检测**: 检测加密PDF并返回特定错误码
- ✅ **批量扫描**: 支持ZIP包批量扫描，最多50个PDF文件
- ✅ **异步任务队列**: 使用Celery + Redis处理异步任务
- ✅ **CSV报告**: 批量扫描完成后生成CSV格式报告
- ✅ **扫描历史**: PostgreSQL存储所有扫描记录
- ✅ **REST API**: FastAPI提供完整的API接口

## 项目结构

```
.
├── src/                    # Rust WASM源码
│   ├── lib.rs             # 主入口和WASM绑定
│   ├── pdf_parser.rs      # PDF解析器（支持加密PDF检测）
│   ├── malware_detector.rs # 恶意代码检测器
│   └── yara_matcher.rs    # YARA规则匹配器
├── backend/                # FastAPI后端
│   ├── main.py            # API主程序（含批量扫描接口）
│   ├── database.py        # 数据库模型（含批量扫描表）
│   ├── celery_app.py      # Celery配置
│   ├── tasks.py           # Celery异步任务
│   ├── requirements.txt   # Python依赖
│   ├── start_worker.bat   # Windows Celery Worker启动脚本
│   ├── start_worker.sh    # Linux/Mac Celery Worker启动脚本
│   └── .env.example       # 环境变量示例
├── Cargo.toml             # Rust项目配置
├── docker-compose.yml     # Docker Compose配置
├── Dockerfile             # Docker镜像构建
└── README.md
```

## 快速开始

### 前置要求

- Rust 1.70+
- Python 3.8+
- wasm-pack
- Redis (用于Celery任务队列)
- PostgreSQL (可选，默认使用SQLite)

### 1. 编译WASM模块

```bash
# 安装wasm-pack
cargo install wasm-pack

# 编译WASM模块
wasm-pack build --target web --out-dir pkg
```

### 2. 安装Python依赖

```bash
cd backend
pip install -r requirements.txt
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件配置：
- `REDIS_URL`: Redis连接地址
- `MAX_PDF_PER_BATCH`: 批量扫描最大PDF数量（默认50）
- `MAX_ZIP_SIZE`: ZIP文件最大字节数（默认100MB）
- `REPORT_DIR`: CSV报告存储目录

### 4. 启动Redis

```bash
# 使用Docker启动Redis
docker run -d -p 6379:6379 redis:latest
```

### 5. 启动Celery Worker

**Windows:**
```bash
cd backend
start_worker.bat
```

**Linux/Mac:**
```bash
cd backend
chmod +x start_worker.sh
./start_worker.sh
```

### 6. 启动FastAPI后端

```bash
cd backend
python main.py
```

服务将在 http://localhost:8000 启动

### 7. API文档

访问 http://localhost:8000/docs 查看Swagger API文档

## API接口

### 单文件扫描 - POST /api/scan
上传PDF文件进行扫描

**请求**:
- `file`: PDF文件 (multipart/form-data)

**响应**:
```json
{
  "risk_level": "Medium",
  "risk_score": 45,
  "malicious_code_snippets": [...],
  "extracted_scripts": [...],
  "yara_matches": [...],
  "summary": "扫描摘要",
  "scan_id": 1
}
```

**错误响应（加密PDF）**:
```json
{
  "error_code": "ENCRYPTED_PDF",
  "error_message": "PDF文件已加密，需要密码才能解析",
  "suggestion": "请上传解密后的PDF文件，或提供正确的密码后重新扫描"
}
```

### 批量扫描 - POST /api/batch/scan
上传ZIP包进行批量扫描（最多50个PDF）

**请求**:
- `file`: ZIP文件 (multipart/form-data)

**响应**:
```json
{
  "task_id": "abc123-def456-...",
  "batch_id": 1,
  "message": "批量扫描任务已创建，共10个PDF文件将被处理",
  "total_files": 10
}
```

### 查询任务状态 - GET /api/batch/status/{task_id}
轮询批量扫描任务的进度

**响应**:
```json
{
  "task_id": "abc123-def456-...",
  "batch_id": 1,
  "status": "PROCESSING",
  "total_files": 10,
  "processed_files": 7,
  "success_count": 6,
  "failed_count": 1,
  "created_at": "2024-01-01T10:00:00",
  "started_at": "2024-01-01T10:00:05",
  "completed_at": null,
  "progress": 70.0,
  "csv_report_available": false
}
```

**状态说明**:
- `PENDING`: 任务等待中
- `PROCESSING`: 正在处理
- `PROGRESS`: 处理中（带进度）
- `SUCCESS`: 处理完成
- `FAILED`: 处理失败

### 获取批量扫描结果 - GET /api/batch/result/{task_id}
获取批量扫描的完整结果

**响应**:
```json
{
  "task_id": "abc123-def456-...",
  "batch_id": 1,
  "status": "SUCCESS",
  "results": [
    {
      "filename": "document1.pdf",
      "risk_level": "Safe",
      "risk_score": 0,
      "total_scripts": 0,
      "malicious_detections": 0,
      "yara_matches": 0,
      "success": true,
      "error_message": null,
      "scanned_at": "2024-01-01T10:00:10"
    },
    ...
  ],
  "summary": {
    "total": 10,
    "processed": 10,
    "success": 9,
    "failed": 1,
    "safe": 7,
    "low": 1,
    "medium": 1,
    "high": 0,
    "critical": 0
  }
}
```

### 下载CSV报告 - GET /api/batch/report/{task_id}
下载批量扫描的CSV格式报告文件

**响应**: CSV文件下载

### 批量扫描历史 - GET /api/batch/history
获取批量扫描历史列表

**参数**:
- `skip`: 跳过数量
- `limit`: 返回数量限制

### 单文件扫描历史 - GET /api/history
获取单文件扫描历史列表

**参数**:
- `skip`: 跳过数量
- `limit`: 返回数量限制
- `risk_level`: 按风险等级过滤

### 获取单文件扫描详情 - GET /api/history/{scan_id}
获取指定扫描的详细结果

### 获取统计信息 - GET /api/statistics
获取扫描统计信息

## 风险等级说明

| 风险等级 | 分数范围 | 说明 |
|---------|---------|------|
| Safe | 0-20 | 安全，未检测到威胁 |
| Low | 21-50 | 低风险，可能包含可疑脚本 |
| Medium | 51-80 | 中风险，检测到明确的恶意特征 |
| High | 81-100 | 高风险，高度可疑的恶意PDF |
| Critical | >100 | 严重风险，确定为恶意文件 |

## 检测模式

目前支持以下检测模式：

1. **自动执行检测**: OpenAction, AutoOpen, JavaScript自动执行
2. **Shell执行检测**: cmd.exe, powershell, wscript, cscript
3. **注册表操作检测**: regOpenKey, regSetValue, HKEY_*
4. **文件系统操作检测**: WriteFile, DeleteFile, FileSystemObject
5. **网络活动检测**: XMLHttpRequest, fetch, WebSocket
6. **代码混淆检测**: eval, fromCharCode, hex编码
7. **进程创建检测**: CreateProcess, WinExec, ShellExecute
8. **嵌入式文件检测**: .exe, .dll, .bat, .vbs等可疑文件

## 开发说明

### 添加新的检测模式

在 `src/malware_detector.rs` 中的 `initialize_patterns()` 函数添加新的检测规则。

### 添加YARA规则

在 `src/yara_matcher.rs` 中的 `load_default_rules()` 函数添加新的YARA风格规则。

## 许可证

MIT License
