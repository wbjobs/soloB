import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import LatencyChart from './components/LatencyChart';
import TopologyGraph from './components/TopologyGraph';
import SlowRequestsTable from './components/SlowRequestsTable';
import LiveEvents from './components/LiveEvents';
import PIDFilter from './components/PIDFilter';
import AlertPanel from './components/AlertPanel';

const App = () => {
  const [selectedPID, setSelectedPID] = useState(null);
  const [latencyData, setLatencyData] = useState([]);
  const [topologyData, setTopologyData] = useState({ nodes: [], edges: [] });
  const [slowRequests, setSlowRequests] = useState([]);
  const [liveEvents, setLiveEvents] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [connected, setConnected] = useState(false);
  const [showAlertToast, setShowAlertToast] = useState(false);
  const [latestAlert, setLatestAlert] = useState(null);

  const fetchLatencyData = useCallback(async () => {
    try {
      const params = selectedPID ? { pid: selectedPID } : {};
      const response = await axios.get('/api/stats/latency-trend', { params });
      setLatencyData(response.data);
    } catch (error) {
      console.error('Error fetching latency data:', error);
    }
  }, [selectedPID]);

  const fetchTopologyData = useCallback(async () => {
    try {
      const params = selectedPID ? { pid: selectedPID } : {};
      const response = await axios.get('/api/stats/topology', { params });
      setTopologyData(response.data);
    } catch (error) {
      console.error('Error fetching topology data:', error);
    }
  }, [selectedPID]);

  const fetchSlowRequests = useCallback(async () => {
    try {
      const params = selectedPID ? { pid: selectedPID } : {};
      const response = await axios.get('/api/stats/slow-requests', { params });
      setSlowRequests(response.data);
    } catch (error) {
      console.error('Error fetching slow requests:', error);
    }
  }, [selectedPID]);

  useEffect(() => {
    fetchLatencyData();
    fetchTopologyData();
    fetchSlowRequests();

    const interval = setInterval(() => {
      fetchLatencyData();
      fetchTopologyData();
      fetchSlowRequests();
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchLatencyData, fetchTopologyData, fetchSlowRequests, selectedPID]);

  const fetchAlerts = useCallback(async () => {
    try {
      const response = await axios.get('/api/alerts');
      setAlerts(response.data);
    } catch (error) {
      console.error('Error fetching alerts:', error);
    }
  }, []);

  const handleClearAlerts = () => {
    setAlerts([]);
  };

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
      console.log('WebSocket connected');
      setConnected(true);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'new_event') {
        if (!selectedPID || data.data.pid === parseInt(selectedPID)) {
          setLiveEvents((prev) => [data.data, ...prev].slice(0, 50));
        }
      } else if (data.type === 'new_alert') {
        setAlerts((prev) => [data.data, ...prev].slice(0, 100));
        setLatestAlert(data.data);
        setShowAlertToast(true);
        setTimeout(() => setShowAlertToast(false), 5000);
      } else if (data.type === 'initial_alerts') {
        setAlerts(data.data);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [selectedPID]);

  return (
    <div style={styles.app}>
      {showAlertToast && latestAlert && (
        <div style={{
          ...styles.alertToast,
          backgroundColor: latestAlert.severity === 'CRITICAL' ? '#7f1d1d' :
            latestAlert.severity === 'HIGH' ? '#7c2d12' : '#78350f'
        }}>
          <div style={styles.toastContent}>
            <span style={styles.toastIcon}>🚨</span>
            <div style={styles.toastText}>
              <div style={styles.toastTitle}>检测到延迟异常</div>
              <div style={styles.toastDesc}>
                {latestAlert.method} {latestAlert.url} - {Math.round(latestAlert.latency)}ms
              </div>
            </div>
          </div>
        </div>
      )}

      <header style={styles.header}>
        <h1 style={styles.title}>HTTP Flow Analyzer</h1>
        <div style={styles.headerRight}>
          <div style={connected ? styles.statusConnected : styles.statusDisconnected}>
            {connected ? '● Live' : '○ Disconnected'}
          </div>
          <PIDFilter selectedPID={selectedPID} onSelectPID={setSelectedPID} />
        </div>
      </header>

      <main style={styles.main}>
        <div style={styles.row}>
          <div style={{ ...styles.card, flex: 2 }}>
            <h3 style={styles.cardTitle}>请求拓扑图</h3>
            <TopologyGraph data={topologyData} />
          </div>
        </div>

        <div style={styles.row}>
          <div style={{ ...styles.card, flex: 1 }}>
            <h3 style={styles.cardTitle}>平均延迟趋势</h3>
            <LatencyChart data={latencyData} />
          </div>
        </div>

        <div style={styles.row}>
          <div style={{ ...styles.card, flex: 1 }}>
            <h3 style={styles.cardTitle}>慢请求列表 (Top 50)</h3>
            <SlowRequestsTable data={slowRequests} />
          </div>
        </div>

        <div style={styles.row}>
          <div style={{ ...styles.card, flex: 1 }}>
            <h3 style={styles.cardTitle}>实时事件流</h3>
            <LiveEvents events={liveEvents} />
          </div>
          <div style={{ ...styles.card, flex: 1 }}>
            <AlertPanel alerts={alerts} onClearAlerts={handleClearAlerts} />
          </div>
        </div>
      </main>
    </div>
  );
};

const styles = {
  app: {
    minHeight: '100vh',
    backgroundColor: '#1a1a2e',
    color: '#eee',
    position: 'relative',
  },
  alertToast: {
    position: 'fixed',
    top: '1rem',
    right: '1rem',
    zIndex: 1000,
    padding: '1rem 1.5rem',
    borderRadius: '8px',
    borderLeft: '4px solid #ef4444',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    animation: 'slideIn 0.3s ease-out',
    maxWidth: '400px',
  },
  toastContent: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.75rem',
  },
  toastIcon: {
    fontSize: '1.5rem',
  },
  toastText: {
    flex: 1,
  },
  toastTitle: {
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: '0.25rem',
  },
  toastDesc: {
    fontSize: '0.85rem',
    color: '#ddd',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  header: {
    backgroundColor: '#16213e',
    padding: '1rem 2rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #0f3460',
  },
  title: {
    margin: 0,
    fontSize: '1.5rem',
    color: '#00d4ff',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  statusConnected: {
    color: '#00ff88',
    fontSize: '0.9rem',
  },
  statusDisconnected: {
    color: '#ff4757',
    fontSize: '0.9rem',
  },
  main: {
    padding: '1rem',
  },
  row: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1rem',
    flexWrap: 'wrap',
  },
  card: {
    backgroundColor: '#16213e',
    borderRadius: '8px',
    padding: '1rem',
    minWidth: '300px',
    border: '1px solid #0f3460',
  },
  cardTitle: {
    margin: '0 0 1rem 0',
    color: '#00d4ff',
    fontSize: '1.1rem',
  },
};

export default App;
