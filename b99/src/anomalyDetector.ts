import { SensorData, Anomaly } from './types';
import VirtualProbe from './virtualProbe';

interface DetectionConfig {
  temperatureThreshold: number;
  temperatureMaxJump: number;
  offlineThresholdSeconds: number;
  virtualProbeMinInterval: number;
}

interface OfflineRecoveryResult {
  isRecovery: boolean;
  offlineDurationMs: number;
  lastKnownData: SensorData;
  recoveryData: SensorData;
  virtualData: SensorData[];
  anomalies: Anomaly[];
}

class AnomalyDetector {
  private config: DetectionConfig;
  private deviceLastData: Map<string, SensorData>;
  private temperatureExceedStart: Map<string, number>;
  private deviceOfflineState: Map<string, { offlineSince: number; lastKnownData: SensorData }>;
  private virtualProbe: VirtualProbe;

  constructor(config: DetectionConfig) {
    this.config = config;
    this.deviceLastData = new Map();
    this.temperatureExceedStart = new Map();
    this.deviceOfflineState = new Map();
    this.virtualProbe = new VirtualProbe(config.virtualProbeMinInterval || 60);
  }

  detect(data: SensorData): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const lastData = this.deviceLastData.get(data.deviceId);

    if (lastData) {
      const timeDiffMs = data.timestamp - lastData.timestamp;
      const thresholdMs = this.config.offlineThresholdSeconds * 1000;

      if (timeDiffMs > thresholdMs) {
        const recoveryResult = this.handleOfflineRecovery(data, lastData);
        anomalies.push(...recoveryResult.anomalies);
      } else {
        const jumpAnomaly = this.detectTemperatureJump(data, lastData);
        if (jumpAnomaly) {
          anomalies.push(jumpAnomaly);
        }
      }
    }

    const exceedAnomaly = this.detectTemperatureExceed(data);
    if (exceedAnomaly) {
      anomalies.push(exceedAnomaly);
    }

