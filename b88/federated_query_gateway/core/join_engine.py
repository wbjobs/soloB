import pyarrow as pa
import pandas as pd
from typing import List, Dict, Any, Optional, Tuple
from .arrow_handler import ArrowHandler
from .query_optimizer import JoinCondition


class JoinEngine:
    def __init__(self, arrow_handler: ArrowHandler):
        self.arrow_handler = arrow_handler
        self.supported_join_types = {'INNER', 'LEFT', 'RIGHT', 'FULL', 'LEFT OUTER', 'RIGHT OUTER', 'FULL OUTER'}

    def execute_join(self, 
                     tables: Dict[str, pa.Table],
                     joins: List[JoinCondition],
                     select_columns: Optional[List[str]] = None
                     ) -> pa.Table:
        if not joins:
            if len(tables) == 1:
                return list(tables.values())[0]
            else:
                return self._cartesian_product(list(tables.values()))
        
        result = None
        processed_tables = set()
        
        join_order = self._optimize_join_order(tables, joins)
        
        for left_name, right_name, condition in join_order:
            if left_name not in tables or right_name not in tables:
                continue
                
            left_table = tables[left_name] if result is None or left_name not in processed_tables else result
            right_table = tables[right_name]
            
            if result is None:
                result = self._join_two_tables(
                    left_table, right_table, condition, left_name, right_name
                )
                processed_tables.add(left_name)
                processed_tables.add(right_name)
            elif right_name not in processed_tables:
                result = self._join_two_tables(
                    result, right_table, condition, None, right_name
                )
                processed_tables.add(right_name)
        
        if result is None:
            return pa.Table.from_pylist([])
        
        if select_columns and '*' not in select_columns:
            result = self._select_columns(result, select_columns)
        
        return result

    def _optimize_join_order(self, 
                             tables: Dict[str, pa.Table],
                             joins: List[JoinCondition]
                             ) -> List[Tuple[str, str, JoinCondition]]:
        table_sizes = {name: table.num_rows for name, table in tables.items()}
        
        join_graph = {}
        for join in joins:
            if join.left_table not in join_graph:
                join_graph[join.left_table] = []
            if join.right_table not in join_graph:
                join_graph[join.right_table] = []
            join_graph[join.left_table].append((join.right_table, join))
            join_graph[join.right_table].append((join.left_table, join))
        
        sorted_tables = sorted(table_sizes.keys(), key=lambda x: table_sizes[x])
        
        ordered_joins = []
        visited = set()
        
        if sorted_tables:
            current = sorted_tables[0]
            visited.add(current)
            
            while len(visited) < len(tables):
                found = False
                for v in visited:
                    for neighbor, condition in join_graph.get(v, []):
                        if neighbor not in visited:
                            ordered_joins.append((v, neighbor, condition))
                            visited.add(neighbor)
                            found = True
                            break
                    if found:
                        break
                if not found:
                    break
        
        for join in joins:
            if not any(j[2] == join for j in ordered_joins):
                ordered_joins.append((join.left_table, join.right_table, join))
        
        return ordered_joins

    def _join_two_tables(self,
                         left_table: pa.Table,
                         right_table: pa.Table,
                         condition: JoinCondition,
                         left_prefix: Optional[str] = None,
                         right_prefix: Optional[str] = None
                         ) -> pa.Table:
        left_df = self.arrow_handler.to_dataframe(left_table)
        right_df = self.arrow_handler.to_dataframe(right_table)
        
        left_df.columns = [f"{left_prefix}.{col}" if left_prefix and '.' not in col else col 
                          for col in left_df.columns]
        right_df.columns = [f"{right_prefix}.{col}" if right_prefix and '.' not in col else col 
                           for col in right_df.columns]
        
        left_col = condition.left_column
        right_col = condition.right_column
        
        if left_prefix and f"{left_prefix}.{left_col}" in left_df.columns:
            left_col = f"{left_prefix}.{left_col}"
        if right_prefix and f"{right_prefix}.{right_col}" in right_df.columns:
            right_col = f"{right_prefix}.{right_col}"
        
        if left_col not in left_df.columns:
            for col in left_df.columns:
                if col.endswith(f".{condition.left_column}") or col == condition.left_column:
                    left_col = col
                    break
        
        if right_col not in right_df.columns:
            for col in right_df.columns:
                if col.endswith(f".{condition.right_column}") or col == condition.right_column:
                    right_col = col
                    break
        
        join_type = self._map_join_type(condition.join_type)
        
        try:
            merged_df = pd.merge(
                left_df, right_df,
                left_on=left_col,
                right_on=right_col,
                how=join_type,
                suffixes=('_left', '_right')
            )
        except KeyError:
            return pa.Table.from_pylist([])
        
        return self.arrow_handler.to_arrow_table(merged_df)

    def _map_join_type(self, join_type: str) -> str:
        join_type_upper = join_type.upper()
        if join_type_upper in {'INNER'}:
            return 'inner'
        elif join_type_upper in {'LEFT', 'LEFT OUTER'}:
            return 'left'
        elif join_type_upper in {'RIGHT', 'RIGHT OUTER'}:
            return 'right'
        elif join_type_upper in {'FULL', 'FULL OUTER', 'OUTER'}:
            return 'outer'
        else:
            return 'inner'

    def _cartesian_product(self, tables: List[pa.Table]) -> pa.Table:
        if not tables:
            return pa.Table.from_pylist([])
        if len(tables) == 1:
            return tables[0]
        
        dfs = [self.arrow_handler.to_dataframe(t) for t in tables]
        
        result = dfs[0]
        for df in dfs[1:]:
            result['_temp_key'] = 1
            df['_temp_key'] = 1
            result = pd.merge(result, df, on='_temp_key')
            result = result.drop('_temp_key', axis=1)
        
        if '_temp_key' in result.columns:
            result = result.drop('_temp_key', axis=1)
        
        return self.arrow_handler.to_arrow_table(result)

    def _select_columns(self, table: pa.Table, columns: List[str]) -> pa.Table:
        df = self.arrow_handler.to_dataframe(table)
        
        selected_cols = []
        for col in columns:
            if col in df.columns:
                selected_cols.append(col)
            else:
                for df_col in df.columns:
                    if df_col.endswith(f".{col}") or df_col.endswith(f"_{col}"):
                        selected_cols.append(df_col)
                        break
        
        if not selected_cols:
            return table
        
        return self.arrow_handler.to_arrow_table(df[selected_cols])

    def hash_join(self,
                  left_table: pa.Table,
                  right_table: pa.Table,
                  left_key: str,
                  right_key: str,
                  join_type: str = 'inner'
                  ) -> pa.Table:
        left_df = self.arrow_handler.to_dataframe(left_table)
        right_df = self.arrow_handler.to_dataframe(right_table)
        
        left_dict = {}
        for idx, row in left_df.iterrows():
            key = row[left_key]
            if key not in left_dict:
                left_dict[key] = []
            left_dict[key].append(row.to_dict())
        
        result_rows = []
        join_type = join_type.lower()
        
        if join_type in {'inner', 'left', 'outer'}:
            left_matched = set()
            
            for _, right_row in right_df.iterrows():
                key = right_row[right_key]
                if key in left_dict:
                    left_matched.add(key)
                    for left_row in left_dict[key]:
                        merged = {**left_row, **right_row.to_dict()}
                        result_rows.append(merged)
                elif join_type in {'right', 'outer'}:
                    result_rows.append(right_row.to_dict())
            
            if join_type in {'left', 'outer'}:
                for key, rows in left_dict.items():
                    if key not in left_matched:
                        result_rows.extend(rows)
        
        return self.arrow_handler.to_arrow_table(result_rows)

    def nested_loop_join(self,
                         left_table: pa.Table,
                         right_table: pa.Table,
                         left_key: str,
                         right_key: str,
                         join_type: str = 'inner'
                         ) -> pa.Table:
        left_df = self.arrow_handler.to_dataframe(left_table)
        right_df = self.arrow_handler.to_dataframe(right_table)
        
        result_rows = []
        join_type = join_type.lower()
        
        left_matched = [False] * len(left_df)
        
        for i, left_row in left_df.iterrows():
            has_match = False
            left_val = left_row[left_key]
            
            for j, right_row in right_df.iterrows():
                right_val = right_row[right_key]
                
                if left_val == right_val:
                    has_match = True
                    merged = {**left_row.to_dict(), **right_row.to_dict()}
                    result_rows.append(merged)
            
            left_matched[i] = has_match
        
        if join_type in {'left', 'outer'}:
            for i, left_row in left_df.iterrows():
                if not left_matched[i]:
                    result_rows.append(left_row.to_dict())
        
        if join_type in {'right', 'outer'}:
            right_matched = [False] * len(right_df)
            for j, right_row in right_df.iterrows():
                right_val = right_row[right_key]
                for i, left_row in left_df.iterrows():
                    if left_row[left_key] == right_val:
                        right_matched[j] = True
                        break
                
                if not right_matched[j]:
                    result_rows.append(right_row.to_dict())
        
        return self.arrow_handler.to_arrow_table(result_rows)

    def merge_join(self,
                   left_table: pa.Table,
                   right_table: pa.Table,
                   left_key: str,
                   right_key: str,
                   join_type: str = 'inner'
                   ) -> pa.Table:
        left_df = self.arrow_handler.to_dataframe(left_table)
        right_df = self.arrow_handler.to_dataframe(right_table)
        
        left_sorted = left_df.sort_values(left_key).reset_index(drop=True)
        right_sorted = right_df.sort_values(right_key).reset_index(drop=True)
        
        return self.arrow_handler.to_arrow_table(
            pd.merge(left_sorted, right_sorted, 
                    left_on=left_key, right_on=right_key, 
                    how=join_type)
        )

    def choose_join_strategy(self,
                             left_size: int,
                             right_size: int,
                             is_left_sorted: bool = False,
                             is_right_sorted: bool = False
                             ) -> str:
        if is_left_sorted and is_right_sorted:
            return 'merge'
        
        smaller_size = min(left_size, right_size)
        if smaller_size < 10000:
            return 'hash'
        
        return 'nested_loop'
