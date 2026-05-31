const { InfluxDB, Point } = require('@influxdata/influxdb-client');

class InfluxDBService {
  constructor() {
    this.client = null;
    this.writeApi = null;
    this.queryApi = null;
    this.org = null;
    this.bucket = null;
    this.connected = false;
  }

  connect() {
    const url = process.env.INFLUXDB_URL;
    const token = process.env.INFLUXDB_TOKEN;
    const org = process.env.INFLUXDB_ORG;
    const bucket = process.env.INFLUXDB_BUCKET;

    if (!url || !token || !org || !bucket) {
      console.warn('[InfluxDB] Configuration incomplete, skipping connection');
      return;
    }

    try {
      this.client = new InfluxDB({ url, token });
      this.writeApi = this.client.getWriteApi(org, bucket);
      this.queryApi = this.client.getQueryApi(org);
      this.org = org;
      this.bucket = bucket;
      this.connected = true;
      console.log('[InfluxDB] Connected successfully');
    } catch (error) {
      console.error('[InfluxDB] Failed to connect:', error.message);
      this.connected = false;
    }
  }

  writeTaskEvent(event) {
    if (!this.connected || !this.writeApi) {
      return;
    }

    const point = new Point('task_events')
      .tag('task_id', event.taskId)
      .tag('worker_id', event.workerId || 'unknown')
      .tag('task_name', event.taskName || 'unknown')
      .tag('status', event.status)
      .stringField('task_id', event.taskId)
      .stringField('worker_id', event.workerId || 'unknown')
      .stringField('task_name', event.taskName || 'unknown')
      .stringField('status', event.status);

    if (event.error) {
      point.stringField('error', event.error);
    }

    if (event.duration !== undefined) {
      point.floatField('duration_ms', event.duration);
    }

    if (event.queue) {
      point.tag('queue', event.queue);
    }

    this.writeApi.writePoint(point);
    this.writeApi.flush().catch(error => {
      console.error('[InfluxDB] Failed to write task event:', error.message);
    });
  }

  writeWorkerEvent(event) {
    if (!this.connected || !this.writeApi) {
      return;
    }

    const point = new Point('worker_events')
      .tag('worker_id', event.workerId)
      .tag('status', event.status)
      .stringField('worker_id', event.workerId)
      .stringField('status', event.status);

    if (event.queue) {
      point.tag('queue', event.queue);
    }

    this.writeApi.writePoint(point);
    this.writeApi.flush().catch(error => {
      console.error('[InfluxDB] Failed to write worker event:', error.message);
    });
  }

  async getTaskStatusTrend(hours = 24) {
    if (!this.connected || !this.queryApi) {
      console.warn('[InfluxDB] Not connected, returning mock trend data');
      return this.getMockTrendData(hours);
    }

    const fluxQuery = `
      from(bucket: "${this.bucket}")
        |> range(start: -${hours}h)
        |> filter(fn: (r) => r._measurement == "task_events")
        |> filter(fn: (r) => r.status == "SUCCESS" or r.status == "FAILURE")
        |> keep(columns: ["_time", "status", "task_id"])
        |> group(columns: ["_time", "status"])
        |> count()
        |> aggregateWindow(every: 1h, fn: sum, createEmpty: false)
        |> yield(name: "hourly_counts")
    `;

    try {
      const results = [];
      const rows = await this.queryApi.collectRows(fluxQuery);
      
      const hourlyData = new Map();
      rows.forEach(row => {
        const time = new Date(row._time);
        const hourKey = time.toISOString().substring(0, 13);
        const status = row.status;
        const count = row._value || 0;

        if (!hourlyData.has(hourKey)) {
          hourlyData.set(hourKey, {
            hour: new Date(time.setMinutes(0, 0, 0)).getTime(),
            success: 0,
            failure: 0
          });
        }

        if (status === 'SUCCESS') {
          hourlyData.get(hourKey).success = count;
        } else if (status === 'FAILURE') {
          hourlyData.get(hourKey).failure = count;
        }
      });

      const now = Date.now();
      for (let i = hours; i >= 0; i--) {
        const hourTime = new Date(now - i * 60 * 60 * 1000);
        hourTime.setMinutes(0, 0, 0);
        const hourKey = hourTime.toISOString().substring(0, 13);
        
        if (!hourlyData.has(hourKey)) {
          hourlyData.set(hourKey, {
            hour: hourTime.getTime(),
            success: 0,
            failure: 0
          });
        }
      }

      return Array.from(hourlyData.values())
        .sort((a, b) => a.hour - b.hour)
        .map(d => ({
          ...d,
          total: d.success + d.failure,
          successRate: d.success + d.failure > 0 
            ? (d.success / (d.success + d.failure) * 100) 
            : 0,
          failureRate: d.success + d.failure > 0 
            ? (d.failure / (d.success + d.failure) * 100) 
            : 0
        }));
    } catch (error) {
      console.error('[InfluxDB] Query error:', error.message);
      return this.getMockTrendData(hours);
    }
  }

