import React from 'react';

function UpgradeLog({ logs }) {
  return (
    <div className="card">
      <h2>升级日志</h2>
      
      <div className="logs-container">
        {logs.length === 0 ? (
          <div className="empty-state">暂无升级日志</div>
        ) : (
          logs.slice().reverse().map((log, index) => (
            <div key={index} className={`log-entry ${log.type}`}>
              <div className="log-time">
                {new Date(log.timestamp).toLocaleString('zh-CN')}
              </div>
              <div className="log-message">
                {log.version && <strong>[{log.version}]</strong>} {log.message}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default UpgradeLog;
