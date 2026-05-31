#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prophet时序预测模型
基于Facebook Prophet实现SQL性能趋势预测
"""

import logging
import pickle
import warnings
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple, List
from pathlib import Path

import pandas as pd
import numpy as np

# 抑制Prophet的日志输出
logging.getLogger('prophet').setLevel(logging.WARNING)
warnings.filterwarnings('ignore')

from prophet import Prophet
from prophet.diagnostics import cross_validation, performance_metrics

logger = logging.getLogger(__name__)


class QueryPerformancePredictor:
    """SQL性能预测器"""

    def __init__(self,
                 forecast_horizon_minutes: int = 30,
                 seasonality_mode: str = 'additive',
                 changepoint_prior_scale: float = 0.05,
                 seasonality_prior_scale: float = 10.0):
        self.forecast_horizon_minutes = forecast_horizon_minutes
        self.seasonality_mode = seasonality_mode
        self.changepoint_prior_scale = changepoint_prior_scale
        self.seasonality_prior_scale = seasonality_prior_scale

        self.models: Dict[str, Prophet] = {}
        self.training_states: Dict[str, Dict] = {}
        self.thresholds: Dict[str, float] = {}

    def train(self,
              query_hash: str,
              data: pd.DataFrame,
              sql: str = "",
              auto_detect_seasonality: bool = True) -> bool:
        """训练Prophet模型"""
        if len(data) < 10:
            logger.warning(f"Not enough data to train model for {query_hash}: {len(data)} samples")
            return False

        try:
            # 检测季节性
            seasonality = {'daily': False, 'weekly': False}
            if auto_detect_seasonality and len(data) >= 48:
                seasonality = self._detect_seasonality(data)

            # 创建模型
            model = Prophet(
                seasonality_mode=self.seasonality_mode,
                changepoint_prior_scale=self.changepoint_prior_scale,
                seasonality_prior_scale=self.seasonality_prior_scale,
                daily_seasonality=seasonality['daily'],
                weekly_seasonality=seasonality['weekly'],
                yearly_seasonality=False,
                interval_width=0.95,
            )

            # 添加自定义季节性（如果数据足够）
            if len(data) >= 1440:  # 至少1天的1分钟数据
                model.add_seasonality(
                    name='hourly',
                    period=1 / 24,  # 1小时
                    fourier_order=5
                )

            # 训练模型
            model.fit(data)

            # 计算异常阈值（基于历史数据的统计）
            self.thresholds[query_hash] = self._calculate_threshold(data)

            # 保存模型和状态
            self.models[query_hash] = model
            self.training_states[query_hash] = {
                'query_hash': query_hash,
                'sql': sql,
                'last_trained': datetime.now(),
                'training_samples': len(data),
                'data_start': data['ds'].min().isoformat(),
                'data_end': data['ds'].max().isoformat(),
                'seasonality': seasonality,
                'baseline_duration': float(data['y'].mean()),
            }

            logger.info(f"Model trained successfully for {query_hash} with {len(data)} samples")
            return True

        except Exception as e:
            logger.error(f"Failed to train model for {query_hash}: {e}")
            return False

    def predict(self,
                 query_hash: str,
                 horizon_minutes: Optional[int] = None) -> Optional[Dict]:
        """执行预测"""
        if query_hash not in self.models:
            logger.warning(f"No model found for {query_hash}")
            return None

        try:
            model = self.models[query_hash]
            horizon = horizon_minutes or self.forecast_horizon_minutes

            # 创建未来时间点
            future = model.make_future_dataframe(
                periods=horizon,
                freq='min',
                include_history=False
            )

            # 执行预测
            forecast = model.predict(future)

            # 提取30分钟后的预测
            target_time = forecast.iloc[-1]

            # 计算变化百分比
            baseline = self.training_states[query_hash]['baseline_duration']
            predicted = target_time['yhat']
            change_percent = ((predicted - baseline) / baseline) * 100

            # 计算置信度（基于预测区间宽度）
            confidence = max(0.0, 1.0 - (target_time['yhat_upper'] - target_time['yhat_lower']) / (2 * baseline))

            # 检测异常
            threshold = self.thresholds.get(query_hash, baseline * 2.0)
            is_anomaly = predicted > threshold
            anomaly_score = min(1.0, max(0.0, (predicted - threshold) / baseline))

            # 判断趋势
            trend = "stable"
            if change_percent > 20:
                trend = "increasing"
            elif change_percent < -20:
                trend = "decreasing"

            # 准备预测数据用于可视化
            forecast_data = []
            for _, row in forecast.iterrows():
                forecast_data.append({
                    'timestamp': row['ds'].isoformat(),
                    'predicted': float(row['yhat']),
                    'lower_bound': float(row['yhat_lower']),
                    'upper_bound': float(row['yhat_upper']),
                })

            return {
                'query_hash': query_hash,
                'sql': self.training_states[query_hash].get('sql', ''),
                'prediction_time': datetime.now(),
                'forecast_window_minutes': horizon,
                'predicted_duration_ms': float(predicted),
                'baseline_duration_ms': float(baseline),
                'change_percent': float(change_percent),
                'confidence': float(confidence),
                'is_anomaly': bool(is_anomaly),
                'anomaly_score': float(anomaly_score),
                'trend': trend,
                'threshold': float(threshold),
                'forecast_data': forecast_data,
            }

        except Exception as e:
            logger.error(f"Prediction failed for {query_hash}: {e}")
            return None

    def predict_all(self,
                     horizon_minutes: Optional[int] = None,
                     min_confidence: float = 0.5) -> List[Dict]:
        """预测所有已训练的查询"""
        predictions = []
        for query_hash in self.models:
            result = self.predict(query_hash, horizon_minutes)
            if result and result['confidence'] >= min_confidence:
                predictions.append(result)
        return predictions

    def get_anomalous_queries(self,
                               horizon_minutes: Optional[int] = None,
                               min_anomaly_score: float = 0.3) -> List[Dict]:
        """获取预测为异常的查询"""
        predictions = self.predict_all(horizon_minutes)
        anomalous = [p for p in predictions
                      if p['is_anomaly'] and p['anomaly_score'] >= min_anomaly_score]
        return sorted(anomalous, key=lambda x: x['anomaly_score'], reverse=True)

    def _detect_seasonality(self, data: pd.DataFrame) -> Dict[str, bool]:
        """检测数据中的季节性模式"""
        result = {'daily': False, 'weekly': False}

        if len(data) < 1440:  # 至少需要1天的1分钟数据
            return result

        series = data['y'].values
        series = (series - series.mean()) / (series.std() + 1e-8)

        # 日季节性检测（每1440分钟）
        if len(series) >= 1440:
            daily_corr = np.corrcoef(series[:-1440], series[1440:])[0, 1]
            if abs(daily_corr) > 0.3:
                result['daily'] = True
                logger.debug(f"Detected daily seasonality with correlation: {daily_corr:.3f}")

        # 周季节性检测
        if len(series) >= 10080:  # 7天
            weekly_corr = np.corrcoef(series[:-10080], series[10080:])[0, 1]
            if abs(weekly_corr) > 0.2:
                result['weekly'] = True
                logger.debug(f"Detected weekly seasonality with correlation: {weekly_corr:.3f}")

        return result

    def _calculate_threshold(self, data: pd.DataFrame) -> float:
        """计算异常检测阈值使用IQR方法"""
        values = data['y'].values
        q75, q25 = np.percentile(values, [75, 25])
        iqr = q75 - q25
        # 使用1.5 * IQR作为阈值，或者2倍均值，取较大的
        threshold = max(q75 + 1.5 * iqr, values.mean() * 2.0)
        return float(threshold)

    def evaluate_model(self, query_hash: str) -> Optional[Dict]:
        """评估模型性能"""
        if query_hash not in self.models:
            return None

        try:
            model = self.models[query_hash]
            initial = min(1440, int(len(model.history) * 0.6))  # 初始训练窗口

            df_cv = cross_validation(
                model,
                initial=f"{initial} minutes",
                period=f"{initial // 2} minutes",
                horizon=f"{self.forecast_horizon_minutes} minutes",
                parallel="processes"
            )

            df_p = performance_metrics(df_cv)

            return {
                'mape': float(df_p['mape'].mean()),
                'mae': float(df_p['mae'].mean()),
                'mse': float(df_p['mse'].mean()),
                'rmse': float(df_p['rmse'].mean()),
                'coverage': float(df_p['coverage'].mean()),
            }
        except Exception as e:
            logger.error(f"Model evaluation failed for {query_hash}: {e}")
            return None

    def save_models(self, path: str) -> None:
        """保存所有模型到文件"""
        save_data = {
            'models': self.models,
            'training_states': self.training_states,
            'thresholds': self.thresholds,
            'config': {
                'forecast_horizon_minutes': self.forecast_horizon_minutes,
                'seasonality_mode': self.seasonality_mode,
                'changepoint_prior_scale': self.changepoint_prior_scale,
                'seasonality_prior_scale': self.seasonality_prior_scale,
            }
        }

        output_path = Path(path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        with open(output_path, 'wb') as f:
            pickle.dump(save_data, f)

        logger.info(f"Models saved to {path}")

    def load_models(self, path: str) -> bool:
        """从文件加载模型"""
        try:
            with open(path, 'rb') as f:
                save_data = pickle.load(f)

            self.models = save_data['models']
            self.training_states = save_data['training_states']
            self.thresholds = save_data['thresholds']

            config = save_data.get('config', {})
            self.forecast_horizon_minutes = config.get('forecast_horizon_minutes', 30)
            self.seasonality_mode = config.get('seasonality_mode', 'additive')

            logger.info(f"Loaded {len(self.models)} models from {path}")
            return True
        except Exception as e:
            logger.error(f"Failed to load models: {e}")
            return False

    def get_training_status(self, query_hash: str) -> Optional[Dict]:
        """获取训练状态"""
        state = self.training_states.get(query_hash)
        if not state:
            return None

        return {
            **state,
            'model_exists': query_hash in self.models,
            'threshold': self.thresholds.get(query_hash),
        }

    def get_all_training_status(self) -> List[Dict]:
        """获取所有模型的训练状态"""
        return [
            self.get_training_status(qh)
            for qh in self.training_states
            if self.get_training_status(qh)
        ]
