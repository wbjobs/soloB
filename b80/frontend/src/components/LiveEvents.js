import React from 'react';

const LiveEvents = ({ events }) => {
  const getStatusColor = (statusCode) => {
    if (statusCode >= 200 && statusCode < 300) return '#00ff88';
    if (statusCode >= 400 && statusCode < 500) return '#ffa502';
    if (statusCode >= 500) return '#ff4757';
    return '#888';
  };

  const getMethodColor = (method) => {
    const colors = {
      GET: '#00d4ff',
      POST: '#00ff88',
      PUT: '#ffa502',
      DELETE: '#ff4757',
      PATCH: '#a55eea',
    };
    return colors[method] || '#888';
  };

  return (
    <div style={styles.container}>
      {events.length === 0 ? (
        <div style={styles.empty}>等待事件...</div>
      ) : (
        events.map((event, index) => (
          <div key={index} style={styles.eventCard}>
            <div style={styles.eventHeader}>
              <span style={{ ...styles.method, backgroundColor: getMethodColor(event.method) + '20', color: getMethodColor(event.method) }}>
                {event.method}
              </span>
              <span style={{ ...styles.status, color: getStatusColor(event.statusCode) }}>
                {event.statusCode}
              </span>
            </div>
            <div style={styles.url} title={event.url}>
              {event.url}
            </div>
            <div style={styles.eventFooter}>
              <span style={styles.pid}>PID: {event.pid}</span>
              <span style={styles.comm}>{event.comm}</span>
              <span style={styles.latency}>{event.latencyMs?.toFixed(0)} ms</span>
              <span style={styles.size}>{(event.bodySize / 1024).toFixed(2)} KB</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

const styles = {
  container: {
    maxHeight: '400px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  empty: {
    textAlign: 'center',
    color: '#888',
    padding: '2rem',
  },
  eventCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: '6px',
    padding: '0.75rem',
    border: '1px solid #0f3460',
    animation: 'fadeIn 0.3s ease-in',
  },
  eventHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.5rem',
  },
  method: {
    padding: '0.25rem 0.5rem',
    borderRadius: '4px',
    fontSize: '0.75rem',
    fontWeight: 'bold',
  },
  status: {
    fontWeight: 'bold',
    fontSize: '0.9rem',
  },
  url: {
    fontSize: '0.85rem',
    color: '#ccc',
    marginBottom: '0.5rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  eventFooter: {
    display: 'flex',
    gap: '1rem',
    fontSize: '0.75rem',
    color: '#888',
  },
  pid: {},
  comm: {},
  latency: {
    color: '#00ff88',
  },
  size: {},
};

export default LiveEvents;
