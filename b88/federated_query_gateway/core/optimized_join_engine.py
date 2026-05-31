import pyarrow as pa
import pandas as pd
from typing import Dict, Any, Optional, List, Tuple, Callable
from dataclasses import dataclass
from collections import defaultdict
import hashlib
import math

from .arrow_handler import ArrowHandler
from .statistics import StatisticsCollector, TableStatistics, BroadcastJoinAnalyzer, JoinOrderOptimizer


@dataclass
class JoinExecutionPlan:
    join_type: str
    join_strategy: str
    broadcast_side: Optional[str] = None
    has_skew: bool = False
    skewed_keys: List[Any] = None
    estimated_cost: float = 0.0


class PartialAggregator:
    def __init__(self, arrow_handler: ArrowHandler):
        self.arrow_handler = arrow_handler

    def partial_aggregate(self, table: pa.Table, group_by_columns: List[str],
                           aggregate_columns: Dict[str, str]) -> pa.Table:
        df = self.arrow_handler.to_dataframe(table)
        
        agg_dict = {}
        for col, func in aggregate_columns.items():
            if func == 'COUNT':
                agg_dict[col] = 'count'
            elif func == 'SUM':
                agg_dict[col] = 'sum'
            elif func == 'AVG':
                agg_dict[f"{col}_sum"] = (col, 'sum')
                agg_dict[f"{col}_count"] = (col, 'count')
            elif func == 'MAX':
                agg_dict[col] = 'max'
            elif func == 'MIN':
                agg_dict[col] = 'min'
        
        grouped = df.groupby(group_by_columns).agg(agg_dict)
        grouped = grouped.reset_index()
        
        return self.arrow_handler.to_arrow_table(grouped)

    def combine_partial_results(self, partial_tables: List[pa.Table],
                              group_by_columns: List[str],
                              aggregate_columns: Dict[str, str]) -> pa.Table:
        if not partial_tables:
            return pa.Table.from_pylist([])
        
        combined_df = pd.concat([
            self.arrow_handler.to_dataframe(t) for t in partial_tables])
        
        final_agg = {}
        for col, func in aggregate_columns.items():
            if func == 'COUNT':
                final_agg[col] = 'sum'
            elif func == 'SUM':
                final_agg[col] = 'sum'
            elif func == 'AVG':
                pass
            elif func == 'MAX':
                final_agg[col] = 'max'
            elif func == 'MIN':
                final_agg[col] = 'min'
        
        result = combined_df.groupby(group_by_columns).agg(final_agg).reset_index()
        return self.arrow_handler.to_arrow_table(result)

    def aggregate_with_skew_handling(self, table: pa.Table, group_by_columns: List[str],
                                  aggregate_columns: Dict[str, str],
                                  skewed_keys: List[Any] = None) -> pa.Table:
        if not skewed_keys:
            return self.partial_aggregate(table, group_by_columns, aggregate_columns)
        
        df = self.arrow_handler.to_dataframe(table)
        key_col = group_by_columns[0]
        
        normal_df = df[~df[key_col].isin(skewed_keys)]
        skewed_df = df[df[key_col].isin(skewed_keys)]
        
        normal_result = self.partial_aggregate(
            self.arrow_handler.to_arrow_table(normal_df),
            group_by_columns, aggregate_columns
        )
        
        skewed_result = self._process_skewed_keys(skewed_df, group_by_columns, aggregate_columns)
        
        return self.arrow_handler.to_arrow_table(
            pd.concat([self.arrow_handler.to_dataframe(normal_result), skewed_result])
        )

    def _process_skewed_keys(self, skewed_df: pd.DataFrame, group_by_columns: List[str],
                               aggregate_columns: Dict[str, str]) -> pd.DataFrame:
        chunks = []
        chunk_size = max(10000, len(skewed_df) // 10)
        
        for i in range(0, len(skewed_df), chunk_size):
            chunk = skewed_df.iloc[i:i+chunk_size]
            partial = chunk.groupby(group_by_columns).agg(
                {col: 'sum' for col in aggregate_columns.keys()}
            ).reset_index()
            chunks.append(partial)
        
        if not chunks:
            return pd.DataFrame()
        
        combined = pd.concat(chunks)
        return combined.groupby(group_by_columns).sum().reset_index()


class BroadcastJoinEngine:
    def __init__(self, arrow_handler: ArrowHandler):
        self.arrow_handler = arrow_handler
        self.stats_collector = StatisticsCollector()
        self.broadcast_analyzer = BroadcastJoinAnalyzer(self.stats_collector)
        self.join_order_optimizer = JoinOrderOptimizer(self.stats_collector)
        self.aggregator = PartialAggregator(arrow_handler)
        self.skew_threshold = 10.0
        self.broadcast_threshold_mb = 50

    def execute_optimized_join(self, tables: Dict[str, pa.Table],
                              join_conditions: List[Tuple[str, str, str, str]],
                              select_columns: Optional[List[str]] = None) -> pa.Table:
        table_stats = {}
        for name, table in tables.items():
            table_stats[name] = self.stats_collector.collect_table_statistics(table, name)
        
        if len(tables) > 2:
            join_order = self.join_order_optimizer.optimize_join_order(
                table_stats, join_conditions
            )
        else:
            join_order = [(join_conditions[0][0], join_conditions[0][1])]

        result = None
        processed_tables = set()
        
        for left_name, right_name in join_order:
            if left_name not in tables or right_name not in tables:
                continue
            
            left_table = tables[left_name] if result is None or left_name not in processed_tables else result
            right_table = tables[right_name]
            
            join_condition = self._find_join_condition(left_name, right_name, join_conditions)
            if not join_condition:
                continue
            
            left_col, right_col = join_condition[2], join_condition[3]
            
            plan = self._generate_join_plan(
                table_stats.get(left_name), table_stats.get(right_name),
                left_col, right_col
            )
            
            if plan.join_strategy == 'broadcast':
                joined = self._execute_broadcast_join(
                    left_table, right_table, left_col, right_col,
                    plan.broadcast_side
                )
            else:
                joined = self._execute_skew_aware_join(
                    left_table, right_table, left_col, right_col,
                    table_stats.get(left_name), table_stats.get(right_name),
                    left_col, right_col
                )
            
            result = joined
            processed_tables.add(left_name)
            processed_tables.add(right_name)
        
        if result is None and len(tables) == 1:
            return list(tables.values())[0]
        
        if result is not None and select_columns and '*' not in select_columns:
            result = self._select_columns(result, select_columns)
        
        return result or pa.Table.from_pylist([])

    def _find_join_condition(self, left_name: str, right_name: str,
                           join_conditions: List[Tuple[str, str, str, str]]
                           ) -> Optional[Tuple[str, str, str, str]]:
        for cond in join_conditions:
            if (cond[0] == left_name and cond[1] == right_name) or \
               (cond[1] == left_name and cond[0] == right_name):
                return cond
        return None

    def _generate_join_plan(self, left_stats: Optional[TableStatistics],
                              right_stats: Optional[TableStatistics],
                              left_col: str, right_col: str) -> JoinExecutionPlan:
        if left_stats and right_stats:
            should_broadcast, broadcast_side = self.broadcast_analyzer.should_broadcast_join(
                left_stats, right_stats
            )
            
            if should_broadcast:
                cost_estimate = self.stats_collector.estimate_join_cost(
                    left_stats, right_stats, left_col, right_col
                )
                
                has_skew = cost_estimate['skew_ratio'] > self.skew_threshold
                
                return JoinExecutionPlan(
                    join_type='INNER',
                    join_strategy='broadcast',
                    broadcast_side=broadcast_side,
                    has_skew=has_skew,
                    estimated_cost=cost_estimate['cost_score']
                )
        
        return JoinExecutionPlan(
            join_type='INNER',
            join_strategy='hash',
            estimated_cost=float('inf')
        )

    def _execute_broadcast_join(self, left_table: pa.Table, right_table: pa.Table,
                                  left_key: str, right_key: str,
                                  broadcast_side: str) -> pa.Table:
        if broadcast_side == 'left':
            broadcast_table = left_table
            build_table = right_table
            broadcast_key = left_key
            build_key = right_key
        else:
            broadcast_table = right_table
            build_table = left_table
            broadcast_key = right_key
            build_key = left_key
        
        broadcast_df = self.arrow_handler.to_dataframe(broadcast_table)
        
        hash_table = defaultdict(list)
        for idx, row in broadcast_df.iterrows():
            key = row[broadcast_key]
            hash_table[key].append(row.to_dict())
        
        build_df = self.arrow_handler.to_dataframe(build_table)
        
        result_rows = []
        for _, build_row in build_df.iterrows():
            key = build_row[build_key]
            if key in hash_table:
                for broadcast_row in hash_table[key]:
                    merged = {**broadcast_row, **build_row.to_dict()}
                    result_rows.append(merged)
        
        return self.arrow_handler.to_arrow_table(result_rows)

    def _execute_skew_aware_join(self, left_table: pa.Table, right_table: pa.Table,
                                  left_key: str, right_key: str,
                                  left_stats: TableStatistics, right_stats: TableStatistics,
                                  left_col: str, right_col: str) -> pa.Table:
        has_left_skew, left_skew_ratio, left_skewed_keys = self.stats_collector.detect_skew(
            left_stats, left_col, self.skew_threshold)
        
        has_right_skew, right_skew_ratio, right_skewed_keys = self.stats_collector.detect_skew(
            right_stats, right_col, self.skew_threshold)
        
        has_skew = has_left_skew or has_right_skew
        
        if not has_skew:
            return self._execute_hash_join(left_table, right_table, left_key, right_key)
        
        skewed_keys = set(left_skewed_keys + right_skewed_keys)
        
        return self._execute_skewed_join(left_table, right_table, left_key, right_key, skewed_keys)

    def _execute_hash_join(self, left_table: pa.Table, right_table: pa.Table,
                            left_key: str, right_key: str) -> pa.Table:
        left_df = self.arrow_handler.to_dataframe(left_table)
        right_df = self.arrow_handler.to_dataframe(right_table)
        
        hash_table = defaultdict(list)
        for idx, row in left_df.iterrows():
            key = row[left_key]
            hash_table[key].append(row.to_dict())
        
        result_rows = []
        for _, right_row in right_df.iterrows():
            key = right_row[right_key]
            if key in hash_table:
                for left_row in hash_table[key]:
                    merged = {**left_row, **right_row.to_dict()}
                    result_rows.append(merged)
        
        return self.arrow_handler.to_arrow_table(result_rows)

    def _execute_skewed_join(self, left_table: pa.Table, right_table: pa.Table,
                                left_key: str, right_key: str,
                                skewed_keys: set) -> pa.Table:
        left_df = self.arrow_handler.to_dataframe(left_table)
        right_df = self.arrow_handler.to_dataframe(right_table)
        
        left_normal = left_df[~left_df[left_key].isin(skewed_keys)]
        left_skewed = left_df[left_df[left_key].isin(skewed_keys)]
        
        right_normal = right_df[~right_df[right_key].isin(skewed_keys)]
        right_skewed = right_df[right_df[right_key].isin(skewed_keys)]
        
        normal_result = self._execute_hash_join(
            self.arrow_handler.to_arrow_table(left_normal),
            self.arrow_handler.to_arrow_table(right_normal),
            left_key, right_key
        )
        
        skewed_result = self._process_skewed_portion(
            left_skewed, right_skewed, left_key, right_key, skewed_keys
        )
        
        return self._merge_results(normal_result, skewed_result)

    def _process_skewed_portion(self, left_skewed: pd.DataFrame, right_skewed: pd.DataFrame,
                                  left_key: str, right_key: str,
                                  skewed_keys: set) -> pa.Table:
        result_chunks = []
        
        for key in skewed_keys:
            left_key_df = left_skewed[left_skewed[left_key] == key]
            right_key_df = right_skewed[right_skewed[right_key] == key]
            
            if len(left_key_df) > 10000 or len(right_key_df) > 10000:
                chunk_result = self._process_large_skew_key(
                    left_key_df, right_key_df, left_key, right_key
                )
                result_chunks.append(chunk_result)
            else:
                merged = pd.merge(left_key_df, right_key_df, left_on=left_key, right_on=right_key, how='inner')
                result_chunks.append(merged)
        
        if not result_chunks:
            return pa.Table.from_pylist([])
        
        return self.arrow_handler.to_arrow_table(pd.concat(result_chunks))

    def _process_large_skew_key(self, left_df: pd.DataFrame, right_df: pd.DataFrame,
                                left_key: str, right_key: str) -> pd.DataFrame:
        left_chunks = []
        chunk_size = 10000
        
        for i in range(0, len(left_df), chunk_size):
            left_chunk = left_df.iloc[i:i+chunk_size]
            merged = pd.merge(left_chunk, right_df, left_on=left_key, right_on=right_key, how='inner')
            left_chunks.append(merged)
        
        return pd.concat(left_chunks)

    def _merge_results(self, table1: pa.Table, table2: pa.Table) -> pa.Table:
        if table1.num_rows == 0:
            return table2
        if table2.num_rows == 0:
            return table1
        
        df1 = self.arrow_handler.to_dataframe(table1)
        df2 = self.arrow_handler.to_dataframe(table2)
        
        return self.arrow_handler.to_arrow_table(pd.concat([df1, df2]))

    def _select_columns(self, table: pa.Table, columns: List[str]) -> pa.Table:
        df = self.arrow_handler.to_dataframe(table)
        
        existing_cols = [col for col in columns if col in df.columns]
        
        if not existing_cols:
            return table
        
        return self.arrow_handler.to_arrow_table(df[existing_cols])

    def get_join_statistics(self) -> Dict[str, Any]:
        return {
            'skew_threshold': self.skew_threshold,
            'broadcast_threshold_mb': self.broadcast_threshold_mb,
            'supported_strategies': ['broadcast', 'hash', 'skew_aware']
        }
