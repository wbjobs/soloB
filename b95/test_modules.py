#!/usr/bin/env python3
import sys
import os

print("Testing DHT Crawler modules...")
print("=" * 50)

try:
    from dht_crawler.modules.dht_network import generate_node_id, decode_nodes
    print("✓ dht_network.py import successful")
    node_id = generate_node_id()
    print(f"  Generated node ID: {node_id.hex()[:20]}...")
except Exception as e:
    print(f"✗ dht_network.py import failed: {e}")

try:
    from dht_crawler.modules.peer_crawler import parse_infohash
    print("✓ peer_crawler.py import successful")
    infohash = "0123456789abcdef0123456789abcdef01234567"
    parsed = parse_infohash(infohash)
    print(f"  Parsed infohash: {parsed.hex()[:20]}...")
except Exception as e:
    print(f"✗ peer_crawler.py import failed: {e}")

try:
    from dht_crawler.modules.file_analyzer import FileAnalyzer
    print("✓ file_analyzer.py import successful")
    analyzer = FileAnalyzer()
    print(f"  FileAnalyzer initialized")
except Exception as e:
    print(f"✗ file_analyzer.py import failed: {e}")
    import traceback
    traceback.print_exc()

try:
    from dht_crawler.modules.health_predictor import HealthPredictor
    print("✓ health_predictor.py import successful")
    predictor = HealthPredictor()
    print(f"  HealthPredictor initialized")
    print("  Training model with 500 samples...")
    metrics = predictor.train_model()
    print(f"  Training complete!")
    print(f"  Peers prediction R2: {metrics['peers_prediction_metrics']['r2']:.4f}")
    print(f"  Survival prediction R2: {metrics['survival_prediction_metrics']['r2']:.4f}")
    
    print("  Testing prediction...")
    test_status = {
        'current_peers': 100,
        'reachable_ratio': 0.6,
        'avg_peer_age_hours': 24,
        'isp_diversity': 0.5,
        'country_diversity': 0.4,
        'region_diversity': 0.3,
        'integrity_score': 0.9,
        'seeder_count': 60,
        'leecher_count': 40,
        'hour_of_day': 14,
        'day_of_week': 2,
        'time_since_first_seen_hours': 168
    }
    prediction = predictor.predict_health(test_status)
    print(f"  Predicted peers 24h: {prediction['predicted_peers_24h']}")
    print(f"  Health score: {prediction['health_score']:.4f}")
    print(f"  Health level: {prediction['health_level']}")
    
    predictor.save_model()
    print("  Model saved successfully")
except Exception as e:
    print(f"✗ health_predictor.py import failed: {e}")
    import traceback
    traceback.print_exc()

print("=" * 50)
print("All module tests completed!")
