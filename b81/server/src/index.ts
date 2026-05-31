import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { config } from './utils/config';
import routes from './routes';
import { setupSocketHandler } from './socket/handler';
import { setIOInstance } from './workers';

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: config.corsOrigin,
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: 1e8,
});

app.use(cors({
  origin: config.corsOrigin,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', routes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

setupSocketHandler(io);
setIOInstance(io);

server.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
});

process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});

export { io };
