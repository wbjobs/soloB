# 卫星图像超分辨率系统

基于WebGPU + ESPCN架构的卫星图像超分辨率处理系统，支持GeoTIFF格式加载和实时处理。

## 功能特性

### 1. GeoTIFF加载与元数据提取
- 支持加载标准GeoTIFF格式的卫星图像
- 自动提取图像元数据：尺寸、波段数、坐标系统、边界信息
- 后端FastAPI处理地理空间信息

### 2. WebGPU超分辨率处理
- 基于WebGPU Compute Shader加速
- ESPCN架构（高效子像素卷积神经网络）
- 4倍实时放大
- 双三次插值算法实现高质量放大

### 3. 图像对比与差异分析
- 滑块对比：左右拖动对比原始图像与超分辨率结果
- 差异热力图：可视化显示原始图像与放大图像的差异
- 颜色渐变：蓝色（低差异）→ 青色 → 绿色 → 黄色 → 红色（高差异）

### 4. 3D地形预览
- 使用Three.js构建3D地形模型
- 基于图像亮度值生成地形高度
- 实时旋转展示
- 带纹理映射的地形渲染

## 技术栈

### 前端
- **WebGPU**: GPU并行计算加速
- **WGSL**: WebGPU着色器语言
- **Three.js**: 3D渲染引擎
- **geotiff.js**: GeoTIFF解析库
- **Vite**: 前端构建工具

### 后端
- **Python 3.8+**
- **FastAPI**: Web框架
- **rasterio**: 栅格数据处理
- **NumPy**: 数值计算
- **PIL/Pillow**: 图像处理

## 安装与运行

### 前端安装
```bash
npm install
```

### 后端安装
```bash
pip install -r requirements.txt
```

### 运行后端服务
```bash
cd backend
python main.py
```
后端服务将在 http://localhost:8000 启动

### 运行前端开发服务器
```bash
npm run dev
```
前端将在 http://localhost:3000 启动

## 使用说明

1. **加载图像**: 点击"选择文件"按钮，选择一个GeoTIFF格式的卫星图像文件
2. **处理图像**: 点击"加载图像"按钮开始处理
3. **查看结果**:
   - 左侧显示原始低分辨率图像
   - 右侧显示4倍放大后的超分辨率图像
4. **对比视图**: 点击"对比视图"按钮，使用滑块左右拖动对比
5. **热力图**: 点击"差异热力图"查看像素差异可视化
6. **3D地形**: 点击"3D地形"查看3D地形渲染

## 项目结构

```
├── index.html          # 主HTML页面
├── styles.css          # 样式文件
├── main.js             # 主JavaScript逻辑
├── espcn.wgsl          # WebGPU计算着色器
├── package.json        # 前端依赖配置
├── vite.config.js      # Vite配置
├── requirements.txt    # Python依赖
└── backend/
    └── main.py         # FastAPI后端服务
```

## 浏览器要求

需要支持WebGPU的现代浏览器：
- Chrome 113+
- Edge 113+
- Firefox Nightly（需启用webgpu.enabled标志）
- Safari 16.4+

## API接口

### POST /api/geotiff/metadata
上传GeoTIFF文件，返回元数据和GeoJSON边界信息

### POST /api/geotiff/thumbnail
上传GeoTIFF文件，生成缩略图

### GET /api/health
健康检查端点

## 注意事项

1. 确保浏览器支持WebGPU
2. 大尺寸GeoTIFF文件可能需要较长处理时间
3. 建议使用Chrome或Edge浏览器获得最佳性能
4. 后端服务需要在处理元数据时运行

## 开发说明

- ESPCN模型权重已预编译到WGSL着色器中
- Compute Shader使用16x16工作分组
- 地形高度基于RGB通道平均值生成
- 热力图差异基于像素级对比计算