# 地质体三维建模工具 - LOD优化版

基于Three.js和FastAPI的高性能地质体三维建模工具，支持大规模钻孔数据的可视化，通过LOD（细节层次）技术和分块传输解决大文件内存溢出问题。

## 核心优化特性

### 1. LOD（细节层次）分级加载
- **LOD 0 (高精度)**: 近距离时显示完整分辨率网格，确保细节
- **LOD 1-3 (渐进简化)**: 随距离增加自动降低网格精度
- **动态切换**: 基于相机距离自动在不同LOD级别间切换

### 2. 数据分块传输
- **空间分块**: 按200m×200m网格将模型分割为多个数据块
- **按需加载**: 仅加载视锥体范围内的块
- **流式传输**: 支持HTTP流式传输，渐进式渲染
- **内存管理**: 自动卸载不可见块的资源

### 3. 视锥体剔除
- 实时计算视锥体
- 基于包围球进行可见性判断
- 自动卸载不可见块，释放显存

### 4. 钻孔距离分级渲染
- 只渲染相机附近的钻孔（500m范围内）
- 远处钻孔不加载，显著降低绘制调用

## 技术架构

### 后端 (FastAPI)
```
backend/
├── main.py              # API入口
├── requirements.txt     # Python依赖
└── core/
    ├── interpolation.py    # 插值算法（克里金/IDW）
    ├── mesh_simplify.py    # 网格简化算法
    ├── chunk_manager.py    # 分块管理
    ├── virtual_drill.py    # 虚拟钻探逻辑
    └── streaming.py        # 流式传输处理
```

### 前端 (Three.js)
```
frontend/
├── index.html           # 主页面
├── package.json         # Node依赖
├── vite.config.js       # Vite配置
└── src/
    ├── main.js          # 应用入口
    ├── style.css        # 样式
    └── core/
        ├── ChunkManager.js    # 分块管理
        ├── BoreholeManager.js # 钻孔管理
        └── PerformanceMonitor.js # 性能监控
```

## API接口

### 分块插值
```
POST /api/chunk/interpolate
Content-Type: application/json

{
  "boreholes": [...],
  "stratigraphic_index": 0,
  "method": "kriging",
  "grid_size": 10,
  "chunk_index": [0, 0],
  "chunk_size": 200,
  "lod_level": 0
}
```

### 流式插值
```
POST /api/stream/interpolate
Content-Type: application/json
Accept: application/x-ndjson

响应: NDJSON流，逐块返回
{"type": "metadata", ...}
{"type": "chunk", "chunk_index": [0,0], "vertices": [...], ...}
{"type": "complete"}
```

### 钻孔分块
```
POST /api/boreholes/chunk
Content-Type: application/json

{
  "boreholes": [...],
  "chunk_index": [0, 0],
  "chunk_size": 200
}
```

### 内存使用说明

| 钻孔数量 | 分块数 | 顶点数 (平均) | 预计显存 |
|---------|--------|--------------|---------|
| 100     | 16     | 50k          | 20MB    |
| 500     | 64     | 200k         | 80MB    |
| 1000    | 100+   | 500k+        | 200MB+  |

使用LOD后，远处网格顶点数可减少75%-90%，显著降低内存占用。

## 快速开始

### 后端启动
```bash
cd backend
pip install -r requirements.txt
python main.py
```

### 前端启动
```bash
cd frontend
npm install
npm run dev
```

访问 http://localhost:3000

## 使用说明

### 基本流程
1. **设置钻孔数量**: 在数据管理面板输入想要加载的钻孔数（10-1000）
2. **加载数据**: 点击"加载示例钻孔数据"
3. **选择参数**: 选择插值方法、地层序号、网格大小
4. **生成曲面**: 点击"生成地层曲面"，可选择是否启用流式加载

### 虚拟钻探功能
1. **加载钻孔数据**: 确保已加载钻孔数据
2. **点击场景**: 在3D场景中任意位置点击
3. **查看结果**: 右侧面板显示钻探结果：
   - 钻探位置坐标和地表高程
   - 最近钻孔信息和距离
   - 综合置信度评分（颜色条显示）
   - 岩性柱状图，每层显示置信度
4. **钻探标记**: 3D场景中显示旗帜标记钻探位置
5. **清除标记**: 点击"清除钻探标记"删除所有标记

### 置信度评分说明
置信度评分基于三个因素：
- **距离因素 (40%)**: 距最近钻孔越近，置信度越高
- **方差因素 (40%)**: 克里金插值方差越小，置信度越高
- **数据密度 (20%)**: 周围钻孔数量越多，置信度越高

每层岩性还会额外考虑岩性预测的加权置信度

### 性能监控
左侧面板实时显示：
- FPS帧率
- 顶点数量
- 三角形数量
- 分块数量

### 视图操作
- **左键拖动**: 旋转视角
- **滚轮**: 缩放（触发LOD切换）
- **右键拖动**: 平移

### LOD测试方法
1. 加载大量钻孔（如200个）
2. 生成地层曲面
3. 逐步拉远相机
4. 观察"三角形数量"指标下降
5. 拉近相机时指标回升，说明LOD正常工作

## 岩性颜色对照表

| 岩性 | 颜色代码 |
|------|----------|
| 花岗岩 | #8B4513 |
| 片麻岩 | #696969 |
| 石英岩 | #FFFAF0 |
| 大理岩 | #FFFFFF |
| 矽卡岩 | #228B22 |
| 矿体 | #FFD700 |

## 性能优化建议

1. **调整分块大小**: 根据数据范围调整CHUNK_SIZE参数
2. **LOD距离阈值**: 根据场景大小调整LOD_DISTANCES数组
3. **网格大小**: 对于超大规模数据，使用更大的grid_size
4. **浏览器设置**: 启用硬件加速，关闭不必要的浏览器标签

## 未来改进方向

- [ ] GPU实例化渲染钻孔
- [ ] WebWorker后台计算
- [ ] 增量式LOD更新
- [ ] 视锥体预加载预测
- [ ] 地形纹理LOD
- [ ] 压缩纹理传输
