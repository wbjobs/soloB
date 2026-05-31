#!/usr/bin/env python3
import json
import time
import sys


def test_kafka():
    """Test Kafka connection and message production/consumption"""
    print("\n" + "="*60)
    print("Testing Kafka Connection")
    print("="*60)
    
    try:
        from kafka import KafkaProducer, KafkaConsumer
        from kafka.errors import NoBrokersAvailable
    except ImportError:
        print("❌ kafka-python not installed")
        print("   Install with: pip install kafka-python")
        return False
    
    brokers = "localhost:9092"
    topic = "syscall-test"
    
    print(f"\nConnecting to Kafka at {brokers}...")
    
    try:
        producer = KafkaProducer(
            bootstrap_servers=[brokers],
            value_serializer=lambda v: json.dumps(v).encode('utf-8')
        )
        print("✅ Kafka producer connected")
    except NoBrokersAvailable:
        print("❌ Cannot connect to Kafka")
        print("   Make sure Kafka is running at localhost:9092")
        return False
    except Exception as e:
        print(f"❌ Kafka connection error: {e}")
        return False
    
    test_message = {
        "pid": 12345,
        "tgid": 12345,
        "timestamp": time.time_ns(),
        "syscall": "test",
        "ret": 0,
        "is_exit": False,
        "is_enter": True
    }
    
    try:
        future = producer.send(topic, value=test_message)
        future.get(timeout=10)
        print(f"✅ Sent test message to topic '{topic}'")
    except Exception as e:
        print(f"❌ Failed to send message: {e}")
        producer.close()
        return False
    
    producer.close()
    print("✅ Kafka test passed!")
    return True


def test_elasticsearch():
    """Test Elasticsearch connection and document operations"""
    print("\n" + "="*60)
    print("Testing Elasticsearch Connection")
    print("="*60)
    
    try:
        from elasticsearch import Elasticsearch
    except ImportError:
        print("❌ elasticsearch not installed")
        print("   Install with: pip install elasticsearch==7.17.9")
        return False
    
    hosts = "http://localhost:9200"
    index = "syscall-test"
    
    print(f"\nConnecting to Elasticsearch at {hosts}...")
    
    try:
        es = Elasticsearch([hosts], timeout=30)
        if not es.ping():
            print("❌ Cannot ping Elasticsearch")
            print("   Make sure Elasticsearch is running at localhost:9200")
            return False
        print("✅ Elasticsearch connected")
    except Exception as e:
        print(f"❌ Elasticsearch connection error: {e}")
        return False
    
    test_doc = {
        "windowStart": int(time.time() * 1000),
        "windowEnd": int(time.time() * 1000) + 1000,
        "tgid": 12345,
        "syscall": "test",
        "count": 42,
        "timestamp": int(time.time() * 1000)
    }
    
    try:
        result = es.index(index=index, body=test_doc, refresh=True)
        print(f"✅ Indexed test document: {result['result']}")
    except Exception as e:
        print(f"❌ Failed to index document: {e}")
        return False
    
    try:
        result = es.search(index=index, query={"match_all": {}}, size=1)
        if result['hits']['total']['value'] > 0:
            print(f"✅ Retrieved {result['hits']['total']['value']} documents")
        else:
            print("⚠️  No documents found")
    except Exception as e:
        print(f"❌ Failed to search: {e}")
        return False
    
    print("✅ Elasticsearch test passed!")
    return True


def test_kafka_to_es_flow():
    """Test the complete flow: Kafka -> Flink -> Elasticsearch"""
    print("\n" + "="*60)
    print("Testing End-to-End Flow (Kafka -> Flink -> Elasticsearch)")
    print("="*60)
    
    try:
        from kafka import KafkaProducer
        from elasticsearch import Elasticsearch
    except ImportError:
        print("❌ Required libraries not installed")
        return False
    
    kafka_brokers = "localhost:9092"
    kafka_topic = "syscalls"
    es_hosts = "http://localhost:9200"
    es_index = "syscall-aggregations"
    test_tgid = 99999
    
    print("\nSending test syscall events to Kafka...")
    
    try:
        producer = KafkaProducer(
            bootstrap_servers=[kafka_brokers],
            value_serializer=lambda v: json.dumps(v).encode('utf-8')
        )
    except:
        print("❌ Cannot connect to Kafka")
        return False
    
    syscalls = ['open', 'read', 'write', 'close']
    
    for i in range(10):
        for syscall in syscalls:
            event = {
                "pid": test_tgid,
                "tgid": test_tgid,
                "timestamp": time.time_ns(),
                "syscall": syscall,
                "ret": 0,
                "is_exit": False,
                "is_enter": True
            }
            try:
                producer.send(kafka_topic, value=event)
            except:
                pass
    
    producer.flush()
    producer.close()
    
    print("✅ Sent 40 test events to Kafka topic 'syscalls'")
    print("\nWaiting for Flink to process (15 seconds)...")
    time.sleep(15)
    
    print(f"\nChecking Elasticsearch index '{es_index}'...")
    
    try:
        es = Elasticsearch([es_hosts], timeout=30)
        if not es.ping():
            print("❌ Cannot connect to Elasticsearch")
            return False
    except:
        print("❌ Cannot connect to Elasticsearch")
        return False
    
    if not es.indices.exists(index=es_index):
        print("⚠️  Index does not exist yet")
        print("   Make sure Flink job is running")
        return False
    
    try:
        result = es.search(
            index=es_index,
            query={"term": {"tgid": test_tgid}},
            size=100
        )
        
        hits = result['hits']['hits']
        print(f"✅ Found {len(hits)} documents for test TGID {test_tgid}")
        
        if hits:
            print("\nSample aggregation result:")
            sample = hits[0]['_source']
            print(f"  tgid: {sample.get('tgid')}")
            print(f"  syscall: {sample.get('syscall')}")
            print(f"  count: {sample.get('count')}")
            print(f"  windowStart: {sample.get('windowStart')}")
            
            print("\n✅ End-to-end flow is working!")
            return True
        else:
            print("⚠️  No aggregations found")
            print("   Possible reasons:")
            print("   - Flink job not running")
            print("   - Window not closed yet (wait longer)")
            print("   - Check Flink UI: http://localhost:8081")
            return False
            
    except Exception as e:
        print(f"❌ Query error: {e}")
        return False


def main():
    print("\n" + "="*60)
    print("SYSTEM CALL MONITOR - INFRASTRUCTURE TEST")
    print("="*60)
    
    kafka_ok = test_kafka()
    es_ok = test_elasticsearch()
    
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    
    if kafka_ok and es_ok:
        print("\n✅ Basic infrastructure is working!")
        print("\nRun the following components to complete the setup:")
        print("1. Start Flink cluster:  flink/bin/start-cluster.sh")
        print("2. Submit Flink job:    flink/bin/flink run syscall-flink-job.jar")
        print("3. Start collector:     sudo python3 syscall_monitor_improved.py -p <PID>")
        print("4. Start backend:       python3 app_improved.py")
        print("5. Start frontend:      npm start")
        
        print("\n" + "="*60)
        if input("\nRun end-to-end flow test? (y/n): ").lower() == 'y':
            test_kafka_to_es_flow()
    else:
        print("\n❌ Some infrastructure tests failed")
        print("Please fix the issues before proceeding")
        sys.exit(1)


if __name__ == "__main__":
    main()
