#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
预测诊断API服务器
提供RESTful接口用于模型训练、预测、告警管理等功能
"""

import logging
import os
from datetime import datetime, timedelta
from typing import Optional, Dict, List
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from predictive.timeseries.processor import TimeSeriesProcessor
from predictive.predictor.prophet_model import QueryPerformancePredictor
from predictive.sql_analyzer.parser import SQLPatternAnalyzer
from predictive.index_recommender.recommender import IndexRecommender
from predictive.alerting.alert_manager import AlertManager, EmailChannel, WebhookChannel, SlackChannel

logger = logging.getLogger(__name__)


# Pydantic模型
class MetricsData(BaseModel):
    timestamp: str
    query_hash: str
    sql: str
    duration_ms: float
    rows_examined: Optional[int] = None
    rows_sent: Optional[int] = None
    cpu_usage: Optional[float] = None
    memory_usage: Optional[float] = None
    io_wait: Optional[float] = None


class PredictionRequest(BaseModel):
    query_hash: str
    horizon_minutes: int = 30


class SQLAnalysisRequest(BaseModel):
    sql: str


class IndexRecommendationRequest(BaseModel):
    sql: str
    query_stats: Optional[Dict] = None


class AlertConfigRequest(BaseModel):
    alert_type: str
    channel_type: str  # email, webhook, slack
    config: Dict


class AlertAcknowledgeRequest(BaseModel):
    alert_id: str


# API服务器
app = FastAPI(
    title="Predictive Query Diagnostics API",
    description="预测性查询诊断API",
    version="1.0.0"
)

# 挂载静态文件
static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'static')
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir, html=True), name="static")

# CORS配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局组件实例
processor = TimeSeriesProcessor()
predictor = QueryPerformancePredictor()
sql_analyzer = SQLPatternAnalyzer()
index_recommender = IndexRecommender()
alert_manager = AlertManager()


@app.on_event("startup")
async def startup_event():
    """启动时初始化"""
    logger.info("Predictive Diagnostics API started")


@app.get("/", response_class=HTMLResponse)
async def root():
    """根路径 - 重定向到前端页面"""
    index_path = os.path.join(static_dir, 'index.html')
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return """
    <html>
        <head><title>Predictive Query Diagnostics API</title></head>
        <body>
            <h1>Predictive Query Diagnostics API</h1>
            <p>Version: 1.0.0</p>
            <p>Status: Running</p>
            <p><a href="/docs">API Documentation</a></p>
        </body>
    </html>
    """


# 指标数据接口
@app.post("/api/v1/metrics", status_code=201)
async def add_metrics(metrics_data: MetricsData):
    """添加指标数据"""
    try:
        metrics_dict = metrics_data.dict()
        processor.add_metrics([metrics_dict])
        return {"status": "success", "message": "Metrics added successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/metrics/batch", status_code=201)
async def add_metrics_batch(metrics_list: List[MetricsData]):
    """批量添加指标数据"""
    try:
        metrics_dicts = [m.dict() for m in metrics_list]
        processor.add_metrics(metrics_dicts)
        return {
            "status": "success",
            "message": f"Added {len(metrics_dicts)} metrics records"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/metrics/{query_hash}")
async def get_metrics(query_hash: str, hours: int = 24):
    """获取查询指标历史"""
    try:
        data = processor.get_query_metrics(query_hash, hours)
        return {
            "query_hash": query_hash,
            "data_points": len(data),
            "metrics": data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/metrics/queries")
async def get_query_list(limit: int = 100):
    """获取所有查询哈希列表"""
    try:
        queries = processor.get_top_queries(limit)
        return {
            "total": len(queries),
            "queries": queries
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 模型训练和预测接口
@app.post("/api/v1/models/train/{query_hash}")
async def train_model(query_hash: str, background_tasks: BackgroundTasks):
    """训练预测模型"""
    try:
        # 检查是否有足够数据
        prophet_data = processor.prepare_prophet_data(query_hash)
        if prophet_data is None or len(prophet_data) < 10:
            raise HTTPException(
                status_code=400,
                detail="Insufficient data for training. Need at least 10 data points."
            )

        # 获取SQL模式
        sql_pattern = processor.get_sql_pattern(query_hash)

        # 训练模型
        success = predictor.train(query_hash, prophet_data, sql_pattern)

        if success:
            return {
                "status": "success",
                "query_hash": query_hash,
                "data_points": len(prophet_data),
                "message": "Model trained successfully"
            }
        else:
            raise HTTPException(
                status_code=500,
                detail="Model training failed"
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/predict")
async def predict(request: PredictionRequest):
    """执行预测"""
    try:
        result = predictor.predict(
            request.query_hash,
            request.horizon_minutes
        )

        if result is None:
            raise HTTPException(
                status_code=404,
                detail="Model not found for this query hash"
            )

        return {
            "query_hash": request.query_hash,
            "prediction": result
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/predict/batch")
async def predict_batch():
    """批量预测所有模型"""
    try:
        predictions = predictor.predict_all()

        # 检测异常并生成告警
        anomalies = []
        for pred in predictions:
            if pred.get('is_anomaly', False):
                anomalies.append(pred)
                # 获取索引推荐
                query_hash = pred['query_hash']
                sql_pattern = processor.get_sql_pattern(query_hash)
                if sql_pattern:
                    recommendations = index_recommender.recommend_for_query(sql_pattern)
                    report = index_recommender.generate_optimization_report(recommendations)

                    # 生成告警
                    alert_manager.create_alert(
                        alert_type="predicted_slowdown",
                        severity="warning" if pred.get('anomaly_score', 0) < 2.0 else "critical",
                        title=f"Predicted Query Slowdown: {query_hash[:8]}",
                        message=f"Query performance degradation predicted in {request.horizon_minutes if 'request' in locals() else 30} minutes",
                        query_hash=query_hash,
                        sql_pattern=sql_pattern,
                        predicted_timestamp=pred.get('predicted_timestamp'),
                        predicted_duration_ms=pred.get('predicted_duration_ms'),
                        anomaly_score=pred.get('anomaly_score'),
                        confidence=pred.get('confidence'),
                        index_recommendations=report.get('recommendations', [])
                    )

        return {
            "total_predictions": len(predictions),
            "anomalies_detected": len(anomalies),
            "predictions": predictions,
            "anomalies": anomalies
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/models")
async def list_models():
    """列出所有已训练模型"""
    try:
        states = predictor.get_all_training_states()
        return {
            "total_models": len(states),
            "models": states
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/models/{query_hash}")
async def get_model_status(query_hash: str):
    """获取模型训练状态"""
    try:
        state = predictor.get_training_state(query_hash)
        if state is None:
            raise HTTPException(status_code=404, detail="Model not found")
        return state
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/v1/models/{query_hash}")
async def delete_model(query_hash: str):
    """删除模型"""
    try:
        # 需要在predictor中实现删除逻辑
        if hasattr(predictor, 'delete_model'):
            predictor.delete_model(query_hash)
        return {"status": "success", "message": f"Model {query_hash} deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# SQL分析接口
@app.post("/api/v1/sql/analyze")
async def analyze_sql(request: SQLAnalysisRequest):
    """分析SQL语句"""
    try:
        parsed = sql_analyzer.parse(request.sql)
        return {
            "query_type": parsed.query_type,
            "tables": parsed.tables,
            "columns": parsed.columns,
            "where_columns": parsed.where_columns,
            "join_columns": parsed.join_columns,
            "order_by_columns": parsed.order_by_columns,
            "group_by_columns": parsed.group_by_columns,
            "has_subquery": parsed.has_subquery,
            "has_aggregation": parsed.has_aggregation,
            "has_join": parsed.has_join
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 索引推荐接口
@app.post("/api/v1/index/recommend")
async def recommend_index(request: IndexRecommendationRequest):
    """推荐索引"""
    try:
        recommendations = index_recommender.recommend_for_query(
            request.sql,
            request.query_stats
        )
        report = index_recommender.generate_optimization_report(
            recommendations,
            query_pattern=request.sql
        )
        return report
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 告警管理接口
@app.post("/api/v1/alerts/config")
async def configure_alert_channel(config_request: AlertConfigRequest):
    """配置告警渠道"""
    try:
        if config_request.channel_type == "email":
            channel = EmailChannel(
                smtp_host=config_request.config['smtp_host'],
                smtp_port=config_request.config['smtp_port'],
                smtp_username=config_request.config['smtp_username'],
                smtp_password=config_request.config['smtp_password'],
                recipients=config_request.config['recipients'],
                use_tls=config_request.config.get('use_tls', True)
            )
        elif config_request.channel_type == "webhook":
            channel = WebhookChannel(
                webhook_url=config_request.config['webhook_url'],
                headers=config_request.config.get('headers'),
                timeout=config_request.config.get('timeout', 10)
            )
        elif config_request.channel_type == "slack":
            channel = SlackChannel(
                webhook_url=config_request.config['webhook_url'],
                channel=config_request.config.get('channel')
            )
        else:
            raise HTTPException(status_code=400, detail="Unsupported channel type")

        alert_manager.add_channel(config_request.alert_type, channel)
        return {
            "status": "success",
            "message": f"Added {config_request.channel_type} channel for {config_request.alert_type}"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/alerts")
async def get_alerts(
    alert_type: Optional[str] = None,
    severity: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 100
):
    """获取告警列表"""
    try:
        alerts = alert_manager.get_alerts(alert_type, severity, status, limit)
        return {
            "total": len(alerts),
            "alerts": [
                {
                    "alert_id": a.alert_id,
                    "alert_type": a.alert_type,
                    "severity": a.severity,
                    "title": a.title,
                    "message": a.message,
                    "query_hash": a.query_hash,
                    "sql_pattern": a.sql_pattern,
                    "predicted_timestamp": a.predicted_timestamp.isoformat() if a.predicted_timestamp else None,
                    "predicted_duration_ms": a.predicted_duration_ms,
                    "anomaly_score": a.anomaly_score,
                    "confidence": a.confidence,
                    "index_recommendations": a.index_recommendations,
                    "created_at": a.created_at.isoformat(),
                    "status": a.status
                }
                for a in alerts
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/alerts/acknowledge")
async def acknowledge_alert(request: AlertAcknowledgeRequest):
    """确认告警"""
    try:
        success = alert_manager.acknowledge_alert(request.alert_id)
        if success:
            return {"status": "success", "message": f"Alert {request.alert_id} acknowledged"}
        else:
            raise HTTPException(status_code=404, detail="Alert not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/alerts/resolve")
async def resolve_alert(request: AlertAcknowledgeRequest):
    """解决告警"""
    try:
        success = alert_manager.resolve_alert(request.alert_id)
        if success:
            return {"status": "success", "message": f"Alert {request.alert_id} resolved"}
        else:
            raise HTTPException(status_code=404, detail="Alert not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 统计和仪表盘接口
@app.get("/api/v1/dashboard/stats")
async def get_dashboard_stats():
    """获取仪表盘统计数据"""
    try:
        # 获取模型统计
        model_states = predictor.get_all_training_states()
        total_models = len(model_states)
        trained_models = sum(1 for s in model_states if s.get('status') == 'trained')

        # 获取告警统计
        alerts = alert_manager.get_alerts()
        active_alerts = sum(1 for a in alerts if a.status == 'active')
        critical_alerts = sum(1 for a in alerts if a.severity == 'critical' and a.status == 'active')

        # 获取查询统计
        query_count = len(processor.query_metrics)

        return {
            "total_queries": query_count,
            "total_models": total_models,
            "trained_models": trained_models,
            "active_alerts": active_alerts,
            "critical_alerts": critical_alerts,
            "last_updated": datetime.now().isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/dashboard/top-anomalies")
async def get_top_anomalies(limit: int = 10):
    """获取Top异常查询"""
    try:
        # 对所有查询进行预测，找出异常
        predictions = predictor.predict_all()
        anomalies = [p for p in predictions if p.get('is_anomaly', False)]
        anomalies.sort(key=lambda x: x.get('anomaly_score', 0), reverse=True)

        return {
            "total_anomalies": len(anomalies),
            "anomalies": anomalies[:limit]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/health")
async def health_check():
    """健康检查"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat()
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
