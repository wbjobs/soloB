#!/usr/bin/env python3
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dht_crawler.modules.nat_detector import NATDetector, NATType
from dht_crawler.modules.upnp_helper import UPnPPortMapper
from dht_crawler.modules.relay_nodes import RelayManager, PREDEFINED_RELAYS
from dht_crawler.modules.dht_network import DHTNetwork
from dht_crawler.modules.health_predictor import HealthPredictor

async def test_nat_detection():
    print("\n" + "="*60)
    print("测试 1: NAT类型检测")
    print("="*60)
    
    detector = NATDetector()
    try:
        nat_type = await asyncio.wait_for(detector.detect(), timeout=15.0)
        print(f"✓ NAT类型: {nat_type.value}")
        print(f"✓ 外部IP: {detector.external_ip}")
        print(f"✓ 推荐策略: {', '.join(detector.get_recommended_strategy())}")
        print(f"✓ 网络描述: {detector.get_strategy_description()}")
        return True
    except Exception as e:
        print(f"✗ NAT检测失败: {e}")
        return False

async def test_upnp():
    print("\n" + "="*60)
    print("测试 2: UPnP端口映射")
    print("="*60)
    
    mapper = UPnPPortMapper()
    try:
        discovered = await asyncio.wait_for(mapper.discover_gateway(), timeout=10.0)
        if discovered:
            print("✓ 发现UPnP网关")
            
            test_port = 16881
            port_added = await asyncio.wait_for(
                mapper.add_port_mapping(test_port, test_port, "UDP", "DHT Test"),
                timeout=5.0
            )
            
            if port_added:
                print(f"✓ 端口映射成功: {test_port}")
                
                external_ip = await asyncio.wait_for(mapper.get_external_ip_address(), timeout=5.0)
                if external_ip:
                    print(f"✓ 外部IP: {external_ip}")
                
                await mapper.delete_port_mapping(test_port)
                print(f"✓ 端口映射已删除")
            else:
                print("✗ 端口映射失败 (可能需要管理员权限)")
                
            await mapper.cleanup()
            return True
        else:
            print("✗ 未发现UPnP网关 (可能不支持UPnP)")
            return False
    except Exception as e:
        print(f"✗ UPnP测试失败: {e}")
        return False

async def test_relay_nodes():
    print("\n" + "="*60)
    print("测试 3: 中继节点 (超级节点)")
    print("="*60)
    
    print(f"预定义中继节点数量: {len(PREDEFINED_RELAYS)}")
    for i, relay in enumerate(PREDEFINED_RELAYS[:5], 1):
        print(f"  {i}. {relay.host}:{relay.port}")
    
    manager = RelayManager()
    try:
        await asyncio.wait_for(manager.initialize(), timeout=15.0)
        
        active_count = len(manager.active_relays)
        print(f"\n✓ 活跃中继节点: {active_count}/{len(PREDEFINED_RELAYS)}")
        
        if manager.active_relays:
            for i, relay in enumerate(manager.active_relays[:3], 1):
                print(f"  {i}. {relay.host}:{relay.port} - 延迟: {relay.latency:.2f}ms")
            
            best_relay = manager.get_best_relay()
            if best_relay:
                print(f"\n✓ 最佳中继: {best_relay.host}:{best_relay.port}")
                return True
        else:
            print("✗ 无活跃中继节点 (可能网络问题)")
            return False
            
    except Exception as e:
        print(f"✗ 中继节点测试失败: {e}")
        return False

