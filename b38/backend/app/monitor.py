import psutil
import time
from datetime import datetime, timedelta
from .database import insert_metric, insert_process_metrics

def collect_system_metrics():
    cpu_usage = psutil.cpu_percent(interval=1)
    
    memory = psutil.virtual_memory()
    memory_usage = memory.percent
    memory_available = memory.available
    memory_total = memory.total
    
    network = psutil.net_io_counters()
    network_bytes_sent = network.bytes_sent
    network_bytes_recv = network.bytes_recv
    
    return {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'cpu_usage': cpu_usage,
        'memory_usage': memory_usage,
        'memory_available': memory_available,
        'memory_total': memory_total,
        'network_bytes_sent': network_bytes_sent,
        'network_bytes_recv': network_bytes_recv
    }

def collect_process_metrics(limit=20):
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    process_list = []
    
    for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_info', 'memory_percent']):
        try:
            process_info = proc.info
            if process_info['cpu_percent'] is None:
                process_info['cpu_percent'] = 0.0
            if process_info['memory_percent'] is None:
                process_info['memory_percent'] = 0.0
            
            memory_rss = process_info.get('memory_info', {}).rss if process_info.get('memory_info') else 0
            
            process_list.append({
                'timestamp': timestamp,
                'pid': process_info['pid'],
                'name': process_info['name'],
                'cpu_percent': process_info['cpu_percent'],
                'memory_percent': process_info['memory_percent'],
                'memory_rss': memory_rss
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
    
    process_list.sort(key=lambda x: x['cpu_percent'], reverse=True)
    return process_list[:limit]

def get_current_processes(sort_by='cpu', limit=10):
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    process_list = []
    
    for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_info', 'memory_percent']):
        try:
            proc.cpu_percent(interval=None)
            process_info = proc.info
            if process_info['cpu_percent'] is None:
                process_info['cpu_percent'] = 0.0
            if process_info['memory_percent'] is None:
                process_info['memory_percent'] = 0.0
            
            memory_rss = process_info.get('memory_info', {}).rss if process_info.get('memory_info') else 0
            
            process_list.append({
                'timestamp': timestamp,
                'pid': process_info['pid'],
                'name': process_info['name'],
                'cpu_percent': round(process_info['cpu_percent'], 2),
                'memory_percent': round(process_info['memory_percent'], 2),
                'memory_rss': memory_rss
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
    
    key = 'cpu_percent' if sort_by == 'cpu' else 'memory_percent'
    process_list.sort(key=lambda x: x[key], reverse=True)
    return process_list[:limit]

def start_monitoring(interval=5):
    print(f"开始监控系统资源，每 {interval} 秒采集一次...")
    
    last_iteration_time = time.time()
    max_time_jump = interval * 3
    
    while True:
        try:
            current_time = time.time()
            time_diff = current_time - last_iteration_time
            
            if time_diff > max_time_jump:
                sleep_duration = time_diff - interval
                print(f"检测到系统休眠唤醒，时间跳跃约 {sleep_duration:.1f} 秒，跳过休眠期间的数据采集")
            
            metrics = collect_system_metrics()
            insert_metric(metrics)
            
            process_metrics = collect_process_metrics(limit=30)
            insert_process_metrics(process_metrics)
            
            print(f"[{metrics['timestamp']}] CPU: {metrics['cpu_usage']}%, 内存: {metrics['memory_usage']}%, 进程: {len(process_metrics)}个")
            
            last_iteration_time = time.time()
            time.sleep(interval)
            
        except KeyboardInterrupt:
            print("\n监控已停止")
            break
        except Exception as e:
            print(f"监控错误: {e}")
            last_iteration_time = time.time()
            time.sleep(interval)
