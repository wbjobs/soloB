#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
时序数据处理器
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple
import logging
from collections import defaultdict

logger = logging.getLogger(__name__)


class TimeSeriesProcessor:
    """时序数据处理类"""

    def __init__(self, resample_interval: str = '1min'):
        self.resample_interval = resample_interval
        self.query_series: Dict[str, pd.DataFrame] = {}

    def add_metrics(self, metrics_list: List[Dict]) -> None:
        """添加新的指标数据"""
        # 按query_hash分组
        grouped = defaultdict(list)
        for m in metrics_list:
            grouped[m['query_hash']].append(m)

        # 处理每个查询的时序数据
        for query_hash, metrics in grouped.items():
            self._process_query_metrics(query_hash, metrics)

    def _process_query_metrics(self, query_hash: str, metrics: List[Dict]) -> None:
        """处理单个查询的指标数据"""
        # 转换为DataFrame
        df = pd.DataFrame(metrics)
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        df = df.set_index('timestamp')

        # 重采样并聚合
        resampled = df.resample(self.resample_interval).agg({
            'duration_ms': ['mean', 'max', 'count', 'std'],
            'rows_examined': ['sum', 'mean'],
            'rows_sent': ['sum', 'mean'],
            'io_read_bytes': ['sum'],
            'io_write_bytes': ['sum'],
            'lock_wait_time_ms': ['sum', 'mean'],
        })

        # 扁平化列名
        resampled.columns = ['_'.join(col).strip() for col in resampled.columns.values]
        resampled = resampled.reset_index()

        # 合并到现有数据
        if query_hash in self.query_series:
            existing = self.query_series[query_hash]
            combined = pd.concat([existing, resampled]).drop_duplicates(subset=['timestamp'])
            combined = combined.sort_values('timestamp').reset_index(drop=True)
            self.query_series[query_hash] = combined
        else:
            self.query_series[query_hash] = resampled

    def get_query_series(self, query_hash: str) -> Optional[pd.DataFrame]:
        """获取指定查询的时序数据"""
        return self.query_series.get(query_hash)

    def get_all_query_hashes(self) -> List[str]:
        """获取所有查询哈希"""
        return list(self.query_series.keys())

    def prepare_prophet_data(self, query_hash: str) -> Optional[pd.DataFrame]:
        """准备Prophet训练数据"""
        df = self.get_query_series(query_hash)
        if df is None or len(df) < 10:  # 至少需要10个数据点
            logger.warning(f"Not enough data for query {query_hash}: {len(df) if df is not None else 0} samples")
            return None

        # Prophet需要ds和y列
        prophet_df = pd.DataFrame({
            'ds': df['timestamp'],
            'y': df['duration_ms_mean'],
            'y_max': df['duration_ms_max'],
            'y_count': df['duration_ms_count'],
        })

        # 处理缺失值
        prophet_df = prophet_df.fillna(method='ffill').fillna(method='bfill')

        return prophet_df

    def get_training_stats(self, query_hash: str) -> Dict:
        """获取训练数据统计"""
        df = self.get_query_series(query_hash)
        if df is None:
            return {}

        return {
            'total_samples': len(df),
            'date_range': {
                'start': df['timestamp'].min().isoformat(),
                'end': df['timestamp'].max().isoformat(),
            },
            'duration_stats': {
                'mean': df['duration_ms_mean'].mean(),
                'median': df['duration_ms_mean'].median(),
                'std': df['duration_ms_mean'].std(),
                'min': df['duration_ms_mean'].min(),
                'max': df['duration_ms_mean'].max(),
            },
            'total_executions': df['duration_ms_count'].sum(),
        }

    def detect_seasonality(self, query_hash: str) -> Dict:
        """检测季节性模式"""
        df = self.get_query_series(query_hash)
        if df is None or len(df) < 48:  # 需要至少2天的1分钟数据
            return {'has_daily_seasonality': False, 'has_weekly_seasonality': False}

        # 简单的自相关分析
        series = df['duration_ms_mean'].values
        series = (series - series.mean()) / (series.std() + 1e-8)

        # 检测日季节性 (1440分钟)
        daily_corr = np.correlate(series, np.roll(series, 1440), mode='valid')[0] if len(series) >= 1440 else 0
        # 检测周季节性
        weekly_corr = np.correlate(series, np.roll(series, 10080), mode='valid')[0] if len(series) >= 10080 else 0

        return {
            'has_daily_seasonality': abs(daily_corr) > 0.3,
            'has_weekly_seasonality': abs(weekly_corr) > 0.2,
            'daily_correlation': float(daily_corr),
            'weekly_correlation': float(weekly_corr),
        }

    def calculate_baseline(self, query_hash: str, window_hours: int = 24) -> Optional[float]:
        """计算基准性能"""
        df = self.get_query_series(query_hash)
        if df is None:
            return None

        cutoff = df['timestamp'].max() - timedelta(hours=window_hours)
        recent = df[df['timestamp'] >= cutoff]
        if len(recent) == 0:
            recent = df.tail(100)

        return float(recent['duration_ms_mean'].mean())

    def generate_synthetic_data(self,
                                  duration_hours: int = 72,
                                  num_queries: int = 5,
                                  seed: int = 42) -> List[Dict]:
        """生成合成测试数据"""
        np.random.seed(seed)
        metrics = []

        base_time = datetime.now() - timedelta(hours=duration_hours)

        for q in range(num_queries):
            query_hash = f"synthetic_query_{q:03d}"
            base_duration = np.random.uniform(50, 500)
            sql_template = f"SELECT * FROM table_{q} WHERE condition = ?"

            # 添加季节性和趋势
            num_points = duration_hours * 60  # 每分钟一个点
            times = [base_time + timedelta(minutes=i) for i in range(num_points)]

            for i, t in enumerate(times):
                # 添加日季节性
                hour_of_day = t.hour
                day_factor = 1.0 + 0.3 * np.sin(2 * np.pi * hour_of_day / 24)

                # 添加周季节性
                day_of_week = t.weekday()
                week_factor = 1.0 + 0.2 * np.sin(2 * np.pi * day_of_week / 7)

                # 添加增长趋势（模拟性能退化）
                trend_factor = 1.0 + 0.0001 * i  # 轻微增长

                # 添加随机噪声
                noise = np.random.lognormal(0, 0.2)

                duration = base_duration * day_factor * week_factor * trend_factor * noise

                metrics.append({
                    'query_hash': query_hash,
                    'sql': sql_template,
                    'timestamp': t.isoformat(),
                    'duration_ms': float(duration),
                    'execution_count': int(np.random.poisson(5)),
                    'rows_examined': int(np.random.poisson(1000) * duration / 100),
                    'rows_sent': int(np.random.poisson(50)),
                    'io_read_bytes': int(np.random.poisson(100000) * duration / 100),
                    'io_write_bytes': int(np.random.poisson(10000) * duration / 500),
                    'lock_wait_time_ms': float(np.random.exponential(10)),
                })

        return metrics
