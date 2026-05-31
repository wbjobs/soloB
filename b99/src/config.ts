import dotenv from 'dotenv';
import { Config } from './types';

dotenv.config();

const config: Config = {
  port: parseInt(process.env.PORT || '50051'),
  httpPort: parseInt(process.env.HTTP_PORT || '3000'),
  dbHost: process.env.DB_HOST || 'localhost',
  dbPort: parseInt(process.env.DB_PORT || '5432'),
  dbName: process.env.DB_NAME || 'coldchain',
  dbUser: process.env.DB_USER || 'postgres',
  dbPassword: process.env.DB_PASSWORD || 'postgres',
  dbSsl: process.env.DB_SSL === 'true',
  temperatureThreshold: parseFloat(process.env.TEMPERATURE_THRESHOLD || '-18'),
  temperatureMaxJump: parseFloat(process.env.TEMPERATURE_MAX_JUMP || '5'),
  offlineThresholdSeconds: parseInt(process.env.OFFLINE_THRESHOLD_SECONDS || '300'),
  compressionEpsilon: parseFloat(process.env.COMPRESSION_EPSILON || '0.5'),
  virtualProbeMinInterval: parseInt(process.env.VIRTUAL_PROBE_MIN_INTERVAL || '60')
};

export default config;
