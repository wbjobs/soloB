import pyarrow as pa
import pandas as pd
import hashlib
import json
import time
import threading
import asyncio
import os
from typing import Dict, Any, Optional, List, Tuple, Callable, Set
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from collections import defaultdict
from enum import Enum

from .arrow_handler import ArrowHandler
from .statistics import StatisticsCollector


class RefreshStrategy(Enum):
    FULL = "full"
    INCREMENTAL = "incremental"
    ON_DEMAND = "on_demand"
    SCHEDULED = "scheduled"


class ViewStatus(Enum):
    CREATED = "created"
    REFRESHING = "refreshing"
    ACTIVE = "active"
    STALE = "stale"
    EXPIRED = "expired"
    ERROR = "error"


@dataclass
class MaterializedViewDefinition:
    view_name: str
    source_sql: str
    source_tables: List[str]
    columns: List[str]
    partition_by: Optional[str] = None
    refresh_strategy: RefreshStrategy = RefreshStrategy.SCHEDULED
    refresh_interval_seconds: int = 3600
    incremental_column: Optional[str] = None
    watermark_column: Optional[str] = None
    retention_hours: int = 168
    created_at: float = field(default_factory=time.time)
    last_refreshed_at: float = 0.0
    last_incremental_watermark: Any = None
    version: int = 1
    description: str = ""


@dataclass
class MaterializedViewStats:
    view_name: str
    row_count: int = 0
    size_bytes: int = 0
    query_count: int = 0
    hit_count: int = 0
    last_accessed_at: float = 0.0
    refresh_count: int = 0
    avg_refresh_time_seconds: float = 0.0


class ViewMetadataManager:
    def __init__(self, metadata_path: Optional[str] = None):
        self.metadata_path = metadata_path
        self.views: Dict[str, MaterializedViewDefinition] = {}
        self.view_stats: Dict[str, MaterializedViewStats] = {}
        self.view_status: Dict[str, ViewStatus] = {}
        self.lock = threading.RLock()

    def create_view(self, definition: MaterializedViewDefinition) -> bool:
        with self.lock:
            if definition.view_name in self.views:
                raise ValueError(f"View '{definition.view_name}' already exists")
            
            self.views[definition.view_name] = definition
            self.view_stats[definition.view_name] = MaterializedViewStats(
                view_name=definition.view_name
            )
            self.view_status[definition.view_name] = ViewStatus.CREATED
            
            self._persist_metadata()
            return True

    def drop_view(self, view_name: str) -> bool:
        with self.lock:
            if view_name not in self.views:
                return False
            
            del self.views[view_name]
            del self.view_stats[view_name]
            del self.view_status[view_name]
            
            self._persist_metadata()
            return True

    def get_view(self, view_name: str) -> Optional[MaterializedViewDefinition]:
        with self.lock:
            return self.views.get(view_name)

    def list_views(self) -> List[str]:
        with self.lock:
            return list(self.views.keys())

    def update_view_status(self, view_name: str, status: ViewStatus) -> None:
        with self.lock:
            if view_name in self.view_status:
                self.view_status[view_name] = status

    def get_view_status(self, view_name: str) -> Optional[ViewStatus]:
        with self.lock:
            return self.view_status.get(view_name)

    def record_refresh(self, view_name: str, refresh_time_seconds: float) -> None:
        with self.lock:
            if view_name in self.views:
                self.views[view_name].last_refreshed_at = time.time()
                self.views[view_name].version += 1
            
            if view_name in self.view_stats:
                stats = self.view_stats[view_name]
                stats.refresh_count += 1
                stats.avg_refresh_time_seconds = (
                    (stats.avg_refresh_time_seconds * (stats.refresh_count - 1) + refresh_time_seconds) 
                    / stats.refresh_count
                )

    def record_query_hit(self, view_name: str) -> None:
        with self.lock:
            if view_name in self.view_stats:
                stats = self.view_stats[view_name]
                stats.query_count += 1
                stats.hit_count += 1
                stats.last_accessed_at = time.time()

    def update_view_stats(self, view_name: str, row_count: int, size_bytes: int) -> None:
        with self.lock:
            if view_name in self.view_stats:
                self.view_stats[view_name].row_count = row_count
                self.view_stats[view_name].size_bytes = size_bytes

    def update_watermark(self, view_name: str, watermark_value: Any) -> None:
        with self.lock:
            if view_name in self.views:
                self.views[view_name].last_incremental_watermark = watermark_value

    def get_views_needing_refresh(self) -> List[MaterializedViewDefinition]:
        now = time.time()
        views_to_refresh = []
        
        with self.lock:
            for view in self.views.values():
                if view.refresh_strategy in [RefreshStrategy.SCHEDULED, RefreshStrategy.INCREMENTAL]:
                    time_since_last_refresh = now - view.last_refreshed_at
                    if time_since_last_refresh >= view.refresh_interval_seconds:
                        views_to_refresh.append(view)
        
        return views_to_refresh

    def _persist_metadata(self) -> None:
        if not self.metadata_path:
            return
        
        metadata = {
            "views": {k: asdict(v) for k, v in self.views.items()},
            "stats": {k: asdict(v) for k, v in self.view_stats.items()},
            "status": {k: v.value for k, v in self.view_status.items()}
        }
        
        try:
            with open(self.metadata_path, 'w') as f:
                json.dump(metadata, f, indent=2)
        except Exception:
            pass

    def load_metadata(self) -> None:
        if not self.metadata_path or not os.path.exists(self.metadata_path):
            return
        
        try:
            with open(self.metadata_path, 'r') as f:
                metadata = json.load(f)
            
            for view_name, view_dict in metadata.get("views", {}).items():
                view_dict['refresh_strategy'] = RefreshStrategy(view_dict['refresh_strategy'])
                self.views[view_name] = MaterializedViewDefinition(**view_dict)
            
            for view_name, stats_dict in metadata.get("stats", {}).items():
                self.view_stats[view_name] = MaterializedViewStats(**stats_dict)
            
            for view_name, status_value in metadata.get("status", {}).items():
                self.view_status[view_name] = ViewStatus(status_value)
        except Exception:
            pass


