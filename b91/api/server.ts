/**
 * local server entry file, for local development
 */
import { createServer, Server } from 'http';
import app from './app.js';
import { connectDB } from './config/database.js';
import { setupSignaling } from './socket/signaling.js';

/**
 * start server with port
 */
const PORT = process.env.PORT || 3001;
let httpServer: Server;

const startServer = async () => {
  await connectDB();
  
  httpServer = createServer(app);
  
  setupSignaling(httpServer);
  
  httpServer.listen(PORT, () => {
    console.log(`Server ready on port ${PORT}`);
    console.log(`WebSocket signaling server ready`);
  });
};

startServer();

/**
 * close server
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  if (httpServer) {
    httpServer.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  }
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received');
  if (httpServer) {
    httpServer.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  }
});

export default app;