# 预测性查询诊断系统

基于Prophet时序预测模型的数据库查询性能预测与智能优化建议系统。

## 🌟 核心功能

### 1. 📈 时序预测 (Prophet)
- 基于Facebook Prophet的时序预测模型
- 自动检测日/周季节性模式
- 提前30分钟预测查询性能变化
- 异常检测与置信度评估
- 模型持久化与交叉验证

### 2. 🔍 SQL模式分析引擎
- 解析SQL语句提取查询模式
- 自动识别查询类型 (SELECT/INSERT/UPDATE/DELETE)
- 提取WHERE条件、JOIN关联、ORDER BY、GROUP BY列
- 检测子查询和聚合函数
- 标准化SQL生成查询哈希

### 3. 💡 智能索引推荐
- 基于查询模式分析生成索引建议
- 支持单列、组合、覆盖索引推荐
- 评估索引创建风险级别
- 预测性能改进百分比
- 生成详细优化报告和行动建议

### 4. 📢 多渠道告警系统
- **邮件告警**: SMTP支持，HTML格式
- **Webhook**: 自定义HTTP回调
- **Slack集成**: 实时消息推送
- 告警去重与阈值控制
- 告警确认与解决工作流

### 5. 🎨 可视化管理界面
- 仪表盘概览: 实时统计与异常监控
- 查询列表与详情: 性能趋势图表
- 模型管理: 训练状态与评估指标
- 告警中心: 告警列表与渠道配置
- SQL分析工具: 在线分析与索引推荐

## 📁 项目结构

```
predictive/
├── __init__.py                    # 包初始化
├── requirements.txt               # 依赖配置
├── start_server.py               # 服务器启动脚本
├── demo.py                       # 功能演示脚本
│
├── models/                       # 数据模型层
│   ├── __init__.py
│   └── models.py                 # 核心数据结构 (QueryMetrics, PredictionResult, IndexRecommendation, Alert, ModelTrainingState)
│
├── timeseries/                   # 时序数据处理层
│   ├── __init__.py
│   └── processor.py              # TimeSeriesProcessor - 数据收集、预处理、聚合
│
├── predictor/                    # 预测模型层
│   ├── __init__.py
│   └── prophet_model.py          # QueryPerformancePredictor - Prophet模型训练、预测、异常检测
│
├── sql_analyzer/                 # SQL分析层
│   ├── __init__.py
│   └── parser.py                 # SQLPatternAnalyzer - SQL解析、模式提取、候选索引建议
│
├── index_recommender/            # 索引推荐层
│   ├── __init__.py
│   └── recommender.py            # IndexRecommender - 智能索引推荐、优化报告生成
│
├── alerting/                     # 告警系统层
│   ├── __init__.py
│   └── alert_manager.py          # AlertManager + Email/Webhook/Slack渠道
│
├── api/                          # API服务层
│   ├── __init__.py
│   └── server.py                 # FastAPI RESTful接口
│
└── static/                       # 前端静态文件
    └── index.html                # Bootstrap管理界面
```

## 🚀 快速开始

### 1. 安装依赖

```bash
cd b90
pip install -r predictive/requirements.txt
```

### 2. 运行功能演示

```bash
python predictive/demo.py
```

演示脚本将依次展示：
- ✅ 时序数据收集与处理
- ✅ Prophet模型训练与预测
- ✅ SQL模式分析
- ✅ 智能索引推荐
- ✅ 告警系统功能

### 3. 启动Web服务器

```bash
python predictive/start_server.py
```

服务启动后访问：
- **前端界面**: http://localhost:8000/
- **API文档**: http://localhost:8000/docs
- **健康检查**: http://localhost:8000/api/v1/health

## 🔧 API接口

### 指标数据
- `POST /api/v1/metrics` - 添加单条指标数据
- `POST /api/v1/metrics/batch` - 批量添加指标数据
- `GET /api/v1/metrics/{query_hash}` - 获取查询历史指标
- `GET /api/v1/metrics/queries` - 获取所有查询列表

### 预测模型
- `POST /api/v1/models/train/{query_hash}` - 训练模型
- `GET /api/v1/models` - 列出所有模型
- `GET /api/v1/models/{query_hash}` - 获取模型状态
- `DELETE /api/v1/models/{query_hash}` - 删除模型

### 预测服务
- `POST /api/v1/predict` - 单个查询预测
- `POST /api/v1/predict/batch` - 批量预测所有查询

### SQL分析
- `POST /api/v1/sql/analyze` - 分析SQL语句

### 索引推荐
- `POST /api/v1/index/recommend` - 生成索引推荐

### 告警管理
- `GET /api/v1/alerts` - 获取告警列表
- `POST /api/v1/alerts/config` - 配置告警渠道
- `POST /api/v1/alerts/acknowledge` - 确认告警
- `POST /api/v1/alerts/resolve` - 解决告警

### 仪表盘
- `GET /api/v1/dashboard/stats` - 获取统计数据
- `GET /api/v1/dashboard/top-anomalies` - 获取Top异常查询

## 💡 使用示例

### SQL分析与索引推荐

