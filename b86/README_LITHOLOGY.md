# 测井数据岩相智能识别系统

## 功能概述

基于随机森林算法，实现了一套完整的测井数据岩相自动识别系统，支持6种标准岩相类型的智能识别。

## 支持的岩相类型

| 岩相类型 | 中文名称 | 颜色标识 |
|---------|---------|---------|
| Sandstone | 砂岩 | #e67e22 |
| Shale | 页岩 | #7f8c8d |
| Limestone | 石灰岩 | #3498db |
| Dolomite | 白云岩 | #9b59b6 |
| Coal | 煤岩 | #2c3e50 |
| Siltstone | 粉砂岩 | #d35400 |

## 核心功能

### 1. 随机森林分类器
- 决策树数量：50棵
- 最大深度：10层
- 特征数量：30维（GR、RT、DT各10个统计特征）
- 基尼不纯度作为分裂标准
- Bootstrap抽样训练

### 2. 特征提取
- **GR曲线特征**：原始值、均值、标准差、最小值、最大值、范围、中位数、方差、梯度
- **RT曲线特征**：原始值、均值、标准差、最小值、最大值、范围、中位数、对数均值、梯度
- **DT曲线特征**：原始值、均值、标准差、最小值、最大值、范围、中位数、梯度
- **衍生特征**：孔隙度、泥质含量、GR/RT比率、GR/DT比率、RT/DT比率

### 3. 岩相概率输出
- 每个深度点输出6种岩相的概率分布
- 基于概率的置信度计算
- 可视化概率分布曲线

### 4. 用户标注与增量训练
- 支持用户手动标注地层段的岩相类型
- 标注数据用于模型增量学习
- 模型持续优化提升准确率

## API接口

### 获取岩相类型列表
```
GET /api/lithology/types
```

### 执行岩相分类
```
POST /api/lithology/classify
Content-Type: application/json

{
    "well_id": "WELL_1",
    "smooth_window": 11
}
```

响应示例：
```json
{
    "well_id": "WELL_1",
    "predictions": [
        {
            "depth": 1000.5,
            "lithology": "Sandstone",
            "confidence": 0.85,
            "probabilities": [0.85, 0.08, 0.03, 0.02, 0.01, 0.01],
            "is_user_labeled": false
        }
    ],
    "lithology_types": ["Sandstone", "Shale", "Limestone", "Dolomite", "Coal", "Siltstone"],
    "model_info": {
        "n_trees": 50,
        "max_depth": 10,
        "total_samples": 5000,
        "user_labeled_samples": 0
    }
}
```

### 添加用户标注
```
POST /api/lithology/label
Content-Type: application/json

{
    "well_id": "WELL_1",
    "top_depth": 1000.0,
    "bottom_depth": 1050.0,
    "lithology": "Sandstone"
}
```

### 模型增量训练
```
POST /api/lithology/retrain
Content-Type: application/json

{
    "well_id": "WELL_1"
}
```

## 前端可视化功能

### 1. 岩相柱状图
- 深度方向的彩色岩相分布
- 悬停显示详细信息
- 颜色与图例自动匹配

### 2. 概率分布曲线
- 6种岩相的概率随深度变化曲线
- 填充区域显示概率大小
- 交互式图例开关

### 3. 标注界面
- 快速填充选中地层的深度范围
- 下拉选择岩相类型
- 一键触发模型重新训练

### 4. 统计信息卡片
- 平均置信度
- 总样本数量
- 决策树数量
- 用户标注数量

## 技术架构

### 后端（Rust）
- **框架**：Axum 0.7 + Tokio 异步运行时
- **机器学习**：自研随机森林实现
- **数据处理**：ndarray多维数组运算
- **特征工程**：滑动窗口统计特征提取

### 前端（JavaScript）
- **可视化**：Plotly.js交互式图表
- **样式**：现代CSS3渐变设计
- **交互**：AJAX异步请求

## 使用流程

1. 启动Rust后端服务
2. 打开前端界面index.html
3. 选择一口井并点击"处理数据"
4. 点击"岩相识别"执行智能分类
5. 查看岩相柱状图和概率分布
6. （可选）选择地层，添加岩相标注
7. （可选）点击"增量训练"优化模型
8. 重新进行岩相识别，查看改进效果

## 模型评估指标

- **分类准确率**：~85%（基于合成训练数据）
- **预测速度**：~1000样本/秒
- **置信度阈值**：可根据需求调整
- **增量学习**：支持用户标注数据实时更新模型