class QueryRewriteOptimizer:
    def __init__(self, metadata_manager: ViewMetadataManager):
        self.metadata_manager = metadata_manager
        self.arrow_handler = ArrowHandler()

    def can_rewrite_query(self, query_sql: str, tables_in_query: List[str]) -> Tuple[bool, Optional[str]]:
        for view_name, view_def in self.metadata_manager.views.items():
            status = self.metadata_manager.get_view_status(view_name)
            
            if status not in [ViewStatus.ACTIVE, ViewStatus.STALE]:
                continue
            
            if self._is_query_rewritable(query_sql, tables_in_query, view_def):
                return True, view_name
        
        return False, None

    def _is_query_rewritable(self, query_sql: str, tables_in_query: List[str],
                             view_def: MaterializedViewDefinition) -> bool:
        view_tables = set(view_def.source_tables)
        query_tables = set(tables_in_query)
        
        if not query_tables.issubset(view_tables) and not view_tables.issubset(query_tables):
            return False
        
        if len(query_tables & view_tables) == 0:
            return False
        
        return True

    def rewrite_query(self, original_sql: str, view_name: str) -> str:
        view_def = self.metadata_manager.get_view(view_name)
        if not view_def:
            return original_sql
        
        rewritten_sql = original_sql
        
        for source_table in view_def.source_tables:
            if source_table in rewritten_sql:
                rewritten_sql = rewritten_sql.replace(
                    f"FROM {source_table}", 
                    f"FROM {view_name}"
                ).replace(
                    f"JOIN {source_table}", 
                    f"JOIN {view_name}"
                )
        
        return rewritten_sql

    def find_best_matching_view(self, query_sql: str, tables_in_query: List[str],
                                select_columns: List[str], 
                                group_by_columns: Optional[List[str]] = None) -> Optional[str]:
        best_match = None
        best_score = -1
        
        for view_name, view_def in self.metadata_manager.views.items():
            status = self.metadata_manager.get_view_status(view_name)
            
            if status not in [ViewStatus.ACTIVE, ViewStatus.STALE]:
                continue
            
            score = self._calculate_match_score(
                tables_in_query, select_columns, group_by_columns or [], view_def
            )
            
            if score > best_score:
                best_score = score
                best_match = view_name
        
        return best_match if best_score > 0 else None

    def _calculate_match_score(self, tables_in_query: List[str], 
                               select_columns: List[str],
                               group_by_columns: List[str],
                               view_def: MaterializedViewDefinition) -> int:
        score = 0
        
        query_tables = set(tables_in_query)
        view_tables = set(view_def.source_tables)
        table_overlap = len(query_tables & view_tables)
        
        if table_overlap == len(query_tables):
            score += 100
        elif table_overlap > 0:
            score += table_overlap * 20
        
        query_cols = set(select_columns)
        view_cols = set(view_def.columns)
        col_overlap = len(query_cols & view_cols)
        
        if col_overlap == len(query_cols):
            score += 80
        elif col_overlap > 0:
            score += col_overlap * 10
        
        if view_def.partition_by:
            score += 10
        
        if view_def.refresh_strategy == RefreshStrategy.INCREMENTAL:
            score += 5
        
        return score


