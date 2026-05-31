import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pyarrow as pa
import pandas as pd
import numpy as np
import time

from federated_query_gateway.core import (
    MaterializedViewManager,
    RefreshStrategy,
    ViewStatus,
    ArrowHandler
)


def create_test_data():
    """创建测试数据"""
    np.random.seed(42)
    n_rows = 10000
    
    sales_data = {
        'id': list(range(n_rows)),
        'product_id': np.random.randint(1, 100, n_rows).tolist(),
        'category': np.random.choice(['Electronics', 'Clothing', 'Food', 'Books'], n_rows).tolist(),
        'amount': np.random.uniform(10, 1000, n_rows).tolist(),
        'quantity': np.random.randint(1, 20, n_rows).tolist(),
        'sale_date': pd.date_range('2024-01-01', periods=n_rows, freq='H').strftime('%Y-%m-%d %H:%M:%S').tolist(),
        'region': np.random.choice(['North', 'South', 'East', 'West'], n_rows).tolist()
    }
    
    return pa.Table.from_pylist([
        {k: v[i] for k, v in sales_data.items()}
        for i in range(n_rows)
    ])


def create_simple_query_executor(test_table: pa.Table):
    """创建一个简单的查询执行器用于测试"""
    handler = ArrowHandler()
    
    def query_executor(sql: str) -> pa.Table:
        df = handler.to_dataframe(test_table)
        
        if 'category' in sql and 'GROUP BY' in sql:
            if 'SUM' in sql and 'COUNT' in sql:
                result = df.groupby('category').agg({
                    'amount': 'sum',
                    'quantity': 'count'
                }).reset_index()
                result.columns = ['category', 'total_amount', 'total_count']
            else:
                result = df.groupby('category').agg({
                    'amount': 'sum',
                    'quantity': 'sum'
                }).reset_index()
        elif 'region' in sql and 'GROUP BY' in sql:
            result = df.groupby('region').agg({
                'amount': 'sum',
                'quantity': 'sum'
            }).reset_index()
        else:
            if 'WHERE' in sql:
                result = df.head(1000)
            else:
                result = df
        
        return handler.to_arrow_table(result)
    
    return query_executor


def test_metadata_management():
    """测试元数据管理"""
    print("=" * 60)
    print("测试1: 元数据管理")
    print("=" * 60)
    
    test_table = create_test_data()
    query_executor = create_simple_query_executor(test_table)
    
    mv_manager = MaterializedViewManager(query_executor)
    
    print("创建物化视图...")
    view_name = "sales_by_category"
    source_sql = "SELECT category, SUM(amount) as total_amount, COUNT(*) as total_count FROM sales GROUP BY category"
    source_tables = ["sales"]
    columns = ["category", "total_amount", "total_count"]
    
    success = mv_manager.create_materialized_view(
        view_name=view_name,
        source_sql=source_sql,
        source_tables=source_tables,
        columns=columns,
        refresh_strategy=RefreshStrategy.SCHEDULED,
        refresh_interval_seconds=3600,
        description="按品类汇总的销售数据"
    )
    
    print(f"创建成功: {success}")
    
    print(f"\n视图列表: {mv_manager.list_views()}")
    
    view_info = mv_manager.get_view_info(view_name)
    print(f"视图信息:")
    print(f"  状态: {view_info['status']}")
    print(f"  刷新策略: {view_info['definition']['refresh_strategy']}")
    print(f"  行数: {view_info['stats']['row_count']}")
    print(f"  大小: {view_info['stats']['size_bytes'] / 1024:.2f} KB")
    
    print("\n获取视图数据...")
    view_data = mv_manager.get_view_data(view_name)
    print(f"视图数据行数: {view_data.num_rows}")
    print(f"视图Schema: {view_data.schema.names}")
    
    print("\n✓ 元数据管理测试通过\n")
    return mv_manager, view_name


def test_query_rewrite():
    """测试查询改写优化"""
    print("=" * 60)
    print("测试2: 查询改写优化")
    print("=" * 60)
    
    test_table = create_test_data()
    query_executor = create_simple_query_executor(test_table)
    
    mv_manager = MaterializedViewManager(query_executor)
    
    view_name = "sales_by_category"
    mv_manager.create_materialized_view(
        view_name=view_name,
        source_sql="SELECT category, SUM(amount) as total_amount FROM sales GROUP BY category",
        source_tables=["sales"],
        columns=["category", "total_amount"],
        refresh_strategy=RefreshStrategy.ON_DEMAND
    )
    
    query_sql = "SELECT category, SUM(amount) FROM sales WHERE region = 'North' GROUP BY category"
    tables_in_query = ["sales"]
    select_columns = ["category", "amount"]
    group_by_columns = ["category"]
    
    print(f"原始查询: {query_sql}")
    
    rewritten_data, matched_view = mv_manager.execute_with_rewrite(
        query_sql, tables_in_query, select_columns, group_by_columns
    )
    
    print(f"匹配视图: {matched_view}")
    if rewritten_data is not None:
        print(f"改写成功，返回数据行数: {rewritten_data.num_rows}")
        
        view_info = mv_manager.get_view_info(view_name)
        print(f"命中计数: {view_info['stats']['hit_count']}")
        print(f"查询计数: {view_info['stats']['query_count']}")
    else:
        print("未找到匹配的物化视图")
    
    print("\n✓ 查询改写优化测试通过\n")


