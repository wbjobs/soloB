import pyarrow as pa
import pandas as pd
from typing import Dict, Any, Optional, List, Tuple
from dataclasses import dataclass, field
from collections import defaultdict
import math
import hashlib


@dataclass
class ColumnStatistics:
    column_name: str
    data_type: str
    row_count: int = 0
    null_count: int = 0
    distinct_count: int = 0
    min_value: Any = None
    max_value: Any = None
    avg_length: float = 0.0
    max_length: int = 0
    top_values: List[Tuple[Any, int]] = field(default_factory=list)
    value_distribution: Dict[Any, int] = field(default_factory=dict)


@dataclass
class TableStatistics:
    table_name: str
    row_count: int = 0
    size_bytes: int = 0
    column_stats: Dict[str, ColumnStatistics] = field(default_factory=dict)
    estimated_memory_bytes: int = 0
    last_analyzed: float = 0.0


class StatisticsCollector:
    def __init__(self, sample_size: int = 10000):
        self.sample_size = sample_size
        self._table_stats_cache: Dict[str, TableStatistics] = {}

    def collect_table_statistics(self, table: pa.Table, table_name: str) -> TableStatistics:
        stats = TableStatistics(
            table_name=table_name,
            row_count=table.num_rows,
            size_bytes=table.get_total_buffer_size(),
            estimated_memory_bytes=table.get_total_buffer_size() * 2
        )

        for col_idx in range(table.num_columns):
            col_name = table.schema.names[col_idx]
            col = table.column(col_idx)
            col_type = str(table.schema.types[col_idx])
            col_stats = self._collect_column_statistics(col, col_name, col_type)
            stats.column_stats[col_name] = col_stats

        self._table_stats_cache[table_name] = stats
        return stats

    def _collect_column_statistics(self, column: pa.ChunkedArray, 
                                     col_name: str, data_type: str) -> ColumnStatistics:
        stats = ColumnStatistics(column_name=col_name, data_type=data_type)
        
        stats.row_count = len(column)
        stats.null_count = column.null_count
        
        if len(column) > 0:
            self._collect_value_statistics(column, stats)
        
        return stats

    def _collect_value_statistics(self, column: pa.ChunkedArray, stats: ColumnStatistics):
        sample_data = self._get_sample_data(column)
        
        if not sample_data:
            return

        value_counts = defaultdict(int)
        total_length = 0
        max_len = 0

        for value in sample_data:
            if value is not None:
                if hasattr(value, '__len__'):
                    try:
                        length = len(str(value))
                        total_length += length
                        max_len = max(max_len, length)
                    except:
                        pass

            value_counts[value] += 1

        stats.distinct_count = len(value_counts)
        
        if value_counts:
            stats.avg_length = total_length / len(value_counts) if len(value_counts) > 0 else 0
        
        stats.max_length = max_len
        
        sorted_values = sorted(value_counts.items(), key=lambda x: x[1], reverse=True)
        stats.top_values = sorted_values[:10]
        stats.value_distribution = dict(sorted_values[:100])
        
        try:
            numeric_values = [float(v) for v in [value] if isinstance(v, (int, float))]
            if numeric_values:
                stats.min_value = min(numeric_values)
                stats.max_value = max(numeric_values)
        except:
            pass

    def _get_sample_data(self, column: pa.ChunkedArray) -> List[Any]:
        if len(column) <= self.sample_size:
            return [v.as_py() if hasattr(v, 'as_py') else v for v in column.to_pylist()]
        
        step = len(column) // self.sample_size
        samples = []
        for i in range(0, len(column), step):
            chunk_idx = 0
            offset = i
            while chunk_idx < len(column.chunks) and offset >= len(column.chunks[chunk_idx]):
                offset -= len(column.chunks[chunk_idx])
                chunk_idx += 1
            
            if chunk_idx < len(column.chunks):
                samples.append(column.chunks[chunk_idx][offset].as_py())
        
        return samples[:self.sample_size]

    def get_table_stats(self, table_name: str) -> Optional[TableStatistics]:
        return self._table_stats_cache.get(table_name)

    def invalidate_cache(self, table_name: str = None):
        if table_name:
            self._table_stats_cache.pop(table_name, None)
        else:
            self._table_stats_cache.clear()

    def estimate_join_cost(self, left_stats: TableStatistics, right_stats: TableStatistics,
                           left_join_col: str, right_join_col: str) -> Dict[str, Any]:
        left_col_stats = left_stats.column_stats.get(left_join_col)
        right_col_stats = right_stats.column_stats.get(right_join_col)
        
        if not left_col_stats or not right_col_stats:
            return {
                'estimated_rows': left_stats.row_count * right_stats.row_count,
                'estimated_memory_bytes': left_stats.estimated_memory_bytes + right_stats.estimated_memory_bytes,
                'cost_score': float('inf')
            }
        
        left_distinct = left_col_stats.distinct_count
        right_distinct = right_col_stats.distinct_count
        
        max_distinct = max(left_distinct, right_distinct, 1)
        
        if max_distinct == 0:
            max_distinct = 1
        
        estimated_rows = (left_stats.row_count * right_stats.row_count) / max_distinct
        
        avg_row_size_left = left_stats.size_bytes / left_stats.row_count if left_stats.row_count > 0 else 0
        avg_row_size_right = right_stats.size_bytes / right_stats.row_count if right_stats.row_count > 0 else 0
        
        estimated_memory = estimated_rows * (avg_row_size_left + avg_row_size_right)
        
        cost_score = estimated_memory + (estimated_rows * 0.01)
        
        skew_ratio = self._calculate_skew_ratio(left_col_stats, right_col_stats)
        
        return {
            'estimated_rows': int(estimated_rows),
            'estimated_memory_bytes': int(estimated_memory),
            'cost_score': cost_score,
            'skew_ratio': skew_ratio,
            'left_distinct': left_distinct,
            'right_distinct': right_distinct
        }

    def _calculate_skew_ratio(self, left_stats: ColumnStatistics, 
                              right_stats: ColumnStatistics) -> float:
        if not left_stats.top_values or not right_stats.top_values:
            return 1.0
        
        left_top_freq = left_stats.top_values[0][1] if left_stats.top_values else 0
        right_top_freq = right_stats.top_values[0][1] if right_stats.top_values else 0
        
        left_avg = left_stats.row_count / max(left_stats.distinct_count, 1)
        right_avg = right_stats.row_count / max(right_stats.distinct_count, 1)
        
        max_skew = max(left_top_freq / max(left_avg, 1), right_top_freq / max(right_avg, 1))
        
        return max_skew

    def detect_skew(self, table_stats: TableStatistics, column_name: str,
                    skew_threshold: float = 10.0) -> Tuple[bool, float, List[Any]]:
        col_stats = table_stats.column_stats.get(column_name)
        if not col_stats or not col_stats.top_values:
            return False, 1.0, []
        
        avg_freq = table_stats.row_count / max(col_stats.distinct_count, 1)
        max_freq = col_stats.top_values[0][1] if col_stats.top_values else 0
        
        skew_ratio = max_freq / max(avg_freq, 1)
        
        skewed_keys = [
            v[0] for v in col_stats.top_values
            if v[1] / max(avg_freq, 1) > skew_threshold
        ]
        
        return skew_ratio > skew_threshold, skew_ratio, skewed_keys