```python
from predictive.sql_analyzer.parser import SQLPatternAnalyzer
from predictive.index_recommender.recommender import IndexRecommender

sql = """
    SELECT u.id, o.total_amount
    FROM users u
    JOIN orders o ON u.id = o.user_id
    WHERE u.status = 'active'
    ORDER BY o.created_at DESC
"""

analyzer = SQLPatternAnalyzer()
parsed = analyzer.parse(sql)

recommender = IndexRecommender()
recommendations = recommender.recommend_for_query(sql)
report = recommender.generate_optimization_report(recommendations)

print(f"推荐 {report['summary']['total_recommendations']} 条索引")
print(f"平均预期改进: {report['summary']['average_estimated_improvement_pct']}%")
```

### 时序预测

```python
from predictive.timeseries.processor import TimeSeriesProcessor
from predictive.predictor.prophet_model import QueryPerformancePredictor

# 收集指标数据
processor = TimeSeriesProcessor()
metrics = processor.generate_synthetic_data(duration_hours=48)
processor.add_metrics(metrics)

# 训练模型
predictor = QueryPerformancePredictor()
for query_hash in processor.query_metrics.keys():
    data = processor.prepare_prophet_data(query_hash)
    predictor.train(query_hash, data)

# 执行预测
predictions = predictor.predict_all()
anomalies = [p for p in predictions if p['is_anomaly']]
print(f"检测到 {len(anomalies)} 个异常")
```

### 发送告警

```python
from predictive.alerting.alert_manager import AlertManager, EmailChannel

alert_manager = AlertManager()

# 配置邮件渠道
email_channel = EmailChannel(
    smtp_host="smtp.example.com",
    smtp_port=587,
    smtp_username="alerts@example.com",
    smtp_password="password",
    recipients=["admin@example.com"]
)
alert_manager.add_channel("predicted_slowdown", email_channel)

# 创建告警
alert = alert_manager.create_alert(
    alert_type="predicted_slowdown",
    severity="warning",
    title="预测查询性能下降",
    message="检测到潜在性能问题，建议添加索引优化",
    index_recommendations=index_recs
)
```

## 🎯 核心算法

### Prophet时序预测
- **季节性自动检测**: 基于自相关函数分析日/周周期性
- **异常阈值计算**: IQR四分位法，默认阈值为 Q3 + 1.5 × IQR
- **置信度评估**: 基于预测区间宽度计算
- **模型评估**: 使用MAPE、MAE、RMSE指标

### 索引推荐算法
1. **单列索引**: WHERE条件中高选择性列
2. **组合索引**: 多条件AND查询的列组合
3. **覆盖索引**: 查询涉及的所有列
4. **JOIN优化**: 外键列的索引建议
5. **排序优化**: ORDER BY/GROUP BY列

### 异常评分公式
```
异常分数 = (预测值 - 平均值) / 标准差
> 2.0: CRITICAL 严重
> 1.5: WARNING 警告
```

## ⚙️ 配置说明

### 邮件告警配置
```python
{
    "smtp_host": "smtp.gmail.com",
    "smtp_port": 587,
    "smtp_username": "your-email@gmail.com",
    "smtp_password": "your-app-password",
    "recipients": ["admin@example.com"]
}
```

### Webhook配置
```python
{
    "webhook_url": "https://your-api.com/webhook",
    "headers": {"Authorization": "Bearer token"}
}
```

### Slack配置
```python
{
    "webhook_url": "https://hooks.slack.com/services/...",
    "channel": "#alerts"
}
```

## 📊 预测流程

```
1. 数据收集
   ↓
2. 时序数据清洗与聚合 (按query_hash分组)
   ↓
3. Prophet模型训练 (自动检测季节性)
   ↓
4. 未来30分钟性能预测
   ↓
5. 异常检测 (与历史基线比较)
   ↓
6. SQL模式分析 → 索引推荐
   ↓
7. 多渠道告警通知
```

## 🔮 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| **预测引擎** | Prophet 1.1.5 | Meta时序预测库 |
| **API服务** | FastAPI 0.104 | 高性能异步框架 |
| **数据处理** | Pandas 2.1, NumPy | 时序数据处理 |
| **前端UI** | Bootstrap 5.3, Chart.js | 响应式管理界面 |
| **告警** | SMTP, HTTP, Slack | 多渠道通知 |
| **可视化** | Chart.js 4.4 | 交互式图表 |

## 📝 注意事项

1. **数据要求**: Prophet模型训练建议至少10个数据点，推荐24小时以上历史数据
2. **资源使用**: 训练大量查询模型可能占用较多内存，建议分批训练
3. **索引风险**: 创建索引前请评估写操作影响，特别是大表
4. **告警频率**: 建议配置告警去重窗口（默认60分钟）

## 🔄 扩展开发

### 添加新的告警渠道
```python
from predictive.alerting.alert_manager import AlertChannel

class MyChannel(AlertChannel):
    def send(self, alert):
        # 实现发送逻辑
        pass
```

### 自定义预测模型
```python
from predictive.predictor.prophet_model import QueryPerformancePredictor

class CustomPredictor(QueryPerformancePredictor):
    # 重写训练或预测方法
    pass
```

## 📄 许可证

本项目为内部诊断工具，遵循原有项目许可协议。

---

**如有问题，请查看API文档: http://localhost:8000/docs**
