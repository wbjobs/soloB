#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据模型定义
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import List, Dict, Optional, Any
import hashlib
import json


class AlertLevel(Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class AlertType(Enum):
    SLOWDOWN_PREDICTED = "slowdown_predicted"
    ANOMALY_DETECTED = "anomaly_detected"
    INDEX_RECOMMENDATION = "index_recommendation"


@dataclass
class QueryMetrics:
    """查询时序指标"""
    query_hash: str
    sql: str
    timestamp: datetime
    duration_ms: float
    execution_count: int = 1
    rows_examined: int = 0
    rows_sent: int = 0
    io_read_bytes: int = 0
    io_write_bytes: int = 0
    lock_wait_time_ms: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            'query_hash': self.query_hash,
            'sql': self.sql,
            'timestamp': self.timestamp.isoformat(),
            'duration_ms': self.duration_ms,
            'execution_count': self.execution_count,
            'rows_examined': self.rows_examined,
            'rows_sent': self.rows_sent,
            'io_read_bytes': self.io_read_bytes,
            'io_write_bytes': self.io_write_bytes,
            'lock_wait_time_ms': self.lock_wait_time_ms,
        }


@dataclass
class PredictionResult:
    """预测结果"""
    query_hash: str
    sql: str
    prediction_time: datetime
    forecast_window_minutes: int
    predicted_duration_ms: float
    baseline_duration_ms: float
    change_percent: float
    confidence: float
    is_anomaly: bool
    anomaly_score: float
    trend: str  # "increasing", "decreasing", "stable"
    forecast_data: List[Dict] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'query_hash': self.query_hash,
            'sql': self.sql,
            'prediction_time': self.prediction_time.isoformat(),
            'forecast_window_minutes': self.forecast_window_minutes,
            'predicted_duration_ms': self.predicted_duration_ms,
            'baseline_duration_ms': self.baseline_duration_ms,
            'change_percent': self.change_percent,
            'confidence': self.confidence,
            'is_anomaly': self.is_anomaly,
            'anomaly_score': self.anomaly_score,
            'trend': self.trend,
            'forecast_data': self.forecast_data,
        }


@dataclass
class IndexRecommendation:
    """索引推荐"""
    table_name: str
    index_name: str
    columns: List[str]
    estimated_improvement_percent: float
    explanation: str
    create_statement: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            'table_name': self.table_name,
            'index_name': self.index_name,
            'columns': self.columns,
            'estimated_improvement_percent': self.estimated_improvement_percent,
            'explanation': self.explanation,
            'create_statement': self.create_statement,
        }


@dataclass
class Alert:
    """告警信息"""
    alert_id: str
    alert_type: AlertType
    level: AlertLevel
    timestamp: datetime
    title: str
    message: str
    query_hash: Optional[str] = None
    sql_sample: Optional[str] = None
    predictions: Optional[PredictionResult] = None
    recommendations: List[IndexRecommendation] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'alert_id': self.alert_id,
            'alert_type': self.alert_type.value,
            'level': self.level.value,
            'timestamp': self.timestamp.isoformat(),
            'title': self.title,
            'message': self.message,
            'query_hash': self.query_hash,
            'sql_sample': self.sql_sample,
            'predictions': self.predictions.to_dict() if self.predictions else None,
            'recommendations': [r.to_dict() for r in self.recommendations],
        }


@dataclass
class ModelTrainingState:
    """模型训练状态"""
    query_hash: str
    last_trained: Optional[datetime] = None
    training_samples: int = 0
    model_version: str = "1.0"
    mape_score: float = 0.0
    is_active: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return {
            'query_hash': self.query_hash,
            'last_trained': self.last_trained.isoformat() if self.last_trained else None,
            'training_samples': self.training_samples,
            'model_version': self.model_version,
            'mape_score': self.mape_score,
            'is_active': self.is_active,
        }


def generate_query_hash(sql: str) -> str:
    """生成查询哈希（标准化后）"""
    import re
    # 标准化SQL
    sql_normalized = sql.strip().lower()
    # 替换字面量
    sql_normalized = re.sub(r"'[^']*'", "?", sql_normalized)
    sql_normalized = re.sub(r"\b\d+\b", "?", sql_normalized)
    # 标准化空白
    sql_normalized = ' '.join(sql_normalized.split())
    return hashlib.md5(sql_normalized.encode()).hexdigest()
