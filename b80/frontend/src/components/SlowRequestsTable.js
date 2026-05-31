import React from 'react';

const SlowRequestsTable = ({ data }) => {
  const getStatusColor = (statusCode) => {
    if (statusCode >= 200 && statusCode < 300) return '#00ff88';
    if (statusCode >= 400 && statusCode < 500) return '#ffa502';
    if (statusCode >= 500) return '#ff4757';
    return '#888';
  };

  const getLatencyColor = (latency) => {
    if (latency > 5000) return '#ff4757';
    if (latency > 2000) return '#ffa502';
    return '#00ff88';
  };

  return (
    <div style={styles.container}>
      <table style={styles.table}>
        <thead>
          <tr style={styles.headerRow}>
            <th style={styles.headerCell}>PID</th>
            <th style={styles.headerCell}>进程</th>
            <th style={styles.headerCell}>方法</th>
            <th style={styles.headerCell}>URL</th>
            <th style={styles.headerCell}>状态</th>
            <th style={styles.headerCell}>延迟</th>
            <th style={styles.headerCell}>大小</th>
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan="7" style={{ ...styles.cell, textAlign: 'center', color: '#888' }}>
                暂无数据
              </td>
            </tr>
          ) : (
            data.slice(0, 10).map((item, index) => (
              <tr key={index} style={styles.row}>
                <td style={styles.cell}>{item.pid}</td>
                <td style={styles.cell}>{item.comm}</td>
                <td style={styles.cell}>
                  <span style={styles.method}>{item.method}</span>
                </td>
                <td style={{ ...styles.cell, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.url}
                </td>
                <td style={styles.cell}>
                  <span style={{ color: getStatusColor(item.statusCode), fontWeight: 'bold' }}>
                    {item.statusCode}
                  </span>
                </td>
                <td style={styles.cell}>
                  <span style={{ color: getLatencyColor(item.latencyMs), fontWeight: 'bold' }}>
                    {item.latencyMs?.toFixed(0)} ms
                  </span>
                </td>
                <td style={styles.cell}>{(item.bodySize / 1024).toFixed(2)} KB</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

const styles = {
  container: {
    maxHeight: '350px',
    overflowY: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.85rem',
  },
  headerRow: {
    backgroundColor: '#0f3460',
    position: 'sticky',
    top: 0,
  },
  headerCell: {
    padding: '0.75rem 0.5rem',
    textAlign: 'left',
    color: '#00d4ff',
    fontWeight: '600',
    borderBottom: '2px solid #1a1a2e',
  },
  row: {
    borderBottom: '1px solid #0f3460',
    '&:hover': {
      backgroundColor: '#1a1a2e',
    },
  },
  cell: {
    padding: '0.5rem',
    color: '#ccc',
  },
  method: {
    padding: '0.25rem 0.5rem',
    borderRadius: '4px',
    backgroundColor: '#0f3460',
    fontSize: '0.75rem',
    color: '#00d4ff',
  },
};

export default SlowRequestsTable;
