import React, { useState, useEffect } from 'react';

const AlertPanel = ({ alerts = [], onClearAlerts }) => {
  const [expandedId, setExpandedId] = useState(null);

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'CRITICAL': return { bg: '#7f1d1d', border: '#ef4444', text: '#fca5a5' };
      case 'HIGH': return { bg: '#7c2d12', border: '#f97316', text: '#fdba74' };
      case 'MEDIUM': return { bg: '#78350f', border: '#eab308', text: '#fde047' };
      default: return { bg: '#1e3a5f', border: '#3b82f6', text: '#93c5fd' };
    }
  };

  const getSeverityLabel = (severity) => {
    switch (severity) {
      case 'CRITICAL': return '严重';
      case 'HIGH': return '高';
      case 'MEDIUM': return '中';
      default: return severity;
    }
  };

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>
          🚨 异常告警
          <span style={styles.badge}>{alerts.length}</span>
        </h3>
        {alerts.length > 0 && (
          <button style={styles.clearBtn} onClick={onClearAlerts}>
            清空
          </button>
        )}
      </div>

      <div style={styles.alertList}>
        {alerts.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>✅</div>
            <p style={styles.emptyText}>暂无异常告警</p>
            <p style={styles.emptySubtext}>系统正在监控请求延迟...</p>
          </div>
        ) : (
          alerts.map((alert) => {
            const colors = getSeverityColor(alert.severity);
            const isExpanded = expandedId === alert.id;

            return (
              <div
                key={alert.id}
                style={{
                  ...styles.alertCard,
                  backgroundColor: colors.bg,
                  borderLeftColor: colors.border,
                }}
                onClick={() => setExpandedId(isExpanded ? null : alert.id)}
              >
                <div style={styles.alertHeader}>
                  <span style={{ ...styles.severityBadge, backgroundColor: colors.border }}>
                    {getSeverityLabel(alert.severity)}
                  </span>
                  <span style={styles.alertTime}>{formatTime(alert.timestamp)}</span>
                </div>

                <div style={styles.alertSummary}>
                  <span style={styles.method}>{alert.method}</span>
                  <span style={styles.url} title={alert.url}>
                    {alert.url.length > 40 ? alert.url.substring(0, 40) + '...' : alert.url}
                  </span>
                </div>

                <div style={styles.latencyRow}>
                  <span style={{ ...styles.latencyValue, color: colors.text }}>
                    {Math.round(alert.latency)}ms
                  </span>
                  <span style={styles.thresholdLabel}>
                    阈值: {alert.threshold}ms | 基线: {alert.baseline}ms
                  </span>
                </div>

                {isExpanded && (
                  <div style={styles.alertDetails}>
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>进程:</span>
                      <span style={styles.detailValue}>{alert.comm} (PID: {alert.pid})</span>
                    </div>
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>状态码:</span>
                      <span style={styles.detailValue}>{alert.statusCode}</span>
                    </div>
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>P95:</span>
                      <span style={styles.detailValue}>{alert.p95}ms</span>
                    </div>
                  </div>
                )}

                <div style={styles.expandIndicator}>
                  {isExpanded ? '▲ 收起' : '▼ 展开'}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem',
  },
  title: {
    margin: 0,
    color: '#ff6b6b',
    fontSize: '1.1rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  badge: {
    backgroundColor: '#ff6b6b',
    color: '#fff',
    padding: '0.15rem 0.5rem',
    borderRadius: '12px',
    fontSize: '0.8rem',
  },
  clearBtn: {
    backgroundColor: 'transparent',
    border: '1px solid #ff6b6b',
    color: '#ff6b6b',
    padding: '0.3rem 0.8rem',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.8rem',
    transition: 'all 0.2s',
  },
  alertList: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  emptyState: {
    textAlign: 'center',
    padding: '2rem',
    color: '#888',
  },
  emptyIcon: {
    fontSize: '2rem',
    marginBottom: '0.5rem',
  },
  emptyText: {
    margin: '0.5rem 0',
    color: '#00ff88',
  },
  emptySubtext: {
    margin: 0,
    fontSize: '0.85rem',
    color: '#666',
  },
  alertCard: {
    borderRadius: '8px',
    padding: '0.75rem',
    borderLeft: '4px solid',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  alertHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.5rem',
  },
  severityBadge: {
    padding: '0.15rem 0.5rem',
    borderRadius: '4px',
    fontSize: '0.7rem',
    color: '#fff',
    fontWeight: 'bold',
  },
  alertTime: {
    fontSize: '0.75rem',
    color: '#aaa',
  },
  alertSummary: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.5rem',
  },
  method: {
    backgroundColor: 'rgba(0, 212, 255, 0.2)',
    color: '#00d4ff',
    padding: '0.15rem 0.4rem',
    borderRadius: '4px',
    fontSize: '0.7rem',
    fontWeight: 'bold',
  },
  url: {
    color: '#eee',
    fontSize: '0.85rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  latencyRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '0.75rem',
  },
  latencyValue: {
    fontSize: '1.2rem',
    fontWeight: 'bold',
  },
  thresholdLabel: {
    fontSize: '0.75rem',
    color: '#888',
  },
  alertDetails: {
    marginTop: '0.75rem',
    paddingTop: '0.75rem',
    borderTop: '1px solid rgba(255,255,255,0.1)',
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '0.3rem',
    fontSize: '0.8rem',
  },
  detailLabel: {
    color: '#888',
  },
  detailValue: {
    color: '#ddd',
  },
  expandIndicator: {
    textAlign: 'center',
    fontSize: '0.7rem',
    color: '#666',
    marginTop: '0.5rem',
  },
};

export default AlertPanel;
