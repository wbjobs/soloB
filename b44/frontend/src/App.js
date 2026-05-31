import React, { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell
} from 'recharts';
import axios from 'axios';

const COLORS = [
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#ef4444'
];

const SYSCALL_TYPES = [
  { key: 'open', label: 'open' },
  { key: 'openat', label: 'openat' },
  { key: 'read', label: 'read' },
  { key: 'write', label: 'write' },
  { key: 'connect', label: 'connect' },
  { key: 'close', label: 'close' }
];

const TIME_RANGES = [
  { value: 1, label: '1 minute' },
  { value: 5, label: '5 minutes' },
  { value: 10, label: '10 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' }
];

const getSyscallClass = (syscall) => {
  const className = `syscall-${syscall}`;
  return className;
};

const formatTimestamp = (ms) => {
  if (!ms) return '-';
  const date = new Date(ms);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
};

const formatDuration = (ns) => {
  if (!ns || ns < 0) return '-';
  if (ns < 1000) return `${ns} ns`;
  if (ns < 1000000) return `${(ns / 1000).toFixed(2)} μs`;
  return `${(ns / 1000000).toFixed(2)} ms`;
};

function App() {
  const [timelineData, setTimelineData] = useState([]);
  const [bySyscallData, setBySyscallData] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [selectedProcess, setSelectedProcess] = useState('');
  const [timeRange, setTimeRange] = useState(5);
  const [selectedSyscalls, setSelectedSyscalls] = useState(
    SYSCALL_TYPES.reduce((acc, syscall) => ({ ...acc, [syscall.key]: true }), {})
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [healthStatus, setHealthStatus] = useState(null);
  
  const [selectedTimePoint, setSelectedTimePoint] = useState(null);
  const [detailData, setDetailData] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    checkHealth();
    loadProcesses();
    const interval = setInterval(() => {
      checkHealth();
      loadProcesses();
    }, 30000);
    
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedProcess) {
      loadData();
      const interval = setInterval(loadData, 5000);
      return () => clearInterval(interval);
    }
  }, [selectedProcess, timeRange, selectedSyscalls]);

  const checkHealth = async () => {
    try {
      const response = await axios.get('/api/health');
      setHealthStatus(response.data);
    } catch (err) {
      console.error('Health check failed:', err);
      setHealthStatus(null);
    }
  };

  const loadProcesses = async () => {
    try {
      const response = await axios.get('/api/processes');
      if (response.data.success) {
        setProcesses(response.data.data);
      }
    } catch (err) {
      console.error('Failed to load processes:', err);
    }
  };

  const loadData = async () => {
    if (!selectedProcess) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const selectedSyscallList = Object.keys(selectedSyscalls).filter(
        syscall => selectedSyscalls[syscall]
      );
      
      const timelineParams = {
        tgid: selectedProcess,
        last_minutes: timeRange,
        interval: 1000
      };
      
      if (selectedSyscallList.length > 0 && selectedSyscallList.length < SYSCALL_TYPES.length) {
        timelineParams.syscall = selectedSyscallList;
      }
      
      const [timelineResponse, bySyscallResponse] = await Promise.all([
        axios.get('/api/syscalls/timeline', { params: timelineParams }),
        axios.get('/api/syscalls/by-syscall', {
          params: { tgid: selectedProcess, last_minutes: timeRange }
        })
      ]);
      
      if (timelineResponse.data.success) {
        const transformedData = timelineResponse.data.data.map(item => {
          const transformed = {
            time: formatTimestamp(item.timestamp),
            timestamp: item.timestamp
          };
          
          SYSCALL_TYPES.forEach(syscall => {
            transformed[syscall.key] = item[syscall.key] || 0;
          });
          
          return transformed;
        });
        setTimelineData(transformedData);
      }
      
      if (bySyscallResponse.data.success) {
        setBySyscallData(bySyscallResponse.data.data);
      }
      
    } catch (err) {
      console.error('Failed to load data:', err);
      setError('Failed to load data. Please check if the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const loadDetailData = async (timestamp, syscalls = null) => {
    if (!selectedProcess || !timestamp) return;
    
    setDetailLoading(true);
    setDetailError(null);
    
    try {
      const params = {
        tgid: selectedProcess,
        timestamp: timestamp,
        tolerance: 1000
      };
      
      const response = await axios.get('/api/syscalls/detail', { params });
      
      if (response.data.success) {
        let data = response.data.data;
        
        if (syscalls && syscalls.length > 0) {
          data = data.filter(item => syscalls.includes(item.syscall));
        }
        
        setDetailData(data);
      } else {
        setDetailError(response.data.error || 'Failed to load detail data');
      }
    } catch (err) {
      console.error('Failed to load detail data:', err);
      setDetailError('Failed to load detail data. Please try again.');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleChartClick = (data) => {
    if (!data || !data.activePayload || data.activePayload.length === 0) return;
    
    const clickedData = data.activePayload[0].payload;
    if (!clickedData || !clickedData.timestamp) return;
    
    const selectedSyscallList = Object.keys(selectedSyscalls).filter(
      syscall => selectedSyscalls[syscall]
    );
    
    setSelectedTimePoint({
      timestamp: clickedData.timestamp,
      time: clickedData.time
    });
    
    setShowDetail(true);
    loadDetailData(clickedData.timestamp, selectedSyscallList);
  };

  const closeDetail = () => {
    setShowDetail(false);
    setSelectedTimePoint(null);
    setDetailData([]);
  };

  const formatTimestamp = (ms) => {
    if (!ms) return '';
    const date = new Date(ms);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const toggleSyscall = (syscallKey) => {
    setSelectedSyscalls(prev => ({
      ...prev,
      [syscallKey]: !prev[syscallKey]
    }));
  };

  const totalCalls = bySyscallData.reduce((sum, item) => sum + item.count, 0);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{
          backgroundColor: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '8px',
          padding: '12px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)'
        }}>
          <p style={{ marginBottom: '8px', color: '#f1f5f9', fontWeight: 'bold' }}>
            {label}
          </p>
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color, margin: '4px 0' }}>
              {entry.name}: {entry.value}
            </p>
          ))}
          <p style={{ marginTop: '10px', fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic' }}>
            Click to view details
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>🖥️  Syscall Monitor</h1>
        <p>Real-time system call monitoring and visualization</p>
        {healthStatus && (
          <div style={{ marginTop: '15px' }}>
            <span className={`status-badge ${healthStatus.elasticsearch.connected ? 'connected' : 'disconnected'}`}>
              {healthStatus.elasticsearch.connected ? 'Backend Connected' : 'Backend Disconnected'}
            </span>
          </div>
        )}
      </header>

      <div className="controls">
        <div className="control-group">
          <label>Target Process (PID)</label>
          <select
            value={selectedProcess}
            onChange={(e) => setSelectedProcess(e.target.value)}
          >
            <option value="">Select a process...</option>
            {processes.map(process => (
              <option key={process.tgid} value={process.tgid}>
                PID {process.tgid}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label>Time Range</label>
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(parseInt(e.target.value))}
          >
            {TIME_RANGES.map(range => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label>System Calls</label>
          <div className="syscall-filters">
            {SYSCALL_TYPES.map((syscall, index) => (
              <label key={syscall.key} className="syscall-filter">
                <input
                  type="checkbox"
                  checked={selectedSyscalls[syscall.key]}
                  onChange={() => toggleSyscall(syscall.key)}
                />
                <span style={{ color: COLORS[index % COLORS.length] }}>
                  {syscall.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="error-message">
          <span>⚠️</span>
          {error}
        </div>
      )}

      {!selectedProcess ? (
        <div className="info-text">
          <p>👆 Please select a process from the dropdown above to start monitoring.</p>
          <p style={{ marginTop: '10px', fontSize: '0.95rem' }}>
            If no processes are shown, ensure the collector is running and sending data.
          </p>
        </div>
      ) : loading && timelineData.length === 0 ? (
        <div className="loading">Loading data</div>
      ) : (
        <div className="charts-container">
          {totalCalls > 0 && (
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value">{totalCalls.toLocaleString()}</div>
                <div className="stat-label">Total System Calls</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{bySyscallData.length}</div>
                <div className="stat-label">Unique Syscall Types</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">
                  {Math.round(totalCalls / (timeRange * 60))}
                </div>
                <div className="stat-label">Avg Calls per Second</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">
                  {bySyscallData.length > 0 ? bySyscallData[0].syscall : '-'}
                </div>
                <div className="stat-label">Most Frequent Syscall</div>
              </div>
            </div>
          )}

          <div className="chart-section">
            <h2>System Call Frequency Over Time</h2>
            {timelineData.length > 0 ? (
              <>
                <div className="chart-click-hint">
                  Click on any data point to view detailed system calls
                </div>
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart 
                    data={timelineData}
                    onClick={handleChartClick}
                    style={{ cursor: 'pointer' }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis
                      dataKey="time"
                      stroke="#94a3b8"
                      tick={{ fill: '#94a3b8' }}
                    />
                    <YAxis
                      stroke="#94a3b8"
                      tick={{ fill: '#94a3b8' }}
                      label={{ value: 'Count', angle: -90, position: 'insideLeft', fill: '#94a3b8' }}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ color: '#e2e8f0' }} />
                    {SYSCALL_TYPES.map((syscall, index) => (
                      selectedSyscalls[syscall.key] && (
                        <Line
                          key={syscall.key}
                          type="monotone"
                          dataKey={syscall.key}
                          stroke={COLORS[index % COLORS.length]}
                          strokeWidth={2}
                          dot={{ r: 4, cursor: 'pointer' }}
                          activeDot={{ r: 6, cursor: 'pointer' }}
                        />
                      )
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </>
            ) : (
              <div className="info-text">
                No data available yet. Make sure the process is active and making system calls.
              </div>
            )}
          </div>

          {showDetail && (
            <div className="detail-section">
              <div className="detail-header">
                <h3>System Call Details - {selectedTimePoint?.time}</h3>
                <button 
                  className="close-detail-btn"
                  onClick={closeDetail}
                >
                  ✕ Close
                </button>
              </div>
              
              <div className="detail-info">
                <div className="detail-info-item">
                  <span className="detail-info-label">Timestamp:</span>
                  <span className="detail-info-value">{selectedTimePoint?.time}</span>
                </div>
                <div className="detail-info-item">
                  <span className="detail-info-label">PID:</span>
                  <span className="detail-info-value">{selectedProcess}</span>
                </div>
                <div className="detail-info-item">
                  <span className="detail-info-label">Events Found:</span>
                  <span className="detail-info-value">{detailData.length}</span>
                </div>
              </div>

              {detailLoading ? (
                <div className="loading">Loading detailed data...</div>
              ) : detailError ? (
                <div className="error-message">
                  <span>⚠️</span>
                  {detailError}
                </div>
              ) : detailData.length === 0 ? (
                <div className="info-text">
                  <p>No detailed data available for this time point.</p>
                  <p style={{ marginTop: '10px', fontSize: '0.85rem' }}>
                    Make sure the detail sink job is running and storing raw events.
                  </p>
                </div>
              ) : (
                <div className="detail-table-container">
                  <table className="detail-table">
                    <thead>
                      <tr>
                        <th style={{ width: '120px' }}>Time</th>
                        <th style={{ width: '100px' }}>Syscall</th>
                        <th>Arguments</th>
                        <th style={{ width: '100px' }}>Return</th>
                        <th style={{ width: '120px' }}>Duration</th>
                        <th style={{ width: '80px' }}>CPU</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailData.map((item, index) => (
                        <tr key={item.id || index}>
                          <td className="timestamp-cell">
                            {formatTimestamp(item.timestamp_ms)}
                          </td>
                          <td>
                            <span className={`syscall-badge ${getSyscallClass(item.syscall)}`}>
                              {item.syscall}
                            </span>
                          </td>
                          <td className="args-cell" title={`${item.arg1} ${item.arg2} ${item.arg3}`.trim()}>
                            {[item.arg1, item.arg2, item.arg3].filter(Boolean).join(', ') || '-'}
                          </td>
                          <td>
                            <span className={item.success ? 'ret-success' : 'ret-error'}>
                              {item.ret}
                            </span>
                          </td>
                          <td>
                            {formatDuration(item.duration_ns)}
                          </td>
                          <td>
                            {item.cpu !== undefined ? `CPU ${item.cpu}` : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="chart-section">
            <h2>System Calls by Type</h2>
            {bySyscallData.length > 0 ? (
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={bySyscallData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="syscall"
                    stroke="#94a3b8"
                    tick={{ fill: '#94a3b8' }}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    tick={{ fill: '#94a3b8' }}
                    label={{ value: 'Count', angle: -90, position: 'insideLeft', fill: '#94a3b8' }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {bySyscallData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="info-text">
                No data available yet.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
