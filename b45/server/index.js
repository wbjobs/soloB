const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const ShareDB = require('sharedb');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ 
  server,
  perMessageDeflate: {
    zlibDeflateOptions: {
      chunkSize: 1024,
      memLevel: 7,
      level: 3
    },
    zlibInflateOptions: {
      chunkSize: 10 * 1024
    },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    serverMaxWindowBits: 10,
    concurrencyLimit: 10,
    threshold: 1024
  }
});

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

const share = new ShareDB({
  disableDocAction: true,
  disableSpaceDelimitedActions: true
});

let clientCount = 0;

wss.on('connection', (ws, req) => {
  clientCount++;
  console.log(`Client connected. Total clients: ${clientCount}`);
  
  try {
    const stream = new WebSocketJSONStream(ws);
    share.listen(stream);
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
    
    ws.on('close', () => {
      clientCount--;
      console.log(`Client disconnected. Total clients: ${clientCount}`);
    });
  } catch (error) {
    console.error('Error setting up ShareDB connection:', error);
    ws.close();
  }
});

class WebSocketJSONStream {
  constructor(ws) {
    this.ws = ws;
    this.readable = true;
    this.writable = true;
    this.queue = [];
    this.paused = false;
    
    ws.on('message', (data) => {
      try {
        let message;
        if (data instanceof Buffer) {
          message = JSON.parse(data.toString());
        } else if (typeof data === 'string') {
          message = JSON.parse(data);
        } else {
          console.warn('Unknown message type:', typeof data);
          return;
        }
        
        if (this.onmessage) {
          this.onmessage(message);
        }
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    });
    
    ws.on('close', () => {
      this.readable = false;
      this.writable = false;
      if (this.onclose) {
        this.onclose();
      }
    });
    
    ws.on('error', (error) => {
      if (this.onerror) {
        this.onerror(error);
      }
    });
  }
  
  send(message) {
    if (!this.writable || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending message:', error);
      this.writable = false;
    }
  }
  
  close() {
    this.writable = false;
    this.readable = false;
    try {
      this.ws.close();
    } catch (error) {
      console.error('Error closing WebSocket:', error);
    }
  }
  
  pause() {
    this.paused = true;
  }
  
  resume() {
    this.paused = false;
  }
  
  pipe(dest) {
    return dest;
  }
  
  unpipe() {
    return this;
  }
}

const connection = share.connect();
const doc = connection.get('shaders', 'default');

doc.fetch((err) => {
  if (err) {
    console.error('Error fetching document:', err);
    return;
  }
  
  if (doc.type === null) {
    const defaultShader = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform float iTime;
uniform vec2 iResolution;
uniform vec4 iMouse;

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;
    vec3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3(0.0, 2.0, 4.0));
    fragColor = vec4(col, 1.0);
}`;
    
    doc.create({
      title: 'My Shader',
      code: defaultShader,
      createdAt: Date.now()
    }, (err) => {
      if (err) {
        console.error('Error creating document:', err);
      } else {
        console.log('Created default shader document');
      }
    });
  } else {
    console.log('Default shader document already exists');
  }
});

doc.on('op', (op, source) => {
  if (source) {
    console.log('Local operation');
  } else {
    console.log('Remote operation received');
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    clients: clientCount,
    timestamp: Date.now()
  });
});

app.get('/api/documents', (req, res) => {
  const conn = share.connect();
  const docsQuery = conn.createSubscribeQuery('shaders', {});
  
  docsQuery.on('ready', () => {
    res.json({
      documents: docsQuery.results.map(d => ({
        id: d.id,
        title: d.data.title,
        createdAt: d.data.createdAt
      }))
    });
    conn.close();
  });
});

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../client/dist');
  app.use(express.static(distPath));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server ready`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});