class BroadcastJoinAnalyzer:
    def __init__(self, stats_collector: StatisticsCollector):
        self.stats_collector = stats_collector
        self.broadcast_threshold_mb = 50
        self.broadcast_threshold_bytes = self.broadcast_threshold_mb * 1024 * 1024

    def should_broadcast_join(self, left_stats: TableStatistics, 
                               right_stats: TableStatistics) -> Tuple[bool, str]:
        left_size = left_stats.size_bytes
        right_size = right_stats.size_bytes
        
        if min(left_size, right_size) <= self.broadcast_threshold_bytes:
            broadcast_side = 'left' if left_size <= right_size else 'right'
            return True, broadcast_side
        
        return False, None

    def estimate_broadcast_cost(self, broadcast_stats: TableStatistics,
                                 build_stats: TableStatistics) -> Dict[str, Any]:
        broadcast_cost = broadcast_stats.size_bytes * 4
        build_cost = build_stats.size_bytes * 2
        
        total_cost = broadcast_cost + build_cost
        
        return {
            'broadcast_cost_bytes': broadcast_cost,
            'build_cost_bytes': build_cost,
            'total_cost_bytes': total_cost,
            'broadcast_table_size_mb': broadcast_stats.size_bytes / 1024 / 1024,
            'build_table_size_mb': build_stats.size_bytes / 1024 / 1024
        }


