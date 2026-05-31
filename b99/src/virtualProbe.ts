import { SensorData } from './types';

interface KalmanState {
  temperature: number;
  variance: number;
}

class KalmanFilter {
  private state: KalmanState;
  private processNoise: number;
  private measurementNoise: number;

  constructor(initialTemp: number, initialVariance: number = 1.0, processNoise: number = 0.1, measurementNoise: number = 0.5) {
    this.state = {
      temperature: initialTemp,
      variance: initialVariance
    };
    this.processNoise = processNoise;
    this.measurementNoise = measurementNoise;
  }

  predict(dt: number = 1.0): void {
    this.state.variance += this.processNoise * dt;
  }

  update(measurement: number): void {
    const kalmanGain = this.state.variance / (this.state.variance + this.measurementNoise);
    this.state.temperature += kalmanGain * (measurement - this.state.temperature);
    this.state.variance *= (1 - kalmanGain);
  }

  getTemperature(): number {
    return this.state.temperature;
  }

  getVariance(): number {
    return this.state.variance;
  }
}

class VirtualProbe {
  private minIntervalSeconds: number;
  private maxVirtualPoints: number;

  constructor(minIntervalSeconds: number = 60, maxVirtualPoints: number = 1000) {
    this.minIntervalSeconds = minIntervalSeconds;
    this.maxVirtualPoints = maxVirtualPoints;
  }

  private linearInterpolate(startData: SensorData, endData: SensorData, timestamp: number): number {
    const timeRatio = (timestamp - startData.timestamp) / (endData.timestamp - startData.timestamp);
    return startData.temperature + timeRatio * (endData.temperature - startData.temperature);
  }

  private interpolateHumidity(startData: SensorData, endData: SensorData, timestamp: number): number | undefined {
    if (startData.humidity === undefined || endData.humidity === undefined) return undefined;
    const timeRatio = (timestamp - startData.timestamp) / (endData.timestamp - startData.timestamp);
    return startData.humidity + timeRatio * (endData.humidity - startData.humidity);
  }

  private generateTimestamps(startTime: number, endTime: number): number[] {
    const durationMs = endTime - startTime;
    const minIntervalMs = this.minIntervalSeconds * 1000;
    
    let numPoints = Math.min(
      Math.floor(durationMs / minIntervalMs) + 1,
      this.maxVirtualPoints
    );
    
    if (numPoints < 2) numPoints = 2;
    
    const actualIntervalMs = durationMs / (numPoints - 1);
    const timestamps: number[] = [];
    
    for (let i = 0; i < numPoints; i++) {
      timestamps.push(startTime + i * actualIntervalMs);
    }
    
    return timestamps;
  }

  generateVirtualData(
    deviceId: string,
    lastKnownData: SensorData,
    firstRecoveryData: SensorData,
    useKalman: boolean = true
  ): SensorData[] {
    if (lastKnownData.timestamp >= firstRecoveryData.timestamp) {
      return [];
    }

    const timestamps = this.generateTimestamps(lastKnownData.timestamp, firstRecoveryData.timestamp);

    if (!useKalman) {
      return timestamps.map(ts => ({
        deviceId,
        timestamp: ts,
        temperature: this.linearInterpolate(lastKnownData, firstRecoveryData, ts),
        humidity: this.interpolateHumidity(lastKnownData, firstRecoveryData, ts),
        latitude: ts === lastKnownData.timestamp ? lastKnownData.latitude : 
                  ts === firstRecoveryData.timestamp ? firstRecoveryData.latitude : undefined,
        longitude: ts === lastKnownData.timestamp ? lastKnownData.longitude : 
                   ts === firstRecoveryData.timestamp ? firstRecoveryData.longitude : undefined,
        battery: undefined
      }));
    }

    const kf = new KalmanFilter(lastKnownData.temperature);
    const virtualData: SensorData[] = [];

    virtualData.push({
      ...lastKnownData,
      deviceId
    });

    for (let i = 1; i < timestamps.length - 1; i++) {
      const ts = timestamps[i];
      const dtHours = (ts - timestamps[i - 1]) / 3600000;
      
      kf.predict(dtHours);
      
      const linearEstimate = this.linearInterpolate(lastKnownData, firstRecoveryData, ts);
      kf.update(linearEstimate);

      virtualData.push({
        deviceId,
        timestamp: ts,
        temperature: kf.getTemperature(),
        humidity: this.interpolateHumidity(lastKnownData, firstRecoveryData, ts),
        latitude: undefined,
        longitude: undefined,
        battery: undefined
      });
    }

    virtualData.push({
      ...firstRecoveryData,
      deviceId
    });

    return virtualData;
  }

  estimateTemperatureAt(
    lastKnownData: SensorData,
    firstRecoveryData: SensorData,
    targetTimestamp: number,
    useKalman: boolean = true
  ): number {
    if (targetTimestamp <= lastKnownData.timestamp) return lastKnownData.temperature;
    if (targetTimestamp >= firstRecoveryData.timestamp) return firstRecoveryData.temperature;

    if (!useKalman) {
      return this.linearInterpolate(lastKnownData, firstRecoveryData, targetTimestamp);
    }

    const timestamps = this.generateTimestamps(lastKnownData.timestamp, firstRecoveryData.timestamp);
    const kf = new KalmanFilter(lastKnownData.temperature);

    for (let i = 1; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const dtHours = (ts - timestamps[i - 1]) / 3600000;
      kf.predict(dtHours);
      
      const linearEstimate = this.linearInterpolate(lastKnownData, firstRecoveryData, ts);
      kf.update(linearEstimate);

      if (ts >= targetTimestamp) {
        return kf.getTemperature();
      }
    }

    return firstRecoveryData.temperature;
  }

  detectOfflineAnomalyPoint(
    lastKnownData: SensorData,
    firstRecoveryData: SensorData,
    temperatureThreshold: number
  ): { timestamp: number; temperature: number } | null {
    const startTemp = lastKnownData.temperature;
    const endTemp = firstRecoveryData.temperature;

    const bothExceed = startTemp > temperatureThreshold && endTemp > temperatureThreshold;
    const bothOk = startTemp <= temperatureThreshold && endTemp <= temperatureThreshold;

    if (bothExceed) {
      return {
        timestamp: lastKnownData.timestamp,
        temperature: startTemp
      };
    }

    if (bothOk) {
      return null;
    }

    const crossingTimestamp = lastKnownData.timestamp + 
      (temperatureThreshold - startTemp) * (firstRecoveryData.timestamp - lastKnownData.timestamp) / (endTemp - startTemp);

    return {
      timestamp: Math.round(crossingTimestamp),
      temperature: temperatureThreshold
    };
  }
}

export default VirtualProbe;
export { KalmanFilter };
