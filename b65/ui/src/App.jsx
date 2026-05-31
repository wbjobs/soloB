import React, { useState, useEffect, useCallback } from 'react';
import TraceViewer from './TraceViewer';

const COLLECTOR_API = process.env.REACT_APP_COLLECTOR_URL || 'http://localhost:8080';

const formatDuration = (microseconds) => {
  if (!microseconds) return '-';
  if (microseconds < 1000) return `${microseconds} µs`;
  if (microseconds < 1000000) return `${(microseconds / 1000).toFixed(2)} ms`;
  return `${(microseconds / 1000000).toFixed(2)} s`;
};

const formatTime = (isoString) => {
  if (!isoString) return '-';
  const date = new Date(isoString);
  return date.toLocaleTimeString('zh-CN', { hour12: false });
};

const BASE_TIME = Date.now();

const mockTraces = [
  {
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    spans: [
      {
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        name: 'GET /api/users',
        serviceName: 'gateway',
        startTime: new Date(BASE_TIME - 500).toISOString(),
        endTime: new Date(BASE_TIME).toISOString(),
        duration: 500000,
        tags: { 'http.method': 'GET', 'http.status': 200 }
      },
      {
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '01f067aa0ba902b7',
        parentSpanId: '00f067aa0ba902b7',
        name: 'getUserById',
        serviceName: 'user-service',
        startTime: new Date(BASE_TIME - 400).toISOString(),
        endTime: new Date(BASE_TIME - 50).toISOString(),
        duration: 350000,
        tags: { 'userId': 123, 'cache.hit': false }
      },
      {
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '02f067aa0ba902b7',
        parentSpanId: '01f067aa0ba902b7',
        name: 'SELECT FROM users',
        serviceName: 'database',
        startTime: new Date(BASE_TIME - 350).toISOString(),
        endTime: new Date(BASE_TIME - 150).toISOString(),
        duration: 200000,
        tags: { 'db.query': 'SELECT * FROM users WHERE id = ?', 'db.rows': 1 }
      }
    ]
  },
  {
    traceId: '5bf92f3577b34da6a3ce929d0e0e4737',
    spans: [
      {
        traceId: '5bf92f3577b34da6a3ce929d0e0e4737',
        spanId: '10f067aa0ba902b7',
        name: 'POST /api/orders',
        serviceName: 'gateway',
        startTime: new Date(BASE_TIME - 300).toISOString(),
        endTime: new Date(BASE_TIME).toISOString(),
        duration: 300000,
        tags: { 'http.method': 'POST', 'http.status': 201 }
      },
      {
        traceId: '5bf92f3577b34da6a3ce929d0e0e4737',
        spanId: '11f067aa0ba902b7',
        parentSpanId: '10f067aa0ba902b7',
        name: 'createOrder',
        serviceName: 'user-service',
        startTime: new Date(BASE_TIME - 250).toISOString(),
        endTime: new Date(BASE_TIME - 50).toISOString(),
        duration: 200000,
        tags: { 'orderId': 'ORD-001 }
      }
    ]
  }
];

function App() {
  const [traces, setTraces] = useState([]);
  const [selectedTrace, setSelectedTrace] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [useMockData, setUseMockData] = useState(true);

  const fetchTraces = useCallback(async () => {
    if (useMockData) {
      const mockList = mockTraces.map(t => ({
        traceId: t.traceId,
        spanCount: t.spans.length,
        startTime: t.spans[0]?.startTime,
        endTime: t.spans[0]?.endTime,
        totalDuration: t.spans.reduce((sum, s) => sum + (s.duration || 0), 0)
      }));
      setTraces(mockList);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${COLLECTOR_API}/traces`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setTraces(data.traces || []);
    } catch (err) {
      setError(`无法连接到 Collector: ${err.message}`);
      const mockList = mockTraces.map(t => ({
        traceId: t.traceId,
        spanCount: t.spans.length,
        startTime: t.spans[0]?.startTime,
        endTime: t.spans[0]?.endTime,
        totalDuration: t.spans.reduce((sum, s) => sum + (s.duration || 0), 0)
      }));
      setTraces(mockList);
    } finally {
      setLoading(false);
    }
  }, [useMockData]);

  const fetchTraceDetail = useCallback(async (traceId) => {
    if (useMockData) {
      const mock = mockTraces.find(t => t.traceId === traceId);
      if (mock) {
        setSelectedTrace(mock);
      }
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${COLLECTOR_API}/traces/${traceId}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setSelectedTrace(data);
    } catch (err) {
      setError(`无法获取 Trace 详情: ${err.message}`);
      const mock = mockTraces.find(t => t.traceId === traceId);
      if (mock) {
        setSelectedTrace(mock);
      }
    } finally {
      setLoading(false);
    }
  }, [useMockData]);

  useEffect(() => {
    fetchTraces();
  }, [fetchTraces]);

  const handleTraceClick = (trace) => {
    fetchTraceDetail(trace.traceId);
  };

  const handleBack = () => {
    setSelectedTrace(null);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>分布式链路追踪系统</h1>
        <p>Distributed Tracing System - TraceID & SpanID 透传</p>
        <div style={{ marginTop: 12 }}>
          <label style={{ marginRight: 16, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={useMockData}
              onChange={(e) => {
                setUseMockData(e.target.checked);
                setSelectedTrace(null);
              }}
              style={{ marginRight: 8 }}
            />
            使用模拟数据
          </label>
          {!useMockData && (
            <span style={{ color: '#888' }}>
              Collector API: {COLLECTOR_API}
            </span>
          )}
        </div>
      </header>

      {error && (
        <div className="error">
          {error} (已回退到模拟数据)
        </div>
      )}

      {loading && (
        <div className="loading">
          <div className="spinner"></div>
          <p>加载中...</p>
        </div>
      )}

      {!loading && selectedTrace ? (
        <div className="trace-detail">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2>调用链详情</h2>
            <button className="back-btn" onClick={handleBack}>
              ← 返回列表
            </button>
          </div>
          <TraceViewer data={selectedTrace} />
        </div>
      ) : (
        !loading && (
          <div className="trace-list">
            <div className="trace-list-header">
              <h2>Trace 列表 ({traces.length})</h2>
              <button className="refresh-btn" onClick={fetchTraces}>
                刷新
              </button>
            </div>

            {traces.length === 0 ? (
              <div className="empty-state">
                <p>暂无 Trace 数据</p>
                <p style={{ fontSize: '0.85rem', marginTop: 8 }}>
                  请启动 Collector 和 Demo 程序来生成追踪数据
                </p>
              </div>
            ) : (
              <table className="trace-table">
                <thead>
                  <tr>
                    <th>Trace ID</th>
                    <th>Span 数量</th>
                    <th>开始时间</th>
                    <th>总耗时</th>
                  </tr>
                </thead>
                <tbody>
                  {traces.map((trace) => (
                    <tr key={trace.traceId} onClick={() => handleTraceClick(trace)}>
                      <td>
                        <span className="trace-id">{trace.traceId}</span>
                      </td>
                      <td>{trace.spanCount || '-'}</td>
                      <td>{formatTime(trace.startTime)}</td>
                      <td>
                        <span className="duration">
                          {formatDuration(trace.totalDuration)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      )}

      {!selectedTrace && !loading && traces.length > 0 && (
        <div style={{ marginTop: 24, padding: 16, background: '#16213e', borderRadius: 12 }}>
          <h3 style={{ color: '#00d9ff', marginBottom: 12 }}>使用说明</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, color: '#888', fontSize: '0.9rem' }}>
            <div>
              <p><strong style={{ color: '#eaeaea' }}>1. 启动 Collector:</strong></p>
              <code style={{ background: '#0f3460', padding: 4, borderRadius: 4 }}>
                go run cmd/collector/main.go -port 8080 -sample-rate 1.0
              </code>
            </div>
            <div>
              <p><strong style={{ color: '#eaeaea' }}>2. 生成 Demo 数据:</strong></p>
              <code style={{ background: '#0f3460', padding: 4, borderRadius: 4 }}>
                go run cmd/demo/main.go
              </code>
            </div>
            <div>
              <p><strong style={{ color: '#eaeaea' }}>3. 启动 UI:</strong></p>
              <code style={{ background: '#0f3460', padding: 4, borderRadius: 4 }}>
                cd ui && npm install && npm start
              </code>
            </div>
          </div>

          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #2a2a4a' }}>
            <h4 style={{ color: '#00d9ff', marginBottom: 8 }}>TraceContext 协议</h4>
            <p style={{ color: '#888', fontSize: '0.85rem', lineHeight: 1.6 }}>
              系统遵循 W3C TraceContext 协议，traceparent HTTP Header 格式为：<br/>
              <code style={{ background: '#0f3460', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' }}>
                version-traceId-spanId-traceFlags
              </code><br/>
              例如：<code style={{ background: '#0f3460', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' }}>
                00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
              </code>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
