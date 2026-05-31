#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
智能索引推荐引擎
基于SQL模式分析、性能趋势和数据库统计信息推荐索引
"""

import logging
from typing import List, Dict, Set, Optional, Tuple
from dataclasses import dataclass
from collections import defaultdict, Counter

from predictive.sql_analyzer.parser import SQLPatternAnalyzer, ParsedQuery

logger = logging.getLogger(__name__)


@dataclass
class IndexRecommendation:
    """索引推荐结果"""
    index_name: str
    table_name: str
    columns: List[str]
    index_type: str  # btree, hash, gin, gist
    estimated_improvement_pct: float
    confidence: float
    reason: str
    create_statement: str
    drop_statement: str
    priority: str  # high, medium, low
    risk_level: str  # low, medium, high


class IndexRecommender:
    """智能索引推荐引擎"""

    def __init__(self):
        self.sql_analyzer = SQLPatternAnalyzer()

        # 索引类型映射
        self.index_type_map = {
            'equality': 'btree',
            'range': 'btree',
            'text_search': 'gin',
            'geospatial': 'gist',
            'json': 'gin'
        }

        # 列选择性阈值
        self.high_selectivity_threshold = 0.1  # 10% 选择性
        self.medium_selectivity_threshold = 0.5

    def recommend_for_query(self, sql: str, query_stats: Optional[Dict] = None) -> List[IndexRecommendation]:
        """为单个查询推荐索引"""
        parsed = self.sql_analyzer.parse(sql)
        candidates = self.sql_analyzer.suggest_index_candidates(parsed)

        recommendations = []
        for table in parsed.tables:
            for candidate in candidates:
                # 只推荐该表相关的索引
                recommendation = self._build_recommendation(
                    table=table,
                    columns=candidate['columns'],
                    candidate_type=candidate['type'],
                    reason=candidate['reason'],
                    priority=candidate['priority'],
                    query_stats=query_stats
                )
                if recommendation:
                    recommendations.append(recommendation)

        # 去重并排序
        recommendations = self._deduplicate_recommendations(recommendations)
        recommendations.sort(key=lambda x: self._priority_score(x.priority), reverse=True)

        return recommendations

    def recommend_for_query_pattern(
        self,
        queries: List[str],
        pattern_stats: Optional[Dict] = None
    ) -> List[IndexRecommendation]:
        """为查询模式（多个相似查询）推荐索引"""
        # 分析所有查询
        parsed_list = [self.sql_analyzer.parse(sql) for sql in queries]

        # 统计列出现频率
        column_stats = self._aggregate_column_stats(parsed_list)

        # 统计表出现频率
        table_stats = Counter()
        for parsed in parsed_list:
            for table in parsed.tables:
                table_stats[table] += 1

        # 生成推荐
        recommendations = []

        for table, table_count in table_stats.most_common():
            # 获取该表的列统计
            table_columns = column_stats.get(table, {})

            # 高频WHERE列组合索引
            where_columns = [
                col for col, stats in table_columns.items()
                if stats['where_count'] > 0
            ]
            where_columns.sort(key=lambda x: table_columns[x]['where_count'], reverse=True)

            if len(where_columns) >= 2:
                # 组合索引推荐
                recommendation = self._build_recommendation(
                    table=table,
                    columns=where_columns[:3],
                    candidate_type='composite_pattern_where',
                    reason=f"Frequently used in WHERE conditions across {table_count} queries",
                    priority='high',
                    query_stats=pattern_stats
                )
                if recommendation:
                    recommendations.append(recommendation)

            # 单列索引
            for col in where_columns[:5]:
                col_stats = table_columns[col]
                usage_count = col_stats['where_count'] + col_stats['join_count']
                if usage_count >= 2:
                    recommendation = self._build_recommendation(
                        table=table,
                        columns=[col],
                        candidate_type='single_pattern_high_usage',
                        reason=f"Used in {usage_count} queries for filtering/joining",
                        priority='high' if usage_count >= 3 else 'medium',
                        query_stats=pattern_stats
                    )
                    if recommendation:
                        recommendations.append(recommendation)

            # ORDER BY + WHERE 组合
            order_columns = [
                col for col, stats in table_columns.items()
                if stats['order_count'] > 0
            ]
            if where_columns and order_columns:
                combined = where_columns[:2] + order_columns[:1]
                recommendation = self._build_recommendation(
                    table=table,
                    columns=combined,
                    candidate_type='composite_pattern_where_order',
                    reason="Combined index for filtering + sorting across query pattern",
                    priority='high',
                    query_stats=pattern_stats
                )
                if recommendation:
                    recommendations.append(recommendation)

        # 去重并排序
        recommendations = self._deduplicate_recommendations(recommendations)
        recommendations.sort(key=lambda x: (
            -self._priority_score(x.priority),
            -x.estimated_improvement_pct
        ))

        return recommendations

    def _aggregate_column_stats(self, parsed_list: List[ParsedQuery]) -> Dict[str, Dict]:
        """聚合列使用统计"""
        column_stats = defaultdict(lambda: {
            'where_count': 0,
            'join_count': 0,
            'order_count': 0,
            'group_count': 0,
            'select_count': 0,
            'total_queries': 0
        })

        for parsed in parsed_list:
            for table in parsed.tables:
                stats = column_stats[table]
                stats['total_queries'] += 1

                for col in parsed.where_columns:
                    stats['where_count'] += 1

                for col in parsed.join_columns:
                    stats['join_count'] += 1

                for col in parsed.order_by_columns:
                    stats['order_count'] += 1

                for col in parsed.group_by_columns:
                    stats['group_count'] += 1

        return column_stats

    def _build_recommendation(
        self,
        table: str,
        columns: List[str],
        candidate_type: str,
        reason: str,
        priority: str,
        query_stats: Optional[Dict] = None
    ) -> Optional[IndexRecommendation]:
        """构建索引推荐"""
        if not table or not columns:
            return None

        # 生成索引名
        index_name = f"idx_{table}_{'_'.join(columns[:3])}"

        # 确定索引类型
        index_type = self._determine_index_type(candidate_type, columns)

        # 估计改进幅度
        estimated_improvement = self._estimate_improvement(
            candidate_type, len(columns), query_stats
        )

        # 计算置信度
        confidence = self._calculate_confidence(
            candidate_type, columns, query_stats
        )

        # 计算风险级别
        risk_level = self._assess_risk(len(columns), query_stats)

        # 生成SQL语句
        create_stmt = self._generate_create_statement(
            table, columns, index_name, index_type
        )
        drop_stmt = f"DROP INDEX IF EXISTS {index_name};"

        return IndexRecommendation(
            index_name=index_name,
            table_name=table,
            columns=columns,
            index_type=index_type,
            estimated_improvement_pct=estimated_improvement,
            confidence=confidence,
            reason=reason,
            create_statement=create_stmt,
            drop_statement=drop_stmt,
            priority=priority,
            risk_level=risk_level
        )

    def _determine_index_type(self, candidate_type: str, columns: List[str]) -> str:
        """确定索引类型"""
        if 'text' in candidate_type or 'json' in candidate_type:
            return 'gin'
        if 'geo' in candidate_type:
            return 'gist'
        return 'btree'

    def _estimate_improvement(
        self,
        candidate_type: str,
        column_count: int,
        query_stats: Optional[Dict] = None
    ) -> float:
        """估计性能改进百分比"""
        base_improvement = {
            'single_where': 60.0,
            'composite_where': 75.0,
            'join_column': 70.0,
            'order_by': 40.0,
            'group_by': 45.0,
            'composite_where_order': 80.0,
            'composite_pattern_where': 85.0,
            'single_pattern_high_usage': 70.0,
            'composite_pattern_where_order': 88.0
        }.get(candidate_type, 50.0)

        # 根据列数调整
        if column_count >= 3:
            base_improvement *= 1.1
        elif column_count == 2:
            base_improvement *= 1.05

        # 如果有查询统计数据
        if query_stats:
            avg_duration = query_stats.get('avg_duration_ms', 0)
            if avg_duration > 1000:  # > 1秒的慢查询
                base_improvement *= 1.2
            elif avg_duration > 500:
                base_improvement *= 1.1

            execution_count = query_stats.get('execution_count', 0)
            if execution_count > 1000:
                base_improvement *= 1.15

        return min(base_improvement, 95.0)

    def _calculate_confidence(
        self,
        candidate_type: str,
        columns: List[str],
        query_stats: Optional[Dict] = None
    ) -> float:
        """计算推荐置信度"""
        base_confidence = {
            'single_where': 0.85,
            'composite_where': 0.75,
            'join_column': 0.90,
            'order_by': 0.65,
            'group_by': 0.65,
            'composite_where_order': 0.80,
            'composite_pattern_where': 0.88,
            'single_pattern_high_usage': 0.85,
            'composite_pattern_where_order': 0.82
        }.get(candidate_type, 0.6)

        # 列越多，置信度稍降
        if len(columns) > 2:
            base_confidence *= 0.95

        # 如果有历史数据
        if query_stats and query_stats.get('sample_size', 0) > 100:
            base_confidence *= 1.1

        return min(base_confidence, 0.98)

    def _assess_risk(self, column_count: int, query_stats: Optional[Dict] = None) -> str:
        """评估索引创建风险"""
        risk_score = 0

        # 列数风险
        if column_count >= 4:
            risk_score += 2
        elif column_count >= 3:
            risk_score += 1

        # 表大小风险（如果有数据）
        if query_stats:
            table_size_mb = query_stats.get('table_size_mb', 0)
            if table_size_mb > 10000:  # > 10GB
                risk_score += 2
            elif table_size_mb > 1000:  # > 1GB
                risk_score += 1

            write_rate = query_stats.get('write_rate_per_hour', 0)
            if write_rate > 10000:
                risk_score += 2
            elif write_rate > 1000:
                risk_score += 1

        if risk_score >= 3:
            return 'high'
        elif risk_score >= 1:
            return 'medium'
        else:
            return 'low'

    def _generate_create_statement(
        self,
        table: str,
        columns: List[str],
        index_name: str,
        index_type: str
    ) -> str:
        """生成CREATE INDEX语句"""
        columns_str = ', '.join(columns)
        if index_type == 'btree':
            return f"CREATE INDEX {index_name} ON {table} ({columns_str});"
        else:
            return f"CREATE INDEX {index_name} ON {table} USING {index_type} ({columns_str});"

    def _deduplicate_recommendations(
        self,
        recommendations: List[IndexRecommendation]
    ) -> List[IndexRecommendation]:
        """去重推荐结果"""
        seen = set()
        unique = []

        for rec in recommendations:
            # 以表名+列排序组合作为唯一键
            key = (rec.table_name, tuple(sorted(rec.columns)))
            if key not in seen:
                seen.add(key)
                unique.append(rec)

        return unique

    def _priority_score(self, priority: str) -> int:
        """优先级分数用于排序"""
        return {'high': 3, 'medium': 2, 'low': 1}.get(priority, 0)

    def generate_optimization_report(
        self,
        recommendations: List[IndexRecommendation],
        query_pattern: str = ""
    ) -> Dict:
        """生成优化报告"""
        # 按优先级分组
        high_priority = [r for r in recommendations if r.priority == 'high']
        medium_priority = [r for r in recommendations if r.priority == 'medium']
        low_priority = [r for r in recommendations if r.priority == 'low']

        # 按风险分组
        high_risk = [r for r in recommendations if r.risk_level == 'high']

        # 计算预期总改进
        avg_improvement = 0.0
        if recommendations:
            avg_improvement = sum(r.estimated_improvement_pct for r in recommendations) / len(recommendations)

        return {
            'query_pattern': query_pattern,
            'summary': {
                'total_recommendations': len(recommendations),
                'high_priority_count': len(high_priority),
                'medium_priority_count': len(medium_priority),
                'low_priority_count': len(low_priority),
                'high_risk_count': len(high_risk),
                'average_estimated_improvement_pct': round(avg_improvement, 2)
            },
            'recommendations': [
                {
                    'index_name': r.index_name,
                    'table_name': r.table_name,
                    'columns': r.columns,
                    'create_statement': r.create_statement,
                    'drop_statement': r.drop_statement,
                    'estimated_improvement_pct': r.estimated_improvement_pct,
                    'confidence': r.confidence,
                    'priority': r.priority,
                    'risk_level': r.risk_level,
                    'reason': r.reason
                }
                for r in recommendations
            ],
            'action_items': self._generate_action_items(recommendations)
        }

    def _generate_action_items(self, recommendations: List[IndexRecommendation]) -> List[Dict]:
        """生成行动项"""
        actions = []

        for rec in sorted(recommendations, key=lambda x: self._priority_score(x.priority), reverse=True)[:5]:
            action = {
                'action': f"Create index {rec.index_name}",
                'priority': rec.priority,
                'sql': rec.create_statement,
                'expected_benefit': f"{rec.estimated_improvement_pct:.1f}% estimated performance improvement",
                'risk': f"{rec.risk_level} risk level",
                'confidence': f"{rec.confidence * 100:.0f}% confidence"
            }
            actions.append(action)

        return actions