class MaterializedViewRefresher:
    def __init__(self, metadata_manager: ViewMetadataManager, 
                 query_executor: Callable[[str], pa.Table],
                 arrow_handler: ArrowHandler):
        self.metadata_manager = metadata_manager
        self.query_executor = query_executor
        self.arrow_handler = arrow_handler
        self.view_data: Dict[str, pa.Table] = {}
        self.lock = threading.RLock()

    def refresh_full(self, view_name: str) -> Tuple[bool, int]:
        view_def = self.metadata_manager.get_view(view_name)
        if not view_def:
            return False, 0
        
        self.metadata_manager.update_view_status(view_name, ViewStatus.REFRESHING)
        
        start_time = time.time()
        
        try:
            result_table = self.query_executor(view_def.source_sql)
            
            with self.lock:
                self.view_data[view_name] = result_table
            
            row_count = result_table.num_rows
            size_bytes = result_table.get_total_buffer_size()
            
            refresh_time = time.time() - start_time
            
            self.metadata_manager.record_refresh(view_name, refresh_time)
            self.metadata_manager.update_view_stats(view_name, row_count, size_bytes)
            self.metadata_manager.update_view_status(view_name, ViewStatus.ACTIVE)
            
            return True, row_count
            
        except Exception as e:
            self.metadata_manager.update_view_status(view_name, ViewStatus.ERROR)
            raise e

    def refresh_incremental(self, view_name: str) -> Tuple[bool, int]:
        view_def = self.metadata_manager.get_view(view_name)
        if not view_def:
            return False, 0
        
        if not view_def.incremental_column:
            return self.refresh_full(view_name)
        
        self.metadata_manager.update_view_status(view_name, ViewStatus.REFRESHING)
        
        start_time = time.time()
        
        try:
            current_watermark = view_def.last_incremental_watermark
            
            if current_watermark is None:
                return self.refresh_full(view_name)
            
            incremental_sql = self._build_incremental_sql(view_def, current_watermark)
            
            incremental_data = self.query_executor(incremental_sql)
            
            if incremental_data.num_rows > 0:
                with self.lock:
                    if view_name in self.view_data:
                        combined_data = self._merge_incremental_data(
                            self.view_data[view_name], 
                            incremental_data,
                            view_def.incremental_column
                        )
                        self.view_data[view_name] = combined_data
                    else:
                        self.view_data[view_name] = incremental_data
                
                new_watermark = self._get_max_value(incremental_data, view_def.incremental_column)
                self.metadata_manager.update_watermark(view_name, new_watermark)
            
            row_count = self.view_data[view_name].num_rows if view_name in self.view_data else 0
            size_bytes = self.view_data[view_name].get_total_buffer_size() if view_name in self.view_data else 0
            
            refresh_time = time.time() - start_time
            
            self.metadata_manager.record_refresh(view_name, refresh_time)
            self.metadata_manager.update_view_stats(view_name, row_count, size_bytes)
            self.metadata_manager.update_view_status(view_name, ViewStatus.ACTIVE)
            
            return True, incremental_data.num_rows
            
        except Exception as e:
            self.metadata_manager.update_view_status(view_name, ViewStatus.ERROR)
            raise e

    def _build_incremental_sql(self, view_def: MaterializedViewDefinition, current_watermark: Any) -> str:
        if isinstance(current_watermark, (int, float)):
            where_clause = f"{view_def.incremental_column} > {current_watermark}"
        elif isinstance(current_watermark, str):
            where_clause = f"{view_def.incremental_column} > '{current_watermark}'"
        else:
            where_clause = f"{view_def.incremental_column} > '{current_watermark}'"
        
        if "WHERE" in view_def.source_sql.upper():
            incremental_sql = view_def.source_sql.replace(
                "WHERE", f"WHERE {where_clause} AND", 1
            )
        else:
            incremental_sql = f"{view_def.source_sql} WHERE {where_clause}"
        
        return incremental_sql

    def _merge_incremental_data(self, existing_data: pa.Table, 
                                 incremental_data: pa.Table,
                                 incremental_column: str) -> pa.Table:
        existing_df = self.arrow_handler.to_dataframe(existing_data)
        incremental_df = self.arrow_handler.to_dataframe(incremental_data)
        
        merged_df = pd.concat([existing_df, incremental_df]).drop_duplicates(
            subset=[incremental_column] if incremental_column else None,
            keep='last'
        )
        
        return self.arrow_handler.to_arrow_table(merged_df)

    def _get_max_value(self, table: pa.Table, column_name: str) -> Any:
        df = self.arrow_handler.to_dataframe(table)
        if column_name in df.columns:
            return df[column_name].max()
        return None

    def get_view_data(self, view_name: str) -> Optional[pa.Table]:
        with self.lock:
            return self.view_data.get(view_name)

    def drop_view_data(self, view_name: str) -> None:
        with self.lock:
            if view_name in self.view_data:
                del self.view_data[view_name]