    this.deviceLastData.set(data.deviceId, data);
    this.deviceOfflineState.delete(data.deviceId);
    return anomalies;
  }

  private handleOfflineRecovery(recoveryData: SensorData, lastKnownData: SensorData): OfflineRecoveryResult {
    const offlineDurationMs = recoveryData.timestamp - lastKnownData.timestamp;
    const virtualData = this.virtualProbe.generateVirtualData(
      recoveryData.deviceId,
      lastKnownData,
      recoveryData,
      true
    );

    const anomalies: Anomaly[] = [];

    anomalies.push({
      deviceId: recoveryData.deviceId,
      anomalyType: 'DEVICE_OFFLINE_RECOVERY',
      startTime: lastKnownData.timestamp,
      endTime: recoveryData.timestamp,
      description: `设备离线后恢复: 离线时长 ${(offlineDurationMs / 60000).toFixed(1)} 分钟, 恢复温度 ${recoveryData.temperature.toFixed(1)}°C`,
      severity: Math.min(1 + offlineDurationMs / (3600000), 3.0),
      contextData: virtualData
    });

    const anomalyPoint = this.virtualProbe.detectOfflineAnomalyPoint(
      lastKnownData,
      recoveryData,
      this.config.temperatureThreshold
    );

    if (anomalyPoint) {
      anomalies.push({
        deviceId: recoveryData.deviceId,
        anomalyType: 'OFFLINE_TEMPERATURE_EXCEED',
        startTime: anomalyPoint.timestamp,
        endTime: recoveryData.timestamp,
        description: `离线期间温度超标: 预估超标时间 ${new Date(anomalyPoint.timestamp).toISOString()}, 恢复温度 ${recoveryData.temperature.toFixed(1)}°C`,
        severity: Math.max(1.0, Math.abs(recoveryData.temperature - this.config.temperatureThreshold) / 5),
        contextData: virtualData
      });
    }

    const tempDiff = Math.abs(recoveryData.temperature - lastKnownData.temperature);
    if (tempDiff > this.config.temperatureMaxJump) {
      anomalies.push({
        deviceId: recoveryData.deviceId,
        anomalyType: 'OFFLINE_TEMPERATURE_JUMP',
        startTime: lastKnownData.timestamp,
        endTime: recoveryData.timestamp,
        description: `离线期间温度突变: ${lastKnownData.temperature.toFixed(1)}°C -> ${recoveryData.temperature.toFixed(1)}°C, 变化 ${tempDiff.toFixed(1)}°C`,
        severity: Math.min(tempDiff / this.config.temperatureMaxJump, 3.0),
        contextData: virtualData
      });
    }

    return {
      isRecovery: true,
      offlineDurationMs,
      lastKnownData,
      recoveryData,
      virtualData,
      anomalies
    };
  }

  getVirtualProbe(): VirtualProbe {
    return this.virtualProbe;
  }

  private detectTemperatureJump(current: SensorData, previous: SensorData): Anomaly | null {
    const tempDiff = Math.abs(current.temperature - previous.temperature);

    if (tempDiff > this.config.temperatureMaxJump) {
      return {
        deviceId: current.deviceId,
        anomalyType: 'TEMPERATURE_JUMP',
        startTime: previous.timestamp,
        endTime: current.timestamp,
        description: `温度突变: ${previous.temperature.toFixed(1)}°C -> ${current.temperature.toFixed(1)}°C, 变化 ${tempDiff.toFixed(1)}°C`,
        severity: Math.min(tempDiff / this.config.temperatureMaxJump, 3.0),
        contextData: [previous, current]
      };
    }
    return null;
  }

  private detectTemperatureExceed(data: SensorData): Anomaly | null {
    const isExceeding = data.temperature > this.config.temperatureThreshold;
    const exceedStart = this.temperatureExceedStart.get(data.deviceId);

    if (isExceeding) {
      if (!exceedStart) {
        this.temperatureExceedStart.set(data.deviceId, data.timestamp);
        return {
          deviceId: data.deviceId,
          anomalyType: 'TEMPERATURE_EXCEED_START',
          startTime: data.timestamp,
          endTime: data.timestamp,
          description: `温度开始超标: 当前温度 ${data.temperature.toFixed(1)}°C, 阈值 ${this.config.temperatureThreshold}°C`,
          severity: 1.0,
          contextData: [data]
        };
      } else {
        const durationMinutes = (data.timestamp - exceedStart) / 60000;
        if (durationMinutes >= 5) {
          return {
            deviceId: data.deviceId,
            anomalyType: 'TEMPERATURE_EXCEED_CONTINUOUS',
            startTime: exceedStart,
            endTime: data.timestamp,
            description: `温度持续超标: 已持续 ${durationMinutes.toFixed(1)} 分钟, 当前温度 ${data.temperature.toFixed(1)}°C`,
            severity: Math.min(1 + durationMinutes / 30, 3.0),
            contextData: [data]
          };
        }
      }
    } else {
      if (exceedStart) {
        this.temperatureExceedStart.delete(data.deviceId);
        const durationMinutes = (data.timestamp - exceedStart) / 60000;
        return {
          deviceId: data.deviceId,
          anomalyType: 'TEMPERATURE_EXCEED_END',
          startTime: exceedStart,
          endTime: data.timestamp,
          description: `温度恢复正常: 超标持续 ${durationMinutes.toFixed(1)} 分钟, 当前温度 ${data.temperature.toFixed(1)}°C`,
          severity: 0.5,
          contextData: [data]
        };
      }
    }
    return null;
  }

  checkOfflineDevices(currentTime: number): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const thresholdMs = this.config.offlineThresholdSeconds * 1000;

    for (const [deviceId, lastData] of this.deviceLastData.entries()) {
      const offlineDuration = currentTime - lastData.timestamp;
      if (offlineDuration > thresholdMs) {
        anomalies.push({
          deviceId,
          anomalyType: 'DEVICE_OFFLINE',
          startTime: lastData.timestamp,
          endTime: currentTime,
          description: `设备离线: 最后数据时间 ${new Date(lastData.timestamp).toISOString()}, 已离线 ${(offlineDuration / 60000).toFixed(1)} 分钟`,
          severity: Math.min(1 + offlineDuration / thresholdMs, 3.0),
          contextData: [lastData]
        });
      }
    }
    return anomalies;
  }

  getDeviceLastData(deviceId: string): SensorData | undefined {
    return this.deviceLastData.get(deviceId);
  }

  clearDeviceState(deviceId: string): void {
    this.deviceLastData.delete(deviceId);
    this.temperatureExceedStart.delete(deviceId);
  }
}

export default AnomalyDetector;
