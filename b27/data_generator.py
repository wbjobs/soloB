import json
import random
import time
from datetime import datetime
from kafka import KafkaProducer

STOCKS = [
    {'symbol': 'AAPL', 'base_price': 150.0, 'volatility': 0.02},
    {'symbol': 'GOOGL', 'base_price': 2800.0, 'volatility': 0.015},
    {'symbol': 'MSFT', 'base_price': 300.0, 'volatility': 0.018},
    {'symbol': 'AMZN', 'base_price': 3300.0, 'volatility': 0.025},
    {'symbol': 'TSLA', 'base_price': 750.0, 'volatility': 0.035}
]

KAFKA_BROKER = 'localhost:9092'
TOPIC = 'stock-prices'

def create_producer():
    return KafkaProducer(
        bootstrap_servers=KAFKA_BROKER,
        value_serializer=lambda v: json.dumps(v).encode('utf-8'),
        key_serializer=lambda k: k.encode('utf-8') if k else None
    )

def generate_price_change(base_price, volatility):
    change_percent = random.gauss(0, volatility)
    new_price = base_price * (1 + change_percent)
    return max(new_price, 0.01)

def generate_anomaly(current_price, volatility):
    if random.random() < 0.02:
        anomaly_factor = random.choice([0.7, 1.4])
        return current_price * anomaly_factor
    return generate_price_change(current_price, volatility)

def main():
    producer = create_producer()
    print(f"连接到 Kafka 代理: {KAFKA_BROKER}")
    print(f"开始发布数据到主题: {TOPIC}")
    
    current_prices = {stock['symbol']: stock['base_price'] for stock in STOCKS}
    
    try:
        message_count = 0
        while True:
            for stock in STOCKS:
                symbol = stock['symbol']
                volatility = stock['volatility']
                current_price = current_prices[symbol]
                
                if random.random() < 0.05:
                    new_price = generate_anomaly(current_price, volatility)
                else:
                    new_price = generate_price_change(current_price, volatility)
                
                current_prices[symbol] = new_price
                
                message = {
                    'symbol': symbol,
                    'price': round(new_price, 2),
                    'timestamp': datetime.utcnow().isoformat()
                }
                
                producer.send(TOPIC, key=symbol, value=message)
                message_count += 1
                
                print(f"[{datetime.now().strftime('%H:%M:%S')}] 发送: {symbol} ${message['price']}")
            
            producer.flush()
            time.sleep(1)
            
    except KeyboardInterrupt:
        print(f"\n已停止。共发送 {message_count} 条消息")
    finally:
        producer.close()

if __name__ == '__main__':
    main()
