import os
import sys
import redis
from rq import Queue, Worker
from datetime import datetime

project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)
sys.path.insert(0, os.path.join(project_root, 'python'))


def get_redis_connection():
    redis_url = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
    return redis.from_url(redis_url)


def process_fit_task(x, y, func_expression, initial_params=None):
    try:
        from python.lm_wrapper import fit_curve_wrapper
        
        result = fit_curve_wrapper(x, y, func_expression, initial_params)
        
        return {
            "status": "completed",
            "timestamp": datetime.utcnow().isoformat(),
            **result
        }
    except ImportError as e:
        return {
            "status": "failed",
            "timestamp": datetime.utcnow().isoformat(),
            "success": False,
            "params": [],
            "chi_squared": 0.0,
            "iterations": 0,
            "error_message": f"Failed to import fitting module: {e}"
        }
    except Exception as e:
        return {
            "status": "failed",
            "timestamp": datetime.utcnow().isoformat(),
            "success": False,
            "params": [],
            "chi_squared": 0.0,
            "iterations": 0,
            "error_message": str(e)
        }


def create_queue():
    redis_conn = get_redis_connection()
    return Queue('fit_tasks', connection=redis_conn)


def start_worker():
    redis_conn = get_redis_connection()
    worker = Worker(['fit_tasks'], connection=redis_conn)
    print("Worker started. Waiting for tasks...")
    worker.work()


if __name__ == '__main__':
    start_worker()