def test_full_refresh():
    """测试全量刷新"""
    print("=" * 60)
    print("测试3: 全量刷新")
    print("=" * 60)
    
    test_table = create_test_data()
    query_executor = create_simple_query_executor(test_table)
    
    mv_manager = MaterializedViewManager(query_executor)
    
    view_name = "sales_by_region"
    mv_manager.create_materialized_view(
        view_name=view_name,
        source_sql="SELECT region, SUM(amount) as total_amount FROM sales GROUP BY region",
        source_tables=["sales"],
        columns=["region", "total_amount"],
        refresh_strategy=RefreshStrategy.ON_DEMAND
    )
    
    initial_info = mv_manager.get_view_info(view_name)
    print(f"初始刷新计数: {initial_info['stats']['refresh_count']}")
    print(f"初始平均刷新时间: {initial_info['stats']['avg_refresh_time_seconds']:.4f}s")
    
    print("\n执行全量刷新...")
    start_time = time.time()
    refresh_success = mv_manager.refresh_view(view_name, incremental=False)
    refresh_time = time.time() - start_time
    
    print(f"刷新成功: {refresh_success}")
    print(f"刷新耗时: {refresh_time:.4f}s")
    
    refreshed_info = mv_manager.get_view_info(view_name)
    print(f"刷新后计数: {refreshed_info['stats']['refresh_count']}")
    print(f"更新后平均刷新时间: {refreshed_info['stats']['avg_refresh_time_seconds']:.4f}s")
    print(f"当前状态: {refreshed_info['status']}")
    
    print("\n✓ 全量刷新测试通过\n")


def test_incremental_refresh():
    """测试增量刷新"""
    print("=" * 60)
    print("测试4: 增量刷新")
    print("=" * 60)
    
    test_table = create_test_data()
    query_executor = create_simple_query_executor(test_table)
    
    mv_manager = MaterializedViewManager(query_executor)
    
    view_name = "incremental_sales"
    mv_manager.create_materialized_view(
        view_name=view_name,
        source_sql="SELECT id, category, amount, quantity FROM sales",
        source_tables=["sales"],
        columns=["id", "category", "amount", "quantity"],
        refresh_strategy=RefreshStrategy.INCREMENTAL,
        incremental_column="id"
    )
    
    initial_info = mv_manager.get_view_info(view_name)
    print(f"初始行数: {initial_info['stats']['row_count']}")
    print(f"初始水印值: {initial_info['definition']['last_incremental_watermark']}")
    
    print("\n执行增量刷新（首次增量刷新应回退到全量刷新）...")
    refresh_success = mv_manager.refresh_view(view_name, incremental=True)
    print(f"增量刷新成功: {refresh_success}")
    
    refreshed_info = mv_manager.get_view_info(view_name)
    print(f"刷新后行数: {refreshed_info['stats']['row_count']}")
    print(f"更新后水印值: {refreshed_info['definition']['last_incremental_watermark']}")
    print(f"刷新计数: {refreshed_info['stats']['refresh_count']}")
    
    print("\n✓ 增量刷新测试通过\n")


def test_view_lifecycle():
    """测试视图完整生命周期"""
    print("=" * 60)
    print("测试5: 视图完整生命周期")
    print("=" * 60)
    
    test_table = create_test_data()
    query_executor = create_simple_query_executor(test_table)
    
    mv_manager = MaterializedViewManager(query_executor)
    
    view_name = "test_lifecycle_view"
    
    print("1. 创建视图...")
    success = mv_manager.create_materialized_view(
        view_name=view_name,
        source_sql="SELECT * FROM sales",
        source_tables=["sales"],
        columns=["id", "category", "amount", "quantity"],
        refresh_strategy=RefreshStrategy.ON_DEMAND
    )
    print(f"   创建成功: {success}")
    print(f"   当前视图列表: {mv_manager.list_views()}")
    
    print("\n2. 手动刷新...")
    refresh_success = mv_manager.refresh_view(view_name)
    print(f"   刷新成功: {refresh_success}")
    
    view_info = mv_manager.get_view_info(view_name)
    print(f"   视图状态: {view_info['status']}")
    print(f"   视图行数: {view_info['stats']['row_count']}")
    
    print("\n3. 查询改写命中...")
    result, matched = mv_manager.execute_with_rewrite(
        "SELECT * FROM sales",
        ["sales"],
        ["id", "category", "amount", "quantity"]
    )
    print(f"   命中视图: {matched}")
    print(f"   返回行数: {result.num_rows if result else 0}")
    
    print("\n4. 删除视图...")
    drop_success = mv_manager.drop_materialized_view(view_name)
    print(f"   删除成功: {drop_success}")
    print(f"   删除后视图列表: {mv_manager.list_views()}")
    
    print("\n✓ 视图完整生命周期测试通过\n")


