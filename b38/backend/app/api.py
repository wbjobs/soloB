from flask import Flask, jsonify, request
from flask_cors import CORS
from .database import init_db, get_metrics_by_time_range, insert_metric, get_process_metrics_by_time_range, get_latest_process_metrics
from .monitor import collect_system_metrics, get_current_processes
import threading
import time

app = Flask(__name__)
CORS(app)

def run_monitor():
    from .monitor import start_monitoring
    start_monitoring(5)

@app.route('/api/metrics', methods=['GET'])
def get_metrics():
    hours = request.args.get('hours', default=24, type=int)
    metrics = get_metrics_by_time_range(hours)
    return jsonify({
        'success': True,
        'data': metrics,
        'count': len(metrics)
    })

@app.route('/api/current', methods=['GET'])
def get_current_metrics():
    try:
        metrics = collect_system_metrics()
        return jsonify({
            'success': True,
            'data': metrics
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/processes', methods=['GET'])
def get_processes():
    try:
        sort_by = request.args.get('sort_by', default='cpu', type=str)
        limit = request.args.get('limit', default=10, type=int)
        
        if sort_by not in ['cpu', 'memory']:
            sort_by = 'cpu'
        
        processes = get_current_processes(sort_by=sort_by, limit=limit)
        return jsonify({
            'success': True,
            'data': processes,
            'count': len(processes),
            'sorted_by': sort_by
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/process/metrics', methods=['GET'])
def get_process_metrics():
    try:
        hours = request.args.get('hours', default=24, type=int)
        pid = request.args.get('pid', default=None, type=int)
        name = request.args.get('name', default=None, type=str)
        
        if pid is None and name is None:
            return jsonify({
                'success': False,
                'error': '必须提供 pid 或 name 参数'
            }), 400
        
        metrics = get_process_metrics_by_time_range(hours=hours, pid=pid, name=name)
        return jsonify({
            'success': True,
            'data': metrics,
            'count': len(metrics),
            'pid': pid,
            'name': name
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'timestamp': time.strftime('%Y-%m-%d %H:%M:%S')
    })

def create_app():
    init_db()
    return app

if __name__ == '__main__':
    app = create_app()
    monitor_thread = threading.Thread(target=run_monitor, daemon=True)
    monitor_thread.start()
    app.run(host='127.0.0.1', port=5000, debug=False)
