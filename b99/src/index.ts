import config from './config';
import Database from './database';
import DouglasPeuckerCompressor from './compression';
import AnomalyDetector from './anomalyDetector';
import GrpcServer from './grpcServer';
import HttpServer from './httpServer';

let db: Database;
let compressor: DouglasPeuckerCompressor;
let detector: AnomalyDetector;
let grpcServer: GrpcServer;
let httpServer: HttpServer;

async function main(): Promise<void> {
  console.log('Starting Cold Chain Monitor Service...');

  db = new Database({
    host: config.dbHost,
    port: config.dbPort,
    database: config.dbName,
    user: config.dbUser,
    password: config.dbPassword,
    ssl: config.dbSsl
  });

  try {
    await db.connect();
  } catch (error) {
    console.error('Failed to connect to database:', error);
    process.exit(1);
  }

  compressor = new DouglasPeuckerCompressor(config.compressionEpsilon);

  detector = new AnomalyDetector({
    temperatureThreshold: config.temperatureThreshold,
    temperatureMaxJump: config.temperatureMaxJump,
    offlineThresholdSeconds: config.offlineThresholdSeconds,
    virtualProbeMinInterval: config.virtualProbeMinInterval
  });

  grpcServer = new GrpcServer(db, compressor, detector);
  httpServer = new HttpServer(db, config.httpPort);

  try {
    await grpcServer.start(config.port);
    await httpServer.start();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }

  const offlineCheckInterval = setInterval(async () => {
    const currentTime = Date.now();
    const offlineAnomalies = detector.checkOfflineDevices(currentTime);
    for (const anomaly of offlineAnomalies) {
      await db.insertAnomaly(anomaly);
    }
    await db.updateDeviceOnlineStatus(config.offlineThresholdSeconds * 1000);
  }, 60000);

  process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully...');
    clearInterval(offlineCheckInterval);
    await grpcServer.stop();
    await httpServer.stop();
    await db.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    clearInterval(offlineCheckInterval);
    await grpcServer.stop();
    await httpServer.stop();
    await db.close();
    process.exit(0);
  });

  console.log('Cold Chain Monitor Service started successfully!');
  console.log(`gRPC server running on port ${config.port}`);
  console.log(`HTTP server running on http://localhost:${config.httpPort}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