async def test_dht_network():
    print("\n" + "="*60)
    print("测试 4: DHT网络 (集成所有穿透策略)")
    print("="*60)
    
    dht = DHTNetwork(port=16881, enable_traversal=True)
    try:
        await asyncio.wait_for(dht.start(), timeout=30.0)
        
        print(f"\n✓ DHT节点启动成功")
        print(f"  Node ID: {dht.node_id.hex()[:20]}...")
        
        stats = dht.get_traversal_stats()
        print(f"\n✓ 穿透统计:")
        print(f"  NAT类型: {stats['nat_type']}")
        print(f"  活跃策略: {stats['active_strategy']}")
        print(f"  路由表大小: {stats['routing_table_size']}")
        print(f"  中继节点数: {stats['relay_nodes_count']}")
        print(f"  Bootstrap完成: {stats['bootstrap_completed']}")
        
        print(f"\n✓ 各策略状态:")
        for name, strategy in stats['strategies'].items():
            status = "启用" if strategy['enabled'] else "禁用"
            print(f"  {name:15s} {status:6s} 成功率: {strategy['success_rate']:.2f}")
        
        await asyncio.sleep(5)
        
        test_infohash = bytes.fromhex("0123456789abcdef0123456789abcdef01234567")
        peers = await asyncio.wait_for(dht.get_peers(test_infohash, timeout=15), timeout=20.0)
        print(f"\n✓ Peer发现测试: 找到 {len(peers)} 个peers")
        for ip, port in list(peers)[:5]:
            print(f"  {ip}:{port}")
        
        return True
        
    except Exception as e:
        print(f"✗ DHT网络测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        await dht.close()

async def test_health_predictor():
    print("\n" + "="*60)
    print("测试 5: 健康度预测模型")
    print("="*60)
    
    try:
        predictor = HealthPredictor()
        print("✓ 健康预测模块初始化成功")
        
        print("训练模型 (生成模拟数据)...")
        metrics = predictor.train_model()
        print(f"✓ 模型训练完成")
        print(f"  Peer预测 R²: {metrics['peers_prediction_metrics']['r2']:.4f}")
        print(f"  存活率预测 R²: {metrics['survival_prediction_metrics']['r2']:.4f}")
        
        test_status = {
            "current_peers": 150,
            "reachable_ratio": 0.75,
            "avg_peer_age_hours": 12,
            "isp_diversity": 0.6,
            "country_diversity": 0.5,
            "region_diversity": 0.4,
            "integrity_score": 0.95,
            "seeder_count": 90,
            "leecher_count": 60,
            "hour_of_day": 14,
            "day_of_week": 3,
            "time_since_first_seen_hours": 72
        }
        
        prediction = predictor.predict_health(test_status)
        print(f"\n✓ 健康预测结果:")
        print(f"  预测24小时Peer数: {prediction['predicted_peers_24h']}")
        print(f"  24小时存活率: {prediction['survival_probability_24h']:.4f}")
        print(f"  健康评分: {prediction['health_score']:.4f}")
        print(f"  健康等级: {prediction['health_level']}")
        print(f"  风险因素: {', '.join(prediction['risk_factors']) if prediction['risk_factors'] else '无'}")
        
        print("\n✓ 特征重要性排序:")
        for i, (feature, importance) in enumerate(
            sorted(metrics['feature_importance'].items(), key=lambda x: -x[1])[:5], 1
        ):
            print(f"  {i}. {feature}: {importance}")
        
        return True
        
    except Exception as e:
        print(f"✗ 健康预测测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

async def main():
    print("\n" + "="*60)
    print("DHT爬虫穿透策略综合测试")
    print("="*60)
    
    tests = [
        ("NAT类型检测", test_nat_detection),
        ("UPnP端口映射", test_upnp),
        ("中继节点", test_relay_nodes),
        ("DHT网络 (集成所有策略)", test_dht_network),
        ("健康度预测模型", test_health_predictor),
    ]
    
    results = {}
    
    for name, test_func in tests:
        try:
            results[name] = await test_func()
        except Exception as e:
            print(f"✗ 测试异常: {e}")
            results[name] = False
    
    print("\n" + "="*60)
    print("测试结果汇总")
    print("="*60)
    
    passed = sum(1 for r in results.values() if r)
    total = len(results)
    
    for name, result in results.items():
        status = "通过 ✓" if result else "失败 ✗"
        print(f"  {name:35s} {status}")
    
    print(f"\n总计: {passed}/{total} 测试通过")
    
    if passed == total:
        print("\n🎉 所有测试通过！穿透功能正常工作。")
    elif passed >= total * 0.6:
        print("\n✅ 大部分测试通过。部分功能可能受网络环境影响。")
    else:
        print("\n⚠️  部分测试失败。请检查网络连接和防火墙设置。")
        print("   注意: UPnP和NAT检测可能需要特定网络环境支持。")
    
    print("\n建议:")
    print("  1. 确保UDP端口未被防火墙阻止")
    print("  2. 路由器UPnP功能已启用")
    print("  3. 网络可以访问外部DHT节点")
    print("  4. 如遇问题，可以尝试禁用特定穿透策略")

if __name__ == "__main__":
    asyncio.run(main())