class JoinOrderOptimizer:
    def __init__(self, stats_collector: StatisticsCollector):
        self.stats_collector = stats_collector

    def optimize_join_order(self, tables: Dict[str, TableStatistics],
                            join_conditions: List[Tuple[str, str, str, str]]) -> List[Tuple[str, str]]:
        if len(tables) <= 2:
            return [(join_conditions[0][0], join_conditions[0][1])]
        
        table_names = list(tables.keys())
        n = len(table_names)
        
        dp = {}
        parent = {}
        
        for i in range(n):
            dp[(1 << i,)] = {
                'cost': 0,
                'tables': {table_names[i]},
                'stats': tables[table_names[i]]
            }
        
        for subset_size in range(2, n + 1):
            for subset_mask in self._generate_subsets(n, subset_size):
                subset_tables = {table_names[i] for i in range(n) if (subset_mask & (1 << i))}
                
                min_cost = float('inf')
                best_left = None
                best_right = None
                
                for left_mask, left_state in dp.items():
                    if len(left_state['tables']) >= subset_size:
                        continue
                    
                    if not left_state['tables'].issubset(subset_tables):
                        continue
                    
                    right_tables = subset_tables - left_state['tables']
                    if not right_tables:
                        continue
                    
                    right_mask = self._tables_to_mask(right_tables, table_names)
                    if right_mask not in dp:
                        continue
                    
                    right_state = dp[right_mask]
                    
                    join_possible = self._can_join(left_state['tables'], 
                                                    right_state['tables'], 
                                                    join_conditions)
                    if not join_possible:
                        continue
                    
                    cost = self._calculate_join_cost(left_state['stats'], right_state['stats'])
                    total_cost = left_state['cost'] + right_state['cost'] + cost
                    
                    if total_cost < min_cost:
                        min_cost = total_cost
                        best_left = left_mask
                        best_right = right_mask
                
                if best_left is not None and best_right is not None:
                    dp[subset_mask] = {
                        'cost': min_cost,
                        'tables': subset_tables,
                        'stats': self._merge_stats(dp[best_left]['stats'], dp[best_right]['stats']),
                        'left': best_left,
                        'right': best_right
                    }
                    parent[subset_mask] = (best_left, best_right)
        
        full_mask = (1 << n) - 1
        join_order = []
        self._reconstruct_join_order(full_mask, parent, table_names, join_order)
        
        return join_order

    def _generate_subsets(self, n: int, k: int) -> List[int]:
        subsets = []
        
        def backtrack(start: int, count: int, mask: int):
            if count == k:
                subsets.append(mask)
                return
            for i in range(start, n):
                backtrack(i + 1, count + 1, mask | (1 << i))
        
        backtrack(0, 0, 0)
        return subsets

    def _tables_to_mask(self, tables: set, table_names: List[str]) -> int:
        mask = 0
        for table in tables:
            idx = table_names.index(table)
            mask |= (1 << idx)
        return mask

    def _can_join(self, left_tables: set, right_tables: set,
                   join_conditions: List[Tuple[str, str, str, str]]) -> bool:
        for left_table in left_tables:
            for right_table in right_tables:
                for cond in join_conditions:
                    if (cond[0] == left_table and cond[1] == right_table) or \
                       (cond[1] == left_table and cond[0] == right_table):
                        return True
        return False

    def _calculate_join_cost(self, left_stats: TableStatistics, 
                            right_stats: TableStatistics) -> float:
        cost_estimate = self.stats_collector.estimate_join_cost(
            left_stats, right_stats, '', '')
        return cost_estimate['cost_score']

    def _merge_stats(self, left_stats: TableStatistics, 
                      right_stats: TableStatistics) -> TableStatistics:
        merged = TableStatistics(
            table_name=f"{left_stats.table_name}_x_{right_stats.table_name}",
            row_count=left_stats.row_count * right_stats.row_count // max(
                max(left_stats.row_count, right_stats.row_count), 1),
            size_bytes=left_stats.size_bytes + right_stats.size_bytes,
            estimated_memory_bytes=left_stats.estimated_memory_bytes + right_stats.estimated_memory_bytes
        )
        return merged

    def _reconstruct_join_order(self, mask: int, parent: dict, 
                                table_names: List[str], order: list):
        if mask not in parent:
            return
        
        left_mask, right_mask = parent[mask]
        
        left_tables = [table_names[i] for i in range(len(table_names)) if (left_mask & (1 << i))]
        right_tables = [table_names[i] for i in range(len(table_names)) if (right_mask & (1 << i))]
        
        if len(left_tables) == 1 and len(right_tables) == 1:
            order.append((left_tables[0], right_tables[0]))
        else:
            self._reconstruct_join_order(left_mask, parent, table_names, order)
            self._reconstruct_join_order(right_mask, parent, table_names, order)
