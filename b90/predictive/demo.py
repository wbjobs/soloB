#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
预测性查询诊断系统 - 演示脚本
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from predictive.timeseries.processor import TimeSeriesProcessor
from predictive.predictor.prophet_model import QueryPerformancePredictor
from predictive.sql_analyzer.parser import SQLPatternAnalyzer
from predictive.index_recommender.recommender import IndexRecommender
from predictive.alerting.alert_manager import AlertManager

import json
from datetime import datetime

def print_header(title):
    print("\n" + "=" * 60)
    print(f"  {title}")
    print("=" * 60 + "\n")

def demo_timeseries_processor():
    print_header("1. 时序数据收集与处理")

    processor = TimeSeriesProcessor()

    # 生成测试数据
    print("生成测试数据...")
    metrics = processor.generate_synthetic_data(duration_hours=48, num_queries=3, seed=42)
    print(f"  生成 {len(metrics)} 条测试指标记录")

    # 添加数据
    processor.add_metrics(metrics)

    # 获取查询哈希列表
    query_hashes = list(processor.query_metrics.keys())
    print(f"  查询哈希数量: {len(query_hashes)}")
    for i, qh in enumerate(query_hashes[:3]):
        print(f"    查询 {i+1}: {qh}")

    # 获取单个查询数据
    if query_hashes:
        data = processor.get_query_metrics(query_hashes[0], hours=24)
        print(f"\n  单查询数据点: {len(data)}")
        if data:
            print(f"  最新数据: 执行时间 {data[-1]['duration_ms']:.2f}ms")

    return processor, query_hashes

def demo_predictor(processor, query_hashes):
    print_header("2. Prophet时序预测模型")

    predictor = QueryPerformancePredictor()

    # 为前2个查询训练模型
    for i, qh in enumerate(query_hashes[:2]):
        print(f"\n训练查询 {i+1} 的模型...")
        prophet_data = processor.prepare_prophet_data(qh)
        if prophet_data is not None and len(prophet_data) >= 10:
            success = predictor.train(qh, prophet_data, auto_detect_seasonality=True)
            if success:
                state = predictor.get_training_state(qh)
                print(f"  ✓ 模型训练成功")
                print(f"    数据点数量: {state.data_points}")
                print(f"    季节性检测: 每日={state.seasonality.get('daily', False)}, "
                      f"每周={state.seasonality.get('weekly', False)}")
                print(f"    MAPE: {state.mape:.2f}%" if state.mape else "    MAPE: N/A")
            else:
                print(f"  ✗ 模型训练失败")
        else:
            print(f"  ✗ 数据不足，无法训练")

    # 执行预测
    print("\n执行预测...")
    predictions = predictor.predict_all()
    print(f"  完成 {len(predictions)} 个查询的预测")

    anomalies = [p for p in predictions if p.get('is_anomaly', False)]
    print(f"  检测到 {len(anomalies)} 个异常预测")

    for pred in predictions[:2]:
        print(f"\n  查询 {pred['query_hash'][:12]}...:")
        print(f"    预测执行时间: {pred['predicted_duration_ms']:.2f}ms")
        print(f"    变化百分比: {pred['change_percent']:.2f}%")
        print(f"    置信度: {pred['confidence']:.2f}")
        print(f"    是否异常: {pred['is_anomaly']}")
        if pred['is_anomaly']:
            print(f"    异常分数: {pred['anomaly_score']:.2f}")

    return predictor

def demo_sql_analyzer():
    print_header("3. SQL模式分析引擎")

    analyzer = SQLPatternAnalyzer()

    test_sqls = [
        "SELECT * FROM users WHERE status = 'active' AND created_at > '2024-01-01'",
        "SELECT u.id, u.name, COUNT(o.id) as order_count FROM users u LEFT JOIN orders o ON u.id = o.user_id WHERE u.status = 'active' GROUP BY u.id, u.name HAVING COUNT(o.id) > 5 ORDER BY order_count DESC",
        "INSERT INTO users (name, email) VALUES ('test', 'test@example.com')",
    ]

    for i, sql in enumerate(test_sqls):
        print(f"\nSQL {i+1}: {sql[:80]}...")
        parsed = analyzer.parse(sql)

        print(f"  类型: {parsed.query_type}")
        print(f"  涉及表: {', '.join(parsed.tables)}")
        print(f"  WHERE列: {', '.join(parsed.where_columns) if parsed.where_columns else '无'}")
        print(f"  JOIN列: {', '.join(parsed.join_columns) if parsed.join_columns else '无'}")
        print(f"  ORDER BY: {', '.join(parsed.order_by_columns) if parsed.order_by_columns else '无'}")
        print(f"  GROUP BY: {', '.join(parsed.group_by_columns) if parsed.group_by_columns else '无'}")
        print(f"  含聚合: {'是' if parsed.has_aggregation else '否'}")
        print(f"  含子查询: {'是' if parsed.has_subquery else '否'}")

    return analyzer

