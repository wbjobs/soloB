#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SQL模式分析器
解析SQL语句，提取表名、列名、WHERE条件等模式
"""

import re
import logging
from typing import List, Dict, Set, Optional, Tuple
from dataclasses import dataclass
from collections import defaultdict

logger = logging.getLogger(__name__)


@dataclass
class ParsedQuery:
    """解析后的查询信息"""
    query_type: str  # SELECT, INSERT, UPDATE, DELETE
    tables: List[str]
    columns: List[str]
    where_columns: List[str]  # WHERE条件中的列
    join_columns: List[str]  # JOIN条件中的列
    order_by_columns: List[str]
    group_by_columns: List[str]
    has_subquery: bool
    has_aggregation: bool
    has_join: bool
    original_sql: str


class SQLPatternAnalyzer:
    """SQL模式分析器"""

    def __init__(self):
        # SQL关键字正则表达式
        self.select_pattern = re.compile(r'\bSELECT\b', re.IGNORECASE)
        self.from_pattern = re.compile(r'\bFROM\b\s+([\w\s,]+?)(?:\b(?:WHERE|JOIN|GROUP|ORDER|HAVING|LIMIT)\b|$)', re.IGNORECASE | re.DOTALL)
        self.where_pattern = re.compile(r'\bWHERE\b\s+(.+?)(?:\b(?:GROUP|ORDER|HAVING|LIMIT|UNION)\b|$)', re.IGNORECASE | re.DOTALL)
        self.join_pattern = re.compile(r'\b(?:INNER|LEFT|RIGHT|FULL|CROSS)?\s*JOIN\b\s+(\w+)\s+(?:ON|USING)\b', re.IGNORECASE)
        self.on_pattern = re.compile(r'\bON\b\s+(.+?)(?:\b(?:WHERE|JOIN|GROUP|ORDER)\b|$)', re.IGNORECASE | re.DOTALL)
        self.order_by_pattern = re.compile(r'\bORDER BY\b\s+(.+?)(?:\b(?:LIMIT|HAVING)\b|$)', re.IGNORECASE | re.DOTALL)
        self.group_by_pattern = re.compile(r'\bGROUP BY\b\s+(.+?)(?:\b(?:HAVING|ORDER|LIMIT)\b|$)', re.IGNORECASE | re.DOTALL)

        # 提取列名的模式
        self.column_ref_pattern = re.compile(r'\b(\w+)\.(\w+)\b|\b(\w+)\b')

        # 聚合函数
        self.agg_functions = {'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'STDDEV', 'VARIANCE'}
        self.agg_pattern = re.compile(r'\b(' + '|'.join(self.agg_functions) + r')\s*\(', re.IGNORECASE)

        # 子查询检测
        self.subquery_pattern = re.compile(r'\(\s*SELECT\b', re.IGNORECASE)

    def parse(self, sql: str) -> ParsedQuery:
        """解析SQL语句"""
        sql_clean = self._clean_sql(sql)

        # 判断查询类型
        query_type = self._detect_query_type(sql_clean)

        # 提取表名
        tables = self._extract_tables(sql_clean)

        # 提取WHERE条件中的列
        where_columns = self._extract_where_columns(sql_clean)

        # 提取JOIN列
        join_columns = self._extract_join_columns(sql_clean)

        # 提取ORDER BY列
        order_by_columns = self._extract_order_by_columns(sql_clean)

        # 提取GROUP BY列
        group_by_columns = self._extract_group_by_columns(sql_clean)

        # 检测聚合
        has_aggregation = bool(self.agg_pattern.search(sql_clean))

        # 检测子查询
        has_subquery = bool(self.subquery_pattern.search(sql_clean))

        # 检测JOIN
        has_join = bool(self.join_pattern.search(sql_clean))

        # 提取所有列引用
        columns = self._extract_all_columns(sql_clean)

        return ParsedQuery(
            query_type=query_type,
            tables=tables,
            columns=columns,
            where_columns=where_columns,
            join_columns=join_columns,
            order_by_columns=order_by_columns,
            group_by_columns=group_by_columns,
            has_subquery=has_subquery,
            has_aggregation=has_aggregation,
            has_join=has_join,
            original_sql=sql
        )

    def _clean_sql(self, sql: str) -> str:
        """清理SQL语句"""
        # 移除注释
        sql = re.sub(r'--.*$', '', sql, flags=re.MULTILINE)
        sql = re.sub(r'/\*.*?\*/', '', sql, flags=re.DOTALL)
        # 规范化空白
        sql = ' '.join(sql.split())
        return sql

    def _detect_query_type(self, sql: str) -> str:
        """检测查询类型"""
        sql_upper = sql.strip().upper()
        if sql_upper.startswith('SELECT'):
            return 'SELECT'
        elif sql_upper.startswith('INSERT'):
            return 'INSERT'
        elif sql_upper.startswith('UPDATE'):
            return 'UPDATE'
        elif sql_upper.startswith('DELETE'):
            return 'DELETE'
        else:
            return 'UNKNOWN'

    def _extract_tables(self, sql: str) -> List[str]:
        """提取表名"""
        tables = set()

        # 从FROM子句提取
        from_match = self.from_pattern.search(sql)
        if from_match:
            from_part = from_match.group(1)
            # 分割表名
            for table_part in re.split(r'\s*,\s*', from_part):
                # 移除别名
                table_name = re.split(r'\s+(?:AS\s+)?', table_part.strip(), 1)[0]
                if table_name and not table_name.upper() in ('JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS'):
                    tables.add(table_name.strip())

        # 从JOIN子句提取
        for join_match in self.join_pattern.finditer(sql):
            table_name = join_match.group(1).strip()
            if table_name:
                tables.add(table_name)

        return sorted(list(tables))

    def _extract_where_columns(self, sql: str) -> List[str]:
        """提取WHERE条件中的列名"""
        columns = set()
        where_match = self.where_pattern.search(sql)
        if where_match:
            where_clause = where_match.group(1)
            columns.update(self._extract_column_refs(where_clause))
        return sorted(list(columns))

    def _extract_join_columns(self, sql: str) -> List[str]:
        """提取JOIN条件中的列名"""
        columns = set()
        for on_match in self.on_pattern.finditer(sql):
            on_clause = on_match.group(1)
            columns.update(self._extract_column_refs(on_clause))
        return sorted(list(columns))

    def _extract_order_by_columns(self, sql: str) -> List[str]:
        """提取ORDER BY列"""
        columns = set()
        order_match = self.order_by_pattern.search(sql)
        if order_match:
            order_clause = order_match.group(1)
            # 移除ASC/DESC
            order_clause = re.sub(r'\b(?:ASC|DESC)\b', '', order_clause, flags=re.IGNORECASE)
            for col in order_clause.split(','):
                col_clean = col.strip().split()[-1]
                if col_clean:
                    columns.add(col_clean)
        return sorted(list(columns))

    def _extract_group_by_columns(self, sql: str) -> List[str]:
        """提取GROUP BY列"""
        columns = set()
        group_match = self.group_by_pattern.search(sql)
        if group_match:
            group_clause = group_match.group(1)
            for col in group_clause.split(','):
                col_clean = col.strip()
                if col_clean and not col_clean.upper() in ('ROLLUP', 'CUBE'):
                    columns.add(col_clean)
        return sorted(list(columns))

    def _extract_column_refs(self, text: str) -> Set[str]:
        """提取文本中的列名引用"""
        columns = set()
        for match in self.column_ref_pattern.finditer(text):
            # 可能是table.column或column
            if match.group(2):  # table.column格式
                columns.add(match.group(2))
            elif match.group(3):  # 纯column名
                col = match.group(3)
                # 过滤掉SQL关键字和字面量
                if not self._is_sql_keyword(col):
                    columns.add(col)
        return columns

    def _extract_all_columns(self, sql: str) -> List[str]:
        """提取SQL中所有的列引用"""
        columns = set()
        # 从SELECT子句提取
        select_match = re.search(r'\bSELECT\b\s+(.+?)\bFROM\b', sql, re.IGNORECASE | re.DOTALL)
        if select_match:
            select_part = select_match.group(1)
            # 简单提取列名
            for col in re.findall(r'\b(\w+)\b', select_part):
                if not self._is_sql_keyword(col):
                    columns.add(col)

        # 从WHERE、JOIN等条件中提取
        columns.update(self._extract_where_columns(sql))
        columns.update(self._extract_join_columns(sql))
        columns.update(self._extract_order_by_columns(sql))
        columns.update(self._extract_group_by_columns(sql))

        return sorted(list(columns))

    def _is_sql_keyword(self, word: str) -> bool:
        """判断是否为SQL关键字"""
        keywords = {
            'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER',
            'ON', 'AND', 'OR', 'NOT', 'IS', 'NULL', 'LIKE', 'IN', 'BETWEEN',
            'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'AS',
            'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'DISTINCT', 'ALL',
            'UNION', 'EXCEPT', 'INTERSECT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
            'ASC', 'DESC', 'TRUE', 'FALSE', 'OVER', 'PARTITION', 'WINDOW',
            'WITH', 'RECURSIVE', 'VALUES', 'RETURNING',
            'INT', 'VARCHAR', 'TEXT', 'DATE', 'TIMESTAMP', 'BOOLEAN', 'INTEGER',
            'AS', 'OF', 'AT', 'TIME', 'ZONE', 'AND', 'OR', 'XOR',
        }
        return word.upper() in keywords

    def suggest_index_candidates(self, parsed: ParsedQuery) -> List[Dict]:
        """建议索引候选"""
        candidates = []

        # 为WHERE条件列建议索引
        if parsed.where_columns:
            # 组合索引建议
            if len(parsed.where_columns) >= 2:
                candidates.append({
                    'columns': parsed.where_columns[:3],  # 最多3列
                    'type': 'composite_where',
                    'reason': f"Columns used in WHERE filter conditions",
                    'priority': 'high' if len(parsed.where_columns) >= 2 else 'medium'
                })

            # 单列索引建议
            for col in parsed.where_columns[:3]:
                candidates.append({
                    'columns': [col],
                    'type': 'single_where',
                    'reason': f"Column '{col}' used in WHERE filter",
                    'priority': 'high'
                })

        # 为JOIN列建议索引
        if parsed.join_columns:
            for col in parsed.join_columns[:3]:
                candidates.append({
                    'columns': [col],
                    'type': 'join_column',
                    'reason': f"Column '{col}' used in JOIN condition",
                    'priority': 'high'
                })

        # 为ORDER BY建议索引
        if parsed.order_by_columns:
            candidates.append({
                'columns': parsed.order_by_columns[:2],
                'type': 'order_by',
                'reason': f"Columns used in ORDER BY sorting",
                'priority': 'medium'
            })

        # 为GROUP BY建议索引
        if parsed.group_by_columns:
            candidates.append({
                'columns': parsed.group_by_columns[:2],
                'type': 'group_by',
                'reason': f"Columns used in GROUP BY aggregation",
                'priority': 'medium'
            })

        # 组合WHERE + ORDER BY索引
        if parsed.where_columns and parsed.order_by_columns:
            combined = parsed.where_columns[:2] + parsed.order_by_columns[:1]
            candidates.append({
                'columns': combined,
                'type': 'composite_where_order',
                'reason': "Combined index for filtering + sorting",
                'priority': 'high'
            })

        return candidates