  async getQueueBacklogTrend(hours = 24) {
    if (!this.connected || !this.queryApi) {
      console.warn('[InfluxDB] Not connected, returning mock backlog data');
      return this.getMockBacklogData(hours);
    }

    const fluxQuery = `
      from(bucket: "${this.bucket}")
        |> range(start: -${hours}h)
        |> filter(fn: (r) => r._measurement == "task_events")
        |> filter(fn: (r) => r.status == "PENDING" or r.status == "STARTED")
        |> keep(columns: ["_time", "status", "task_id"])
        |> duplicate(column: "_time", as: "hour")
        |> map(fn: (r) => ({
            r with hour: int(v: uint(v: r.hour) / 3600000000000) * 3600000000000
          }))
        |> group(columns: ["hour"])
        |> distinct(column: "task_id")
        |> count()
        |> yield(name: "backlog_per_hour")
    `;

    try {
      const rows = await this.queryApi.collectRows(fluxQuery);
      
      const hourlyBacklog = new Map();
      rows.forEach(row => {
        const hour = new Date(row.hour).getTime();
        hourlyBacklog.set(hour, row._value || 0);
      });

      const now = Date.now();
      const result = [];
      for (let i = hours; i >= 0; i--) {
        const hourTime = new Date(now - i * 60 * 60 * 1000);
        hourTime.setMinutes(0, 0, 0);
        const hourMs = hourTime.getTime();
        result.push({
          hour: hourMs,
          backlog: hourlyBacklog.get(hourMs) || 0
        });
      }

      return result;
    } catch (error) {
      console.error('[InfluxDB] Query error:', error.message);
      return this.getMockBacklogData(hours);
    }
  }

  getMockTrendData(hours = 24) {
    console.log('[InfluxDB] Generating mock trend data for', hours, 'hours');
    const now = Date.now();
    const data = [];

    for (let i = hours; i >= 0; i--) {
      const hourTime = new Date(now - i * 60 * 60 * 1000);
      hourTime.setMinutes(0, 0, 0);
      
      const success = Math.floor(Math.random() * 100) + 20;
      const failure = Math.floor(Math.random() * 20);
      const total = success + failure;

      data.push({
        hour: hourTime.getTime(),
        success,
        failure,
        total,
        successRate: (success / total * 100),
        failureRate: (failure / total * 100)
      });
    }

    return data;
  }

  getMockBacklogData(hours = 24) {
    console.log('[InfluxDB] Generating mock backlog data for', hours, 'hours');
    const now = Date.now();
    const data = [];

    for (let i = hours; i >= 0; i--) {
      const hourTime = new Date(now - i * 60 * 60 * 1000);
      hourTime.setMinutes(0, 0, 0);
      
      const baseBacklog = Math.floor(Math.random() * 50) + 10;
      const peakMultiplier = Math.random() > 0.7 ? 2 + Math.random() * 2 : 1;

      data.push({
        hour: hourTime.getTime(),
        backlog: Math.floor(baseBacklog * peakMultiplier)
      });
    }

    return data;
  }

  close() {
    if (this.writeApi) {
      this.writeApi.close().catch(console.error);
    }
  }
}

module.exports = new InfluxDBService();
