import * as http from 'http';
import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';
import Database from './database';
import { SensorData } from './types';

class HttpServer {
  private server: http.Server;
  private db: Database;
  private port: number;

  constructor(db: Database, port: number = 3000) {
    this.db = db;
    this.port = port;
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const parsedUrl = url.parse(req.url || '', true);
    const pathname = parsedUrl.pathname || '/';

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      this.serveStaticFile('index.html', res);
      return;
    }

    if (pathname === '/api/devices') {
      await this.handleGetDevices(res);
      return;
    }

    if (pathname === '/api/history') {
      await this.handleGetHistory(parsedUrl.query, res);
      return;
    }

    if (pathname === '/api/anomalies') {
      await this.handleGetAnomalies(parsedUrl.query, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private serveStaticFile(filename: string, res: http.ServerResponse) {
    const filePath = path.join(__dirname, '..', 'public', filename);
    
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
        return;
      }

      const contentType = filename.endsWith('.html') ? 'text/html' :
                          filename.endsWith('.js') ? 'application/javascript' :
                          filename.endsWith('.css') ? 'text/css' : 'text/plain';

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  }

  private async handleGetDevices(res: http.ServerResponse) {
    try {
      const result = await this.db.getPool().query(`
        SELECT DISTINCT device_id, 
               MAX(timestamp) as last_seen,
               COUNT(*) as data_count
        FROM sensor_data
        GROUP BY device_id
        ORDER BY last_seen DESC
      `);

      const devices = result.rows.map(row => ({
        deviceId: row.device_id,
        lastSeen: row.last_seen ? new Date(row.last_seen).getTime() : null,
        dataCount: parseInt(row.data_count)
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, devices }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: (error as Error).message }));
    }
  }

  private async handleGetHistory(query: any, res: http.ServerResponse) {
    try {
      const deviceId = query.deviceId as string;
      const startTime = parseInt(query.startTime as string);
      const endTime = parseInt(query.endTime as string);

      if (!deviceId || !startTime || !endTime) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Missing required parameters' }));
        return;
      }

      const data = await this.db.getDeviceDataInRange(deviceId, startTime, endTime);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true, 
        data,
        count: data.length
      }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: (error as Error).message }));
    }
  }

  private async handleGetAnomalies(query: any, res: http.ServerResponse) {
    try {
      const deviceId = query.deviceId as string;
      const startTime = parseInt(query.startTime as string);
      const endTime = parseInt(query.endTime as string);

      if (!deviceId || !startTime || !endTime) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Missing required parameters' }));
        return;
      }

      const anomalies = await this.db.queryAnomalies(deviceId, startTime, endTime);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true, 
        anomalies,
        count: anomalies.length
      }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: (error as Error).message }));
    }
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`HTTP server started on http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        console.log('HTTP server stopped');
        resolve();
      });
    });
  }
}

export default HttpServer;
