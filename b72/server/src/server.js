require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const scoreRoutes = require('./routes/scores');
const socketHandler = require('./socket');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

const uploadDir = process.env.UPLOAD_PATH || './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/scores', scoreRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '服务运行正常' });
});

socketHandler(io);

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/score-collab';

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('MongoDB 连接成功');
    server.listen(PORT, () => {
      console.log(`服务器运行在端口 ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('MongoDB 连接失败:', error);
  });
