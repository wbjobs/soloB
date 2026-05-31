const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const INFLUX_URL = process.env.INFLUX_URL || 'http://localhost:8086';
const INFLUX_TOKEN = process.env.INFLUX_TOKEN || 'my-token';
const INFLUX_ORG = process.env.INFLUX_ORG || 'my-org';
const INFLUX_BUCKET = process.env.INFLUX_BUCKET || 'http-events';

const influxDB = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });
const writeApi = influxDB.getWriteApi(INFLUX_ORG, INFLUX_BUCKET);
const queryApi = influxDB.getQueryApi(INFLUX_ORG);

const clients = new Set();

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

class AnomalyDetector {
  constructor(windowSize = 100, sensitivity = 2.5) {
    this.windowSize = windowSize;
    this.sensitivity = sensitivity;
    this.latencyHistory = new Map();
    this.globalLatencies = [];
    this.alerts = [];
    this.maxAlerts = 100;
    this.cooldownPeriod = 5000;
    this.lastAlertTime = new Map();
  }

  calculateStats(values) {
    if (values.length === 0) return null;
    
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    const median = sorted[Math.floor(sorted.length / 2)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    
    return { mean, stdDev, median, p95, p99, count: values.length };
  }

  getDynamicThreshold(endpointKey) {
    const history = this.latencyHistory.get(endpointKey) || [];
    const globalStats = this.calculateStats(this.globalLatencies);
    const endpointStats = this.calculateStats(history);
    
    let threshold;
    if (endpointStats && endpointStats.count >= 10) {
      threshold = endpointStats.mean + this.sensitivity * endpointStats.stdDev;
      threshold = Math.max(threshold, endpointStats.p95 * 1.2);
    } else if (globalStats && globalStats.count >= 10) {
      threshold = globalStats.p99 * 1.5;
    } else {
      threshold = 3000;
    }
    
    return Math.min(Math.max(threshold, 500), 30000);
  }

  addLatency(endpointKey, latency, event) {
    let history = this.latencyHistory.get(endpointKey);
    if (!history) {
      history = [];
      this.latencyHistory.set(endpointKey, history);
    }
    
    history.push(latency);
    if (history.length > this.windowSize) {
      history.shift();
    }
    
    this.globalLatencies.push(latency);
    if (this.globalLatencies.length > this.windowSize * 5) {
      this.globalLatencies.shift();
    }
    
    const threshold = this.getDynamicThreshold(endpointKey);
    const isAnomaly = latency > threshold;
    
    if (isAnomaly) {
      const now = Date.now();
      const lastAlert = this.lastAlertTime.get(endpointKey) || 0;
      
      if (now - lastAlert > this.cooldownPeriod) {
        this.lastAlertTime.set(endpointKey, now);
        
        const severity = latency > threshold * 3 ? 'CRITICAL' : (latency > threshold * 2 ? 'HIGH' : 'MEDIUM');
        const stats = this.calculateStats(history) || this.calculateStats(this.globalLatencies) || { mean: 0, p95: 0 };
        
        const alert = {
          id: Date.now() + Math.random(),
          type: 'anomaly',
          severity,
          pid: event.pid,
          comm: event.comm,
          method: event.method,
          url: event.url,
          statusCode: event.status_code,
          latency: latency,
          threshold: Math.round(threshold),
          baseline: Math.round(stats.mean || 0),
          p95: Math.round(stats.p95 || 0),
          timestamp: new Date().toISOString(),
          message: `延迟异常: ${Math.round(latency)}ms > 阈值 ${Math.round(threshold)}ms`
        };
        
        this.alerts.unshift(alert);
        if (this.alerts.length > this.maxAlerts) {
          this.alerts.pop();
        }
        
        this.printAlert(alert);
        return alert;
      }
    }
    
    return null;
  }

  printAlert(alert) {
    const color = alert.severity === 'CRITICAL' ? RED : (alert.severity === 'HIGH' ? RED : YELLOW);
    const severityLabel = alert.severity.padEnd(8, ' ');
    
    console.log('\n');
    console.log(`${color}╔══════════════════════════════════════════════════════════════════╗${RESET}`);
    console.log(`${color}║  🚨 ANOMALY DETECTED - ${severityLabel}                            ║${RESET}`);
    console.log(`${color}╠══════════════════════════════════════════════════════════════════╣${RESET}`);
    console.log(`${color}║${RESET}  Process:  ${alert.comm} (PID: ${alert.pid})`);
    console.log(`${color}║${RESET}  Request:  ${alert.method} ${alert.url}`);
    console.log(`${color}║${RESET}  Status:   ${alert.statusCode}`);
    console.log(`${color}║${RESET}  Latency:  ${color}${Math.round(alert.latency)}ms${RESET} (阈值: ${alert.threshold}ms, 基线: ${alert.baseline}ms)`);
    console.log(`${color}║${RESET}  Time:     ${alert.timestamp}`);
    console.log(`${color}╚══════════════════════════════════════════════════════════════════╝${RESET}`);
    console.log('\n');
  }

  getAlerts() {
    return this.alerts;
  }

  getStats() {
    const globalStats = this.calculateStats(this.globalLatencies);
    return {
      global: globalStats,
      endpoints: Array.from(this.latencyHistory.entries()).map(([key, history]) => ({
        endpoint: key,
        ...this.calculateStats(history)
      })),
      alertsCount: this.alerts.length
    };
  }
}

const anomalyDetector = new AnomalyDetector(100, 2.5);

wss.on('connection', (ws) => {
  console.log(`${GREEN}✓${RESET} Client connected`);
  clients.add(ws);
  
  ws.send(JSON.stringify({
    type: 'initial_alerts',
    data: anomalyDetector.getAlerts()
  }));
  
  ws.on('close', () => {
    console.log(`${YELLOW}✗${RESET} Client disconnected`);
    clients.delete(ws);
  });
});

function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

app.post('/api/events', (req, res) => {
  const event = req.body;
  
  try {
    const point = new Point('http_request')
      .tag('pid', event.pid.toString())
      .tag('comm', event.comm)
      .tag('method', event.method)
      .tag('status_code', event.status_code.toString())
      .tag('url', event.url)
      .floatField('latency_ms', event.latency_ms)
      .intField('body_size', event.body_size)
      .timestamp(new Date(event.timestamp));
    
    writeApi.writePoint(point);
    
    const endpointKey = `${event.method}:${event.url}`;
    const alert = anomalyDetector.addLatency(endpointKey, event.latency_ms, event);
    
    if (alert) {
      broadcast({ type: 'new_alert', data: alert });
    }
    
    broadcast({ type: 'new_event', data: event });
    
    res.json({ success: true, alert: alert !== null });
  } catch (error) {
    console.error('Error writing to InfluxDB:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/alerts', (req, res) => {
  res.json(anomalyDetector.getAlerts());
});

app.get('/api/anomaly-stats', (req, res) => {
  res.json(anomalyDetector.getStats());
});

app.get('/api/events', async (req, res) => {
  try {
    const { pid, limit = 100, start = '-1h' } = req.query;
    
    let filter = '';
    if (pid) {
      filter = ` and r.pid == "${pid}"`;
    }
    
    const fluxQuery = `
      from(bucket: "${INFLUX_BUCKET}")
        |> range(start: ${start})
        |> filter(fn: (r) => r._measurement == "http_request")
        |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
        |> sort(columns: ["_time"], desc: true)
        |> limit(n: ${parseInt(limit)})
    `;
    
    const events = [];
    await queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        events.push({
          pid: parseInt(o.pid),
          comm: o.comm,
          method: o.method,
          url: o.url,
          statusCode: parseInt(o.status_code),
          latencyMs: o.latency_ms,
          bodySize: o.body_size,
          timestamp: o._time,
        });
      },
      error(error) {
        console.error('Query error:', error);
      },
      complete() {
        res.json(events);
      },
    });
  } catch (error) {
    console.error('Error querying events:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stats/latency-trend', async (req, res) => {
  try {
    const { pid, interval = '1m', start = '-1h' } = req.query;
    
    let filter = '';
    if (pid) {
      filter = ` and r.pid == "${pid}"`;
    }
    
    const fluxQuery = `
      from(bucket: "${INFLUX_BUCKET}")
        |> range(start: ${start})
        |> filter(fn: (r) => r._measurement == "http_request" and r._field == "latency_ms"${filter})
        |> aggregateWindow(every: ${interval}, fn: mean, createEmpty: false)
        |> yield(name: "mean")
    `;
    
    const data = [];
    await queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        data.push({
          time: o._time,
          avgLatency: o._value,
        });
      },
      error(error) {
        console.error('Query error:', error);
      },
      complete() {
        res.json(data);
      },
    });
  } catch (error) {
    console.error('Error querying latency trend:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stats/slow-requests', async (req, res) => {
  try {
    const { pid, limit = 50, threshold = 1000, start = '-1h' } = req.query;
    
    let filter = '';
    if (pid) {
      filter = ` and r.pid == "${pid}"`;
    }
    
    const fluxQuery = `
      from(bucket: "${INFLUX_BUCKET}")
        |> range(start: ${start})
        |> filter(fn: (r) => r._measurement == "http_request")
        |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
        |> filter(fn: (r) => r.latency_ms > ${parseFloat(threshold)}${filter})
        |> sort(columns: ["latency_ms"], desc: true)
        |> limit(n: ${parseInt(limit)})
    `;
    
    const events = [];
    await queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        events.push({
          pid: parseInt(o.pid),
          comm: o.comm,
          method: o.method,
          url: o.url,
          statusCode: parseInt(o.status_code),
          latencyMs: o.latency_ms,
          bodySize: o.body_size,
          timestamp: o._time,
        });
      },
      error(error) {
        console.error('Query error:', error);
      },
      complete() {
        res.json(events);
      },
    });
  } catch (error) {
    console.error('Error querying slow requests:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stats/topology', async (req, res) => {
  try {
    const { pid, start = '-1h' } = req.query;
    
    let filter = '';
    if (pid) {
      filter = ` and r.pid == "${pid}"`;
    }
    
    const fluxQuery = `
      from(bucket: "${INFLUX_BUCKET}")
        |> range(start: ${start})
        |> filter(fn: (r) => r._measurement == "http_request"${filter})
        |> keep(columns: ["pid", "comm", "method", "url", "status_code"])
        |> group(columns: ["pid", "comm", "url"])
        |> count()
    `;
    
    const nodes = new Map();
    const edges = new Map();
    
    await queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        const processId = `process_${o.pid}`;
        const endpointId = `endpoint_${o.url}`;
        
        if (!nodes.has(processId)) {
          nodes.set(processId, {
            id: processId,
            name: o.comm,
            type: 'process',
            pid: parseInt(o.pid),
          });
        }
        
        if (!nodes.has(endpointId)) {
          nodes.set(endpointId, {
            id: endpointId,
            name: o.url,
            type: 'endpoint',
          });
        }
        
        const edgeKey = `${processId}-${endpointId}`;
        if (!edges.has(edgeKey)) {
          edges.set(edgeKey, {
            source: processId,
            target: endpointId,
            count: 0,
          });
        }
        edges.get(edgeKey).count += parseInt(o._value);
      },
      error(error) {
        console.error('Query error:', error);
      },
      complete() {
        res.json({
          nodes: Array.from(nodes.values()),
          edges: Array.from(edges.values()),
        });
      },
    });
  } catch (error) {
    console.error('Error querying topology:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await writeApi.close();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`InfluxDB: ${INFLUX_URL}`);
});
