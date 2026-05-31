import { SensorData, CompressedData } from './types';

class DouglasPeuckerCompressor {
  private epsilon: number;
  private deviceBuffers: Map<string, SensorData[]>;
  private bufferSize: number;

  constructor(epsilon: number = 0.5, bufferSize: number = 100) {
    this.epsilon = epsilon;
    this.deviceBuffers = new Map();
    this.bufferSize = bufferSize;
  }

  private perpendicularDistance(
    point: SensorData,
    lineStart: SensorData,
    lineEnd: SensorData
  ): number {
    if (lineStart.timestamp === lineEnd.timestamp) {
      return Math.abs(point.temperature - lineStart.temperature);
    }

    const t1 = lineStart.timestamp;
    const t2 = lineEnd.timestamp;
    const t = point.timestamp;
    const temp1 = lineStart.temperature;
    const temp2 = lineEnd.temperature;

    const slope = (temp2 - temp1) / (t2 - t1);
    const intercept = temp1 - slope * t1;
    const expectedTemp = slope * t + intercept;

    return Math.abs(point.temperature - expectedTemp);
  }

  private compressPoints(points: SensorData[]): SensorData[] {
    if (points.length <= 2) {
      return points;
    }

    let maxDistance = 0;
    let maxIndex = 0;
    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
      const distance = this.perpendicularDistance(points[i], firstPoint, lastPoint);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = i;
      }
    }

    if (maxDistance > this.epsilon) {
      const left = this.compressPoints(points.slice(0, maxIndex + 1));
      const right = this.compressPoints(points.slice(maxIndex));
      return [...left.slice(0, -1), ...right];
    }

    return [firstPoint, lastPoint];
  }

  private isTemperatureJump(current: SensorData, previous: SensorData, threshold: number): boolean {
    return Math.abs(current.temperature - previous.temperature) > threshold;
  }

  addData(data: SensorData, jumpThreshold: number = 5): CompressedData | null {
    let buffer = this.deviceBuffers.get(data.deviceId);
    if (!buffer) {
      buffer = [];
      this.deviceBuffers.set(data.deviceId, buffer);
    }

    buffer.push(data);

    if (buffer.length >= this.bufferSize) {
      const originalCount = buffer.length;
      const result = this.processBuffer(data.deviceId, buffer, jumpThreshold);
      this.deviceBuffers.set(data.deviceId, [buffer[buffer.length - 1]]);
      return result;
    }

    return null;
  }

  private processBuffer(deviceId: string, buffer: SensorData[], jumpThreshold: number): CompressedData {
    const sortedBuffer = [...buffer].sort((a, b) => a.timestamp - b.timestamp);
    const originalCount = sortedBuffer.length;

    const jumpPoints: SensorData[] = [sortedBuffer[0]];
    for (let i = 1; i < sortedBuffer.length; i++) {
      if (this.isTemperatureJump(sortedBuffer[i], sortedBuffer[i - 1], jumpThreshold)) {
        jumpPoints.push(sortedBuffer[i]);
      }
    }
    jumpPoints.push(sortedBuffer[sortedBuffer.length - 1]);

    const compressedPoints = this.compressPoints(sortedBuffer);
    const allImportantPoints = [...compressedPoints, ...jumpPoints];

    const uniquePointsMap = new Map<number, SensorData>();
    allImportantPoints.forEach(point => {
      uniquePointsMap.set(point.timestamp, point);
    });

    const finalPoints = Array.from(uniquePointsMap.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    return {
      deviceId,
      points: finalPoints,
      originalCount,
      compressedCount: finalPoints.length
    };
  }

  flushDevice(deviceId: string, jumpThreshold: number = 5): CompressedData | null {
    const buffer = this.deviceBuffers.get(deviceId);
    if (!buffer || buffer.length === 0) {
      return null;
    }

    const result = this.processBuffer(deviceId, buffer, jumpThreshold);
    this.deviceBuffers.set(deviceId, []);
    return result;
  }

  flushAll(jumpThreshold: number = 5): CompressedData[] {
    const results: CompressedData[] = [];
    for (const deviceId of this.deviceBuffers.keys()) {
      const result = this.flushDevice(deviceId, jumpThreshold);
      if (result) {
        results.push(result);
      }
    }
    return results;
  }
}

export default DouglasPeuckerCompressor;
