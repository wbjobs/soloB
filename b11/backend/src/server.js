require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const pako = require('pako');
const { setupSocket } = require('./socket');
const { connectDB } = require('./config/database');
const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/rooms');
const codeRoutes = require('./routes/code');
const commentRoutes = require('./routes/comments');
const versionRoutes = require('./routes/versions');
const aiRoutes = require('./routes/ai');
const { authenticateToken } = require('./middleware/auth');
const versionService = require('./services/versionService');

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: process.env.SOCKET_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

const compressMiddleware = (req, res, next) => {
  const originalSend = res.send;
  res.send = function(data) {
    const acceptEncoding = req.headers['accept-encoding'] || '';
    if (acceptEncoding.includes('gzip') && typeof data === 'string' && data.length > 1024) {
      try {
        const compressed = pako.gzip(data);
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Content-Type', 'application/json');
        return originalSend.call(this, compressed);
      } catch (e) {
        console.error('Compression error:', e);
      }
    }
    return originalSend.call(this, data);
  };
  next();
};

app.use('/api/auth', authRoutes);
app.use('/api/rooms', authenticateToken, roomRoutes);
app.use('/api/code', authenticateToken, codeRoutes);
app.use('/api/reviews', authenticateToken, (req, res, next) => {
  req.io = io;
  next();
}, commentRoutes);
app.use('/api/versions', authenticateToken, (req, res, next) => {
  req.io = io;
  next();
}, versionRoutes);
app.use('/api/ai', authenticateToken, aiRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    features: {
      mongodb: !!process.env.MONGODB_URI,
      ai: !!process.env.OPENAI_API_KEY,
      versionControl: true
    }
  });
});

app.use(compressMiddleware);

const io = new Server(server, {
  cors: {
    origin: process.env.SOCKET_ORIGIN || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true
  },
  maxHttpBufferSize: 1e6,
  pingTimeout: 60000,
  pingInterval: 25000
});

const autoSaveTimers = new Map();
const AUTO_SAVE_INTERVAL = parseInt(process.env.AUTO_SAVE_INTERVAL) || 60000;

const originalSetup = setupSocket(io);

const initServices = async () => {
  if (process.env.MONGODB_URI) {
    await connectDB();
  } else {
    console.log('MongoDB not configured, skipping database connection');
  }
};

const PORT = process.env.PORT || 3001;

initServices().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Features enabled:');
    console.log('  - Code Review:', !!process.env.MONGODB_URI);
    console.log('  - Version Control: true');
    console.log('  - AI Assistant:', !!process.env.OPENAI_API_KEY);
  });
}).catch((err) => {
  console.error('Failed to initialize services:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});

module.exports = { app, server, io };
