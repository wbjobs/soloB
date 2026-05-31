import json
import math
from collections import defaultdict, deque
from datetime import datetime
from kafka import KafkaConsumer, KafkaProducer

KAFKA_BROKER = 'localhost:9092'
SOURCE_TOPIC = 'stock-prices'
ANOMALY_TOPIC = 'price-anomalies'

WINDOW_SECONDS = 60
STD_DEV_THRESHOLD = 2.0
MIN_WINDOW_SIZE = 5

class SlidingWindow:
    def __init__(self, window_seconds):
        self.window_seconds = window_seconds
        self.prices = deque()
        self.timestamps = deque()
    
    def add(self, price, timestamp):
        self.prices.append(price)
        self.timestamps.append(timestamp)
        self._cleanup()
    
    def _cleanup(self):
        if not self.timestamps:
            return
        cutoff = self.timestamps[-1] - self.window_seconds
        while self.timestamps and self.timestamps[0] < cutoff:
            self.timestamps.popleft()
            self.prices.popleft()
    
    def size(self):
        return len(self.prices)
    
    def is_valid(self):
        return self.size() >= MIN_WINDOW_SIZE
    
    def get_stats(self):
        if not self.is_valid():
            return None
        
        n = self.size()
        mean = sum(self.prices) / n
        
        if n < 2:
            return None
        
        sum_sq_diff = sum((x - mean) ** 2 for x in self.prices)
        variance = sum_sq_diff / (n - 1)
        
        if variance < 1e-10:
            return None
        
        std_dev = math.sqrt(variance)
        
        return {
            'mean': mean,
            'std_dev': std_dev,
            'variance': variance,
            'count': n
        }

def create_consumer():
    return KafkaConsumer(
        SOURCE_TOPIC,
        bootstrap_servers=KAFKA_BROKER,
        auto_offset_reset='latest',
        enable_auto_commit=True,
        group_id='stock-price-processor',
        value_deserializer=lambda m: json.loads(m.decode('utf-8')),
        key_deserializer=lambda k: k.decode('utf-8') if k else None
    )

def create_producer():
    return KafkaProducer(
        bootstrap_servers=KAFKA_BROKER,
        value_serializer=lambda v: json.dumps(v).encode('utf-8'),
        key_serializer=lambda k: k.encode('utf-8') if k else None
    )

def parse_timestamp(iso_string):
    try:
        return datetime.fromisoformat(iso_string).timestamp()
    except:
        return datetime.utcnow().timestamp()

def main():
    consumer = create_consumer()
    producer = create_producer()
    
    windows = defaultdict(lambda: SlidingWindow(WINDOW_SECONDS))
    
    print(f"连接到 Kafka 代理: {KAFKA_BROKER}")
    print(f"消费主题: {SOURCE_TOPIC}")
    print(f"异常主题: {ANOMALY_TOPIC}")
    print(f"滑动窗口大小: {WINDOW_SECONDS} 秒")
    print(f"最小窗口大小: {MIN_WINDOW_SIZE} 个数据点")
    print(f"异常阈值: {STD_DEV_THRESHOLD} 标准差")
    print("=" * 60)
    
    try:
        for message in consumer:
            data = message.value
            symbol = data.get('symbol')
            current_price = data.get('price')
            timestamp_str = data.get('timestamp')
            
            if not all([symbol, current_price, timestamp_str]):
                continue
            
            timestamp = parse_timestamp(timestamp_str)
            
            window = windows[symbol]
            
            stats = window.get_stats()
            
            if stats:
                mean = stats['mean']
                std_dev = stats['std_dev']
                deviation = abs(current_price - mean)
                deviation_std_devs = deviation / std_dev
                
                if deviation_std_devs > STD_DEV_THRESHOLD:
                    anomaly_message = {
                        'symbol': symbol,
                        'current_price': current_price,
                        'moving_average': round(mean, 2),
                        'std_dev': round(std_dev, 2),
                        'deviation_std_devs': round(deviation_std_devs, 2),
                        'window_size': stats['count'],
                        'detection_time': datetime.utcnow().isoformat(),
                        'original_timestamp': timestamp_str,
                        'anomaly_type': 'HIGH' if current_price > mean else 'LOW'
                    }
                    
                    producer.send(ANOMALY_TOPIC, key=symbol, value=anomaly_message)
                    producer.flush()
                    
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] 检测到异常:")
                    print(f"  股票: {symbol}")
                    print(f"  当前价格: ${current_price}")
                    print(f"  移动平均: ${anomaly_message['moving_average']}")
                    print(f"  标准差: ${anomaly_message['std_dev']}")
                    print(f"  偏离: {anomaly_message['deviation_std_devs']}σ ({anomaly_message['anomaly_type']})")
                    print("-" * 60)
                else:
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] 正常: {symbol} ${current_price} (均值: ${round(mean, 2)}, std: ${round(std_dev, 2)}, 偏离: {round(deviation_std_devs, 2)}σ)")
            else:
                current_size = window.size()
                status = "窗口数据不足" if current_size > 0 else "初始积累"
                print(f"[{datetime.now().strftime('%H:%M:%S')}] {status}: {symbol} (窗口大小: {current_size}/{MIN_WINDOW_SIZE})")
            
            window.add(current_price, timestamp)
                
    except KeyboardInterrupt:
        print("\n已停止流处理器")
    finally:
        consumer.close()
        producer.close()

if __name__ == '__main__':
    main()
