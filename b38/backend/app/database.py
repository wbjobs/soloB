import sqlite3
import os
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'system_metrics.db')

def get_db_connection():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME NOT NULL,
            cpu_usage REAL NOT NULL,
            memory_usage REAL NOT NULL,
            memory_available REAL NOT NULL,
            memory_total REAL NOT NULL,
            network_bytes_sent INTEGER NOT NULL,
            network_bytes_recv INTEGER NOT NULL
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_timestamp ON metrics(timestamp)')
    
    conn.execute('''
        CREATE TABLE IF NOT EXISTS process_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME NOT NULL,
            pid INTEGER NOT NULL,
            name TEXT NOT NULL,
            cpu_percent REAL NOT NULL,
            memory_percent REAL NOT NULL,
            memory_rss INTEGER NOT NULL
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_process_timestamp ON process_metrics(timestamp)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_process_pid ON process_metrics(pid)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_process_name ON process_metrics(name)')
    
    conn.commit()
    conn.close()

def insert_metric(metric_data):
    conn = get_db_connection()
    conn.execute('''
        INSERT INTO metrics (timestamp, cpu_usage, memory_usage, memory_available, memory_total, network_bytes_sent, network_bytes_recv)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (
        metric_data['timestamp'],
        metric_data['cpu_usage'],
        metric_data['memory_usage'],
        metric_data['memory_available'],
        metric_data['memory_total'],
        metric_data['network_bytes_sent'],
        metric_data['network_bytes_recv']
    ))
    conn.commit()
    conn.close()

def get_metrics_by_time_range(hours):
    conn = get_db_connection()
    start_time = datetime.now() - timedelta(hours=hours)
    cursor = conn.execute('''
        SELECT * FROM metrics 
        WHERE timestamp >= ? 
        ORDER BY timestamp ASC
    ''', (start_time.strftime('%Y-%m-%d %H:%M:%S'),))
    rows = cursor.fetchall()
    conn.close()
    
    metrics = []
    for row in rows:
        metrics.append({
            'timestamp': row['timestamp'],
            'cpu_usage': row['cpu_usage'],
            'memory_usage': row['memory_usage'],
            'memory_available': row['memory_available'],
            'memory_total': row['memory_total'],
            'network_bytes_sent': row['network_bytes_sent'],
            'network_bytes_recv': row['network_bytes_recv']
        })
    
    return metrics

def insert_process_metrics(process_data_list):
    if not process_data_list:
        return
    
    conn = get_db_connection()
    for process_data in process_data_list:
        conn.execute('''
            INSERT INTO process_metrics (timestamp, pid, name, cpu_percent, memory_percent, memory_rss)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (
            process_data['timestamp'],
            process_data['pid'],
            process_data['name'],
            process_data['cpu_percent'],
            process_data['memory_percent'],
            process_data['memory_rss']
        ))
    conn.commit()
    conn.close()

def get_process_metrics_by_time_range(hours, pid=None, name=None):
    conn = get_db_connection()
    start_time = datetime.now() - timedelta(hours=hours)
    
    query = '''
        SELECT * FROM process_metrics 
        WHERE timestamp >= ?
    '''
    params = [start_time.strftime('%Y-%m-%d %H:%M:%S')]
    
    if pid is not None:
        query += ' AND pid = ?'
        params.append(pid)
    
    if name is not None:
        query += ' AND name = ?'
        params.append(name)
    
    query += ' ORDER BY timestamp ASC'
    
    cursor = conn.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    
    metrics = []
    for row in rows:
        metrics.append({
            'timestamp': row['timestamp'],
            'pid': row['pid'],
            'name': row['name'],
            'cpu_percent': row['cpu_percent'],
            'memory_percent': row['memory_percent'],
            'memory_rss': row['memory_rss']
        })
    
    return metrics

def get_latest_process_metrics(limit=20, sort_by='cpu'):
    conn = get_db_connection()
    
    latest_timestamp = conn.execute('SELECT MAX(timestamp) as max_ts FROM process_metrics').fetchone()
    if not latest_timestamp or not latest_timestamp['max_ts']:
        conn.close()
        return []
    
    sort_field = 'cpu_percent DESC' if sort_by == 'cpu' else 'memory_percent DESC'
    
    cursor = conn.execute(f'''
        SELECT * FROM process_metrics 
        WHERE timestamp = ?
        ORDER BY {sort_field}
        LIMIT ?
    ''', (latest_timestamp['max_ts'], limit))
    rows = cursor.fetchall()
    conn.close()
    
    processes = []
    for row in rows:
        processes.append({
            'timestamp': row['timestamp'],
            'pid': row['pid'],
            'name': row['name'],
            'cpu_percent': row['cpu_percent'],
            'memory_percent': row['memory_percent'],
            'memory_rss': row['memory_rss']
        })
    
    return processes