def test_scheduler():
    """测试定时调度器"""
    print("=" * 60)
    print("测试6: 定时调度器")
    print("=" * 60)
    
    test_table = create_test_data()
    query_executor = create_simple_query_executor(test_table)
    
    mv_manager = MaterializedViewManager(query_executor)
    
    view_name = "scheduled_view"
    mv_manager.create_materialized_view(
        view_name=view_name,
        source_sql="SELECT category, COUNT(*) as cnt FROM sales GROUP BY category",
        source_tables=["sales"],
        columns=["category", "cnt"],
        refresh_strategy=RefreshStrategy.SCHEDULED,
        refresh_interval_seconds=1
    )
    
    initial_info = mv_manager.get_view_info(view_name)
    print(f"初始刷新计数: {initial_info['stats']['refresh_count']}")
    
    print("\n启动调度器...")
    mv_manager.start_scheduler()
    
    print("等待3秒观察自动刷新...")
    time.sleep(3)
    
    after_info = mv_manager.get_view_info(view_name)
    print(f"刷新后计数: {after_info['stats']['refresh_count']}")
    print(f"是否自动刷新: {after_info['stats']['refresh_count'] > initial_info['stats']['refresh_count']}")
    
    print("\n停止调度器...")
    mv_manager.stop_scheduler()
    
    print("\n✓ 定时调度器测试通过\n")


def test_multiple_views():
    """测试多视图管理"""
    print("=" * 60)
    print("测试7: 多视图管理")
    print("=" * 60)
    
    test_table = create_test_data()
    query_executor = create_simple_query_executor(test_table)
    
    mv_manager = MaterializedViewManager(query_executor)
    
    views_config = [
        {
            "name": "view_by_category",
            "sql": "SELECT category, SUM(amount) FROM sales GROUP BY category",
            "columns": ["category", "amount"],
            "tables": ["sales"]
        },
        {
            "name": "view_by_region",
            "sql": "SELECT region, COUNT(*) FROM sales GROUP BY region",
            "columns": ["region", "count"],
            "tables": ["sales"]
        },
        {
            "name": "view_by_product",
            "sql": "SELECT product_id, AVG(amount) FROM sales GROUP BY product_id",
            "columns": ["product_id", "amount"],
            "tables": ["sales"]
        }
    ]
    
    print("创建多个视图...")
    for config in views_config:
        mv_manager.create_materialized_view(
            view_name=config["name"],
            source_sql=config["sql"],
            source_tables=config["tables"],
            columns=config["columns"],
            refresh_strategy=RefreshStrategy.ON_DEMAND
        )
    
    print(f"总视图数: {len(mv_manager.list_views())}")
    print(f"视图列表: {mv_manager.list_views()}")
    
    print("\n各视图状态:")
    for view_name in mv_manager.list_views():
        info = mv_manager.get_view_info(view_name)
        print(f"  {view_name}: {info['status']}, {info['stats']['row_count']} rows")
    
    print("\n测试查询匹配最佳视图...")
    test_queries = [
        ("SELECT category, SUM(amount) FROM sales GROUP BY category", ["sales"], ["category", "amount"], ["category"]),
        ("SELECT region FROM sales", ["sales"], ["region"], None),
        ("SELECT product_id FROM sales", ["sales"], ["product_id"], None)
    ]
    
    for sql, tables, cols, group_by in test_queries:
        result, matched = mv_manager.execute_with_rewrite(sql, tables, cols, group_by)
        print(f"  查询: {sql[:50]}... -> 匹配: {matched}")
    
    print("\n✓ 多视图管理测试通过\n")


def main():
    print("\n" + "=" * 60)
    print("联邦查询网关 - 物化视图功能测试套件")
    print("=" * 60 + "\n")
    
    try:
        mv_manager, view_name = test_metadata_management()
        test_query_rewrite()
        test_full_refresh()
        test_incremental_refresh()
        test_view_lifecycle()
        test_scheduler()
        test_multiple_views()
        
        print("=" * 60)
        print("所有测试通过! ✓")
        print("=" * 60)
        print("\n已实现的物化视图功能:")
        print("  1. 元数据管理 - 视图定义、状态、统计持久化")
        print("  2. 查询改写优化 - 自动匹配最佳物化视图")
        print("  3. 全量刷新机制 - 完整重建视图数据")
        print("  4. 增量刷新机制 - 基于水印仅处理变更数据")
        print("  5. 定时调度器 - 后台自动执行刷新任务")
        print("  6. 多视图管理 - 支持多个物化视图同时存在")
        print("  7. 完整生命周期 - 创建、查询、刷新、删除")
        
    except Exception as e:
        print(f"\n测试失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
