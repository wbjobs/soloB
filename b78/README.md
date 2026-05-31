# Satellite Cloud Removal API

基于 Python + FastAPI 的卫星遥感图像去云服务，支持多时相图像融合自动去除云层遮挡。

## 功能特性

- **GDAL 处理 GeoTIFF**: 专业的遥感影像读写支持
- **云层检测**: 基于亮度阈值和形态学操作的云检测算法
- **图像配准**: ECC 算法实现多时相图像的自动配准
- **泊松融合**: 无缝修复遮挡区域，保持边界自然过渡
- **批量任务队列**: Redis + Celery 实现异步任务处理
- **REST API**: 完整的任务管理接口

## 技术栈

- **后端框架**: FastAPI
- **任务队列**: Celery + Redis
- **图像处理**: OpenCV, scikit-image, NumPy
- **地理数据**: GDAL (可选，无GDAL时降级使用常规图像格式)
- **部署**: Docker, docker-compose

## 快速开始

### 方式一：Docker Compose (推荐)

```bash
docker-compose up -d
```

服务访问地址:
- API: http://localhost:8000
- API 文档: http://localhost:8000/docs
- Flower (任务监控): http://localhost:5555

### 方式二：本地运行

#### 前置要求
- Python 3.10+
- Redis
- GDAL (可选，推荐安装)

#### 安装依赖

```bash
pip install -r requirements.txt
```

#### 启动服务

**Windows**:
```bash
start.bat
```

**Linux/Mac**:
```bash
chmod +x start.sh
./start.sh
```

或者手动启动:
```bash
# 1. 启动 Redis
redis-server

# 2. 启动 Celery Worker (新终端)
celery -A celery_worker.celery_app worker --loglevel=info

# 3. 启动 FastAPI (新终端)
uvicorn main:app --reload
```

## API 接口

### 1. 创建任务 - 上传图像并去云

```
POST /api/v1/tasks
```

**请求**:
- `files`: 多个 GeoTIFF/JPG/PNG 图像文件（至少2张）
- `cloud_threshold`: 可选，云检测阈值 (默认 0.6)

**示例 (curl)**:
```bash
curl -X POST "http://localhost:8000/api/v1/tasks" \
  -H "Content-Type: multipart/form-data" \
  -F "files=@image1.tif" \
  -F "files=@image2.tif" \
  -F "cloud_threshold=0.6"
```

**响应**:
```json
{
  "task_id": "uuid-string",
  "status": "queued",
  "num_images": 2,
  "created_at": "2024-01-01T00:00:00"
}
```

### 2. 查询任务状态

```
GET /api/v1/tasks/{task_id}
```

**响应**:
```json
{
  "task_id": "uuid-string",
  "status": "completed",
  "result_exists": true,
  "result_file_size": 1234567,
  "download_url": "/api/v1/tasks/{task_id}/download"
}
```

状态说明:
- `queued`: 任务排队中
- `processing`: 处理中
- `completed`: 已完成
- `failed`: 失败
- `unknown`: 未知状态

### 3. 下载处理结果

```
GET /api/v1/tasks/{task_id}/download
```

返回修复后的 GeoTIFF 图像文件。

### 4. 列出所有已完成任务

```
GET /api/v1/tasks
```

### 5. 删除任务

```
DELETE /api/v1/tasks/{task_id}
```

### 6. 健康检查

```
GET /health
```

## 核心算法说明

### 1. 云层检测流程

1. **亮度计算**: 计算 RGB 通道平均亮度
2. **对比度增强**: 直方图均衡化增强对比度
3. **阈值分割**: 亮度高于阈值视为云
4. **形态学操作**: 开闭运算去除噪声
5. **区域过滤**: 移除微小区域

### 2. 图像配准

使用 ECC (Enhanced Correlation Coefficient) 算法估计仿射变换参数，将所有图像对齐到参考图像。

### 3. 多时相融合策略

1. **选择参考图像**: 云量最少的图像作为基准
2. **逐区域填充**: 检测到云的区域，从其他时相中寻找无云区域进行修复
3. **泊松融合**: 实现无缝边界过渡
4. **亮度归一化**: 匹配源和目标区域的亮度统计特征

## 项目结构

```
.
├── main.py              # FastAPI 主应用
├── celery_worker.py     # Celery 任务定义
├── image_processing.py  # 核心图像处理模块
├── config.py            # 配置文件
├── requirements.txt     # Python 依赖
├── Dockerfile           # Docker 镜像构建
├── docker-compose.yml   # Docker Compose 编排
├── start.sh             # Linux/Mac 启动脚本
├── start.bat            # Windows 启动脚本
├── uploads/             # 上传文件存储
└── results/             # 处理结果存储
```

## 图像处理模块类说明

### `GeoTIFFProcessor`
- `read_geotiff_gdal()`: 读取 GeoTIFF，保留地理坐标
- `write_geotiff_gdal()`: 写入 GeoTIFF 结果

### `CloudDetector`
- `detect_clouds()`: 检测图像中的云层区域

### `ImageRegistrar`
- `register_images()`: 将移动图像配准到参考图像

### `PoissonBlender`
- `poisson_blend()`: 泊松融合实现无缝拼接

### `CloudRemovalPipeline`
- `process()`: 完整的去云处理流程

## 性能优化建议

1. **并发数调整**: 根据 CPU 核心数调整 Celery worker 的 `concurrency` 参数
2. **图像处理**: 对于超大图像，考虑分块处理
3. **GDAL 安装**: 安装 GDAL 以获得最佳的 GeoTIFF 处理性能

## 开发说明

### 添加新的去云算法

在 `image_processing.py` 中添加新类，实现自己的算法，然后在 `CloudRemovalPipeline` 中集成。

### API 扩展

在 `main.py` 中添加新的 FastAPI 路由。

## License

MIT License
