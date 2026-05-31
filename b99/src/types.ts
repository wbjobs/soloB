export interface SensorData {
  deviceId: string;
  timestamp: number;
  temperature: number;
  humidity?: number;
  latitude?: number;
  longitude?: number;
  battery?: number;
  isVirtual?: boolean;
}

export interface CompressedData {
  deviceId: string;
  points: SensorData[];
  originalCount: number;
  compressedCount: number;
}

export interface Anomaly {
  deviceId: string;
  anomalyType: string;
  startTime: number;
  endTime: number;
  description: string;
  contextData?: SensorData[];
  severity: number;
}

export interface GPSFence {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface Config {
  port: number;
  httpPort: number;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  dbSsl: boolean;
  temperatureThreshold: number;
  temperatureMaxJump: number;
  offlineThresholdSeconds: number;
  compressionEpsilon: number;
  virtualProbeMinInterval: number;
}