def demo_index_recommender(analyzer):
    print_header("4. 智能索引推荐算法")

    recommender = IndexRecommender()

    test_sql = """
    SELECT u.id, u.name, u.email, o.total_amount
    FROM users u
    JOIN orders o ON u.id = o.user_id
    WHERE u.status = 'active'
      AND o.created_at >= '2024-01-01'
      AND o.total_amount > 100
    ORDER BY o.created_at DESC
    """

    print(f"分析SQL:\n{test_sql.strip()}\n")

    recommendations = recommender.recommend_for_query(test_sql)
    print(f"生成 {len(recommendations)} 条索引推荐:")

    for i, rec in enumerate(recommendations, 1):
        print(f"\n  推荐 {i}: {rec.index_name}")
        print(f"    优先级: {rec.priority}")
        print(f"    风险级别: {rec.risk_level}")
        print(f"    预期改进: {rec.estimated_improvement_pct:.1f}%")
        print(f"    置信度: {rec.confidence * 100:.0f}%")
        print(f"    创建语句: {rec.create_statement}")
        print(f"    原因: {rec.reason}")

    # 生成优化报告
    print("\n生成优化报告...")
    report = recommender.generate_optimization_report(recommendations, test_sql)
    print(f"  推荐总数: {report['summary']['total_recommendations']}")
    print(f"  高优先级: {report['summary']['high_priority_count']}")
    print(f"  平均预期改进: {report['summary']['average_estimated_improvement_pct']:.2f}%")

    return recommender

def demo_alert_manager():
    print_header("5. 告警系统")

    alert_manager = AlertManager()

    # 创建测试告警
    print("创建测试告警...")

    # 性能异常告警
    alert1 = alert_manager.create_alert(
        alert_type="performance_anomaly",
        severity="critical",
        title="查询性能严重下降",
        message="查询执行时间已超过阈值3倍，需要立即关注",
        query_hash="abc123def456",
        sql_pattern="SELECT * FROM large_table WHERE status = ?",
        anomaly_score=3.5,
        confidence=0.92,
        metrics={"current_duration": 1500, "threshold": 500}
    )
    print(f"  ✓ 创建告警: {alert1.alert_id if alert1 else '失败'}")

    # 预测告警
    alert2 = alert_manager.create_alert(
        alert_type="predicted_slowdown",
        severity="warning",
        title="预测查询性能下降",
        message="基于历史模式预测，30分钟内查询性能预计下降",
        query_hash="def789ghi012",
        sql_pattern="SELECT count(*) FROM orders WHERE created_at > ?",
        predicted_duration_ms=850,
        confidence=0.78
    )
    print(f"  ✓ 创建告警: {alert2.alert_id if alert2 else '失败'}")

    # 查询告警列表
    alerts = alert_manager.get_alerts()
    print(f"\n当前告警总数: {len(alerts)}")
    for a in alerts:
        print(f"  [{a.severity}] {a.title} ({a.status})")

    # 确认告警
    if alerts:
        alert_manager.acknowledge_alert(alerts[0].alert_id)
        print(f"\n  ✓ 确认告警: {alerts[0].alert_id}")

    return alert_manager

def main():
    print("\n" + "╔" + "═" * 58 + "╗")
    print("║" + " " * 12 + "预测性查询诊断系统 - 功能演示" + " " * 13 + "║")
    print("╚" + "═" * 58 + "╝")

    try:
        # 1. 时序数据收集与处理
        processor, query_hashes = demo_timeseries_processor()

        # 2. 预测模型
        if query_hashes:
            demo_predictor(processor, query_hashes)

        # 3. SQL分析
        analyzer = demo_sql_analyzer()

        # 4. 索引推荐
        demo_index_recommender(analyzer)

        # 5. 告警系统
        demo_alert_manager()

        print_header("演示完成")
        print("所有核心功能模块运行成功！")
        print("\n启动服务器: python predictive/start_server.py")
        print("访问界面: http://localhost:8000/")
        print("API文档: http://localhost:8000/docs")

    except ImportError as e:
        print(f"\n⚠️  缺少依赖: {e}")
        print("请先安装依赖: pip install -r predictive/requirements.txt")
    except Exception as e:
        print(f"\n✗ 演示出错: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
