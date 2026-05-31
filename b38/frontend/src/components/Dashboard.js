import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import axios from 'axios';
import './Dashboard.css';

const API_BASE_URL = 'http://127.0.0.1:5000/api';

function Dashboard({ timeRange }) {
  const [metrics, setMetrics] = useState([]);
  const [currentMetrics, setCurrentMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isWakingUp, setIsWakingUp] = useState(false);
  
  const [processes, setProcesses] = useState([]);
  const [processSortBy, setProcessSortBy] = useState('cpu');
  const [selectedProcess, setSelectedProcess] = useState(null);
  const [selectedProcessMetrics, setSelectedProcessMetrics] = useState([]);
  const [processLoading, setProcessLoading] = useState(false);
  
  const lastActiveTimeRef = useRef(Date.now());
  const historyRefreshIntervalRef = useRef(null);
  const processRefreshIntervalRef = useRef(null);

  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE_URL}/metrics?hours=${timeRange}`);
      if (response.data.success) {
        setMetrics(response.data.data);
      }
      setError(null);
    } catch (err) {
      setError('无法连接到后端服务器，请确保 Python 后端正在运行。');
      console.error('Error fetching metrics:', err);
    } finally {
      setLoading(false);
      setIsWakingUp(false);
    }
  }, [timeRange]);

  const fetchCurrentMetrics = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/current`);
      if (response.data.success) {
        setCurrentMetrics(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching current metrics:', err);
    }
  };

  const fetchProcesses = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/processes?sort_by=${processSortBy}&limit=10`);
      if (response.data.success) {
        setProcesses(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching processes:', err);
    }
  };

  const fetchSelectedProcessMetrics = useCallback(async () => {
    if (!selectedProcess) {
      setSelectedProcessMetrics([]);
      return;
    }
    
    try {
      setProcessLoading(true);
      const response = await axios.get(
        `${API_BASE_URL}/process/metrics?hours=${timeRange}&pid=${selectedProcess.pid}&name=${encodeURIComponent(selectedProcess.name)}`
      );
      if (response.data.success) {
        setSelectedProcessMetrics(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching process metrics:', err);
    } finally {
      setProcessLoading(false);
    }
  }, [selectedProcess, timeRange]);

  const handleProcessSelect = (process) => {
    if (selectedProcess && selectedProcess.pid === process.pid && selectedProcess.name === process.name) {
      setSelectedProcess(null);
    } else {
      setSelectedProcess(process);
    }
  };

  const handleProcessSortChange = (sortBy) => {
    setProcessSortBy(sortBy);
  };

  const checkForWakeUp = useCallback(() => {
    const now = Date.now();
    const timeDiff = now - lastActiveTimeRef.current;
    const maxAllowedGap = 30000;
    
    if (timeDiff > maxAllowedGap) {
      console.log(`检测到系统唤醒，时间跳跃 ${(timeDiff / 1000).toFixed(1)} 秒`);
      setIsWakingUp(true);
      fetchMetrics();
      fetchProcesses();
    }
    
    lastActiveTimeRef.current = now;
  }, [fetchMetrics]);

  useEffect(() => {
    fetchMetrics();
    fetchProcesses();
    
    const visibilityHandler = () => {
      if (!document.hidden) {
        checkForWakeUp();
      }
    };
    
    document.addEventListener('visibilitychange', visibilityHandler);
    
    return () => {
      document.removeEventListener('visibilitychange', visibilityHandler);
    };
  }, [timeRange, fetchMetrics, checkForWakeUp]);

  useEffect(() => {
    fetchProcesses();
  }, [processSortBy]);

  useEffect(() => {
    fetchSelectedProcessMetrics();
  }, [fetchSelectedProcessMetrics]);

  useEffect(() => {
    fetchCurrentMetrics();
    fetchProcesses();
    
    const currentInterval = setInterval(fetchCurrentMetrics, 5000);
    const processInterval = setInterval(fetchProcesses, 5000);
    
    historyRefreshIntervalRef.current = setInterval(() => {
      checkForWakeUp();
      fetchMetrics();
    }, 60000);
    
    processRefreshIntervalRef.current = setInterval(() => {
      if (selectedProcess) {
        fetchSelectedProcessMetrics();
      }
    }, 30000);
    
    return () => {
      clearInterval(currentInterval);
      clearInterval(processInterval);
      if (historyRefreshIntervalRef.current) {
        clearInterval(historyRefreshIntervalRef.current);
      }
      if (processRefreshIntervalRef.current) {
        clearInterval(processRefreshIntervalRef.current);
      }
    };
  }, [fetchMetrics, checkForWakeUp, selectedProcess, fetchSelectedProcessMetrics]);

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (loading && metrics.length === 0) {
    return (
      <div className="dashboard loading">
        <div className="loading-spinner"></div>
        <p>正在加载数据...</p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      {isWakingUp && (
        <div className="wake-up-message">
          <p>系统已从休眠中唤醒，正在刷新数据...</p>
        </div>
      )}
      
      {error && (
        <div className="error-message">
          <p>{error}</p>
          <button onClick={fetchMetrics}>重试</button>
        </div>
      )}

      <div className="dashboard-actions">
        <button className="refresh-btn" onClick={fetchMetrics} disabled={loading}>
          {loading ? '刷新中...' : '刷新数据'}
        </button>
      </div>

      {currentMetrics && (
        <div className="current-stats">
          <div className="stat-card">
            <h3>当前 CPU 使用率</h3>
            <p className="stat-value cpu">{currentMetrics.cpu_usage}%</p>
          </div>
          <div className="stat-card">
            <h3>当前内存使用率</h3>
            <p className="stat-value memory">{currentMetrics.memory_usage}%</p>
          </div>
          <div className="stat-card">
            <h3>总内存</h3>
            <p className="stat-value">{formatBytes(currentMetrics.memory_total)}</p>
          </div>
          <div className="stat-card">
            <h3>可用内存</h3>
            <p className="stat-value">{formatBytes(currentMetrics.memory_available)}</p>
          </div>
        </div>
      )}

      <div className="charts-container">
        <div className="chart-card">
          <h2>CPU 使用趋势</h2>
          {metrics.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={metrics} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="timestamp" 
                  tick={{ fontSize: 12 }}
                  interval="preserveStartEnd"
                />
                <YAxis 
                  domain={[0, 100]}
                  tick={{ fontSize: 12 }}
                  label={{ value: '使用率 (%)', angle: -90, position: 'insideLeft' }}
                />
                <Tooltip 
                  labelFormatter={(label) => `时间: ${label}`}
                  formatter={(value) => [`${value}%`, 'CPU 使用率']}
                />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="cpu_usage" 
                  stroke="#8884d8" 
                  name="CPU 使用率"
                  dot={false}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="no-data">
              <p>暂无数据，请等待系统采集数据。</p>
            </div>
          )}
        </div>

        <div className="chart-card">
          <h2>内存使用趋势</h2>
          {metrics.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={metrics} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="timestamp" 
                  tick={{ fontSize: 12 }}
                  interval="preserveStartEnd"
                />
                <YAxis 
                  domain={[0, 100]}
                  tick={{ fontSize: 12 }}
                  label={{ value: '使用率 (%)', angle: -90, position: 'insideLeft' }}
                />
                <Tooltip 
                  labelFormatter={(label) => `时间: ${label}`}
                  formatter={(value) => [`${value}%`, '内存使用率']}
                />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="memory_usage" 
                  stroke="#82ca9d" 
                  name="内存使用率"
                  dot={false}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="no-data">
              <p>暂无数据，请等待系统采集数据。</p>
            </div>
          )}
        </div>
      </div>

      <div className="process-section">
        <div className="process-table-card chart-card">
          <div className="process-header">
            <h2>进程资源监控 (Top 10)</h2>
            <div className="process-sort-buttons">
              <button 
                className={`sort-btn ${processSortBy === 'cpu' ? 'active' : ''}`}
                onClick={() => handleProcessSortChange('cpu')}
              >
                按 CPU 排序
              </button>
              <button 
                className={`sort-btn ${processSortBy === 'memory' ? 'active' : ''}`}
                onClick={() => handleProcessSortChange('memory')}
              >
                按内存排序
              </button>
            </div>
          </div>
          
          {processes.length > 0 ? (
            <div className="process-table-container">
              <table className="process-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>进程名称</th>
                    <th>PID</th>
                    <th>CPU 使用率</th>
                    <th>内存使用率</th>
                    <th>内存占用</th>
                  </tr>
                </thead>
                <tbody>
                  {processes.map((process, index) => (
                    <tr 
                      key={`${process.pid}-${process.name}`}
                      className={`process-row ${
                        selectedProcess && 
                        selectedProcess.pid === process.pid && 
                        selectedProcess.name === process.name 
                          ? 'selected' 
                          : ''
                      }`}
                      onClick={() => handleProcessSelect(process)}
                    >
                      <td>{index + 1}</td>
                      <td className="process-name">{process.name}</td>
                      <td>{process.pid}</td>
                      <td>
                        <span className={`metric-value cpu-value ${process.cpu_percent > 50 ? 'high' : ''}`}>
                          {process.cpu_percent}%
                        </span>
                      </td>
                      <td>
                        <span className={`metric-value memory-value ${process.memory_percent > 50 ? 'high' : ''}`}>
                          {process.memory_percent}%
                        </span>
                      </td>
                      <td>{formatBytes(process.memory_rss)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="no-data">
              <p>暂无进程数据，请等待系统采集数据。</p>
            </div>
          )}
          
          {selectedProcess && (
            <div className="selected-process-info">
              <p>
                已选中进程: <strong>{selectedProcess.name}</strong> (PID: {selectedProcess.pid})
                <button className="deselect-btn" onClick={() => setSelectedProcess(null)}>
                  取消选择
                </button>
              </p>
            </div>
          )}
        </div>

        {selectedProcess && (
          <div className="process-chart-card chart-card">
            <h2>
              进程历史趋势: {selectedProcess.name} (PID: {selectedProcess.pid})
            </h2>
            {processLoading ? (
              <div className="no-data">
                <p>正在加载进程历史数据...</p>
              </div>
            ) : selectedProcessMetrics.length > 0 ? (
              <div className="process-charts">
                <div className="process-chart">
                  <h3>CPU 使用趋势</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={selectedProcessMetrics} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="timestamp" 
                        tick={{ fontSize: 10 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis 
                        tick={{ fontSize: 10 }}
                        label={{ value: 'CPU (%)', angle: -90, position: 'insideLeft', fontSize: 10 }}
                      />
                      <Tooltip 
                        labelFormatter={(label) => `时间: ${label}`}
                        formatter={(value) => [`${value}%`, 'CPU 使用率']}
                      />
                      <Legend />
                      <Line 
                        type="monotone" 
                        dataKey="cpu_percent" 
                        stroke="#ff7300" 
                        name="进程 CPU 使用率"
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="process-chart">
                  <h3>内存使用趋势</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={selectedProcessMetrics} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="timestamp" 
                        tick={{ fontSize: 10 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis 
                        tick={{ fontSize: 10 }}
                        label={{ value: '内存 (%)', angle: -90, position: 'insideLeft', fontSize: 10 }}
                      />
                      <Tooltip 
                        labelFormatter={(label) => `时间: ${label}`}
                        formatter={(value) => [`${value}%`, '内存使用率']}
                      />
                      <Legend />
                      <Line 
                        type="monotone" 
                        dataKey="memory_percent" 
                        stroke="#387908" 
                        name="进程内存使用率"
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <div className="no-data">
                <p>该进程暂无历史数据，请等待系统采集更多数据。</p>
              </div>
            )}
          </div>
        )}
      </div>

      {metrics.length > 0 && (
        <div className="data-info">
          <p>显示 {metrics.length} 条数据记录，时间范围：过去 {timeRange === 1 ? '1小时' : timeRange === 24 ? '24小时' : '7天'}</p>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