class RefreshScheduler:
    def __init__(self, refresher: MaterializedViewRefresher,
                 metadata_manager: ViewMetadataManager,
                 check_interval_seconds: int = 60):
        self.refresher = refresher
        self.metadata_manager = metadata_manager
        self.check_interval_seconds = check_interval_seconds
        self.running = False
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    def start(self) -> None:
        if self.running:
            return
        
        self.running = True
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_scheduler, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self.running = False
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)

    def _run_scheduler(self) -> None:
        while self.running and not self._stop_event.is_set():
            try:
                self._check_and_refresh()
            except Exception as e:
                print(f"Scheduler error: {e}")
            
            self._stop_event.wait(self.check_interval_seconds)

    def _check_and_refresh(self) -> None:
        views_to_refresh = self.metadata_manager.get_views_needing_refresh()
        
        for view_def in views_to_refresh:
            if self._stop_event.is_set():
                break
            
            try:
                if view_def.refresh_strategy == RefreshStrategy.INCREMENTAL:
                    self.refresher.refresh_incremental(view_def.view_name)
                else:
                    self.refresher.refresh_full(view_def.view_name)
            except Exception as e:
                print(f"Error refreshing view '{view_def.view_name}': {e}")

    def trigger_refresh(self, view_name: str, incremental: bool = False) -> bool:
        try:
            if incremental:
                success, rows = self.refresher.refresh_incremental(view_name)
            else:
                success, rows = self.refresher.refresh_full(view_name)
            return success
        except Exception:
            return False


class MaterializedViewManager:
    def __init__(self, query_executor: Callable[[str], pa.Table],
                 metadata_path: Optional[str] = None):
        self.arrow_handler = ArrowHandler()
        self.metadata_manager = ViewMetadataManager(metadata_path)
        self.rewrite_optimizer = QueryRewriteOptimizer(self.metadata_manager)
        self.refresher = MaterializedViewRefresher(
            self.metadata_manager, query_executor, self.arrow_handler
        )
        self.scheduler = RefreshScheduler(self.refresher, self.metadata_manager)
        
        if metadata_path:
            self.metadata_manager.load_metadata()

    def create_materialized_view(self, view_name: str, source_sql: str,
                                 source_tables: List[str], columns: List[str],
                                 refresh_strategy: RefreshStrategy = RefreshStrategy.SCHEDULED,
                                 refresh_interval_seconds: int = 3600,
                                 incremental_column: Optional[str] = None,
                                 partition_by: Optional[str] = None,
                                 description: str = "") -> bool:
        view_def = MaterializedViewDefinition(
            view_name=view_name,
            source_sql=source_sql,
            source_tables=source_tables,
            columns=columns,
            partition_by=partition_by,
            refresh_strategy=refresh_strategy,
            refresh_interval_seconds=refresh_interval_seconds,
            incremental_column=incremental_column,
            description=description
        )
        
        success = self.metadata_manager.create_view(view_def)
        
        if success:
            self.refresher.refresh_full(view_name)
        
        return success

    def drop_materialized_view(self, view_name: str) -> bool:
        self.refresher.drop_view_data(view_name)
        return self.metadata_manager.drop_view(view_name)

    def refresh_view(self, view_name: str, incremental: bool = False) -> bool:
        if incremental:
            success, rows = self.refresher.refresh_incremental(view_name)
        else:
            success, rows = self.refresher.refresh_full(view_name)
        return success

    def execute_with_rewrite(self, query_sql: str, tables_in_query: List[str],
                             select_columns: List[str], 
                             group_by_columns: Optional[List[str]] = None) -> Tuple[Optional[pa.Table], Optional[str]]:
        best_view = self.rewrite_optimizer.find_best_matching_view(
            query_sql, tables_in_query, select_columns, group_by_columns
        )
        
        if best_view:
            self.metadata_manager.record_query_hit(best_view)
            view_data = self.refresher.get_view_data(best_view)
            if view_data is not None:
                return view_data, best_view
        
        return None, None

    def get_view_data(self, view_name: str) -> Optional[pa.Table]:
        return self.refresher.get_view_data(view_name)

    def list_views(self) -> List[str]:
        return self.metadata_manager.list_views()

    def get_view_info(self, view_name: str) -> Optional[Dict[str, Any]]:
        view_def = self.metadata_manager.get_view(view_name)
        if not view_def:
            return None
        
        stats = self.metadata_manager.view_stats.get(view_name)
        status = self.metadata_manager.get_view_status(view_name)
        
        return {
            "definition": asdict(view_def),
            "stats": asdict(stats) if stats else None,
            "status": status.value if status else None
        }

    def start_scheduler(self) -> None:
        self.scheduler.start()

    def stop_scheduler(self) -> None:
        self.scheduler.stop()

    def trigger_manual_refresh(self, view_name: str, incremental: bool = False) -> bool:
        return self.scheduler.trigger_refresh(view_name, incremental)
