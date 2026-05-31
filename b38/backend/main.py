from app.api import create_app
from app.monitor import start_monitoring
import threading

if __name__ == '__main__':
    app = create_app()
    monitor_thread = threading.Thread(target=start_monitoring, args=(5,), daemon=True)
    monitor_thread.start()
    app.run(host='127.0.0.1', port=5000, debug=False)
