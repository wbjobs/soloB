import * as grpc from '@grpc/grpc-js';
import { SensorData, Anomaly, GPSFence } from './types';
import Database from './database';
import DouglasPeuckerCompressor from './compression';
import AnomalyDetector from './anomalyDetector';
import config from './config';

interface SubmitDataRequest {
  data: {
    deviceId: string;
    timestamp: number;
    temperature: number;
    humidity?: number;
    latitude?: number;
    longitude?: number;
    battery?: number;
  };
}

interface SubmitDataResponse {
  success: boolean;
  message: string;
}

interface BatchSubmitDataRequest {
  data: Array<{
    deviceId: string;
    timestamp: number;
    temperature: number;
    humidity?: number;
    latitude?: number;
    longitude?: number;
    battery?: number;
  }>;
}

interface BatchSubmitDataResponse {
  success: boolean;
  receivedCount: number;
  compressedCount: number;
  virtualProbeCount?: number;
}

interface QueryAnomaliesRequest {
  deviceId?: string;
  startTime: number;
  endTime: number;
  minLat?: number;
  maxLat?: number;
  minLng?: number;
  maxLng?: number;
  anomalyTypes?: string[];
  contextMinutes?: number;
}

interface QueryAnomaliesResponse {
  anomalies: Anomaly[];
  totalCount: number;
}

interface GetDeviceStatusRequest {
  deviceId: string;
}

interface GetDeviceStatusResponse {
  status: {
    deviceId: string;
    isOnline: boolean;
    lastSeen: number;
    currentTemperature?: number;
    currentHumidity?: number;
    activeAnomalies: number;
    dataCount24h: number;
  };
}

class GrpcServer {
  private server: grpc.Server;
  private db: Database;
  private compressor: DouglasPeuckerCompressor;
  private detector: AnomalyDetector;

  constructor(db: Database, compressor: DouglasPeuckerCompressor, detector: AnomalyDetector) {
    this.db = db;
    this.compressor = compressor;
    this.detector = detector;
    this.server = new grpc.Server();
  }

  private toSensorData(protoData: any): SensorData {
    return {
      deviceId: protoData.deviceId,
      timestamp: protoData.timestamp,
      temperature: protoData.temperature,
      humidity: protoData.humidity,
      latitude: protoData.latitude,
      longitude: protoData.longitude,
      battery: protoData.battery
    };
  }

  private async submitData(call: grpc.ServerUnaryCall<SubmitDataRequest, SubmitDataResponse>, callback: grpc.sendUnaryData<SubmitDataResponse>): Promise<void> {
    try {
      const data = this.toSensorData(call.request.data);
      
      const anomalies = this.detector.detect(data);
      let virtualDataCount = 0;

      for (const anomaly of anomalies) {
        await this.db.insertAnomaly(anomaly);
        
        if (anomaly.anomalyType === 'DEVICE_OFFLINE_RECOVERY' && anomaly.contextData) {
          const virtualData = anomaly.contextData.map(d => ({
            ...d,
            isVirtual: true
          }));
          await this.db.batchInsertSensorData(virtualData, true);
          virtualDataCount = virtualData.length;
        }
      }

      const compressed = this.compressor.addData(data, config.temperatureMaxJump);
      if (compressed) {
        await this.db.batchInsertSensorData(compressed.points, true);
        const message = virtualDataCount > 0
          ? `Data received, compressed: ${compressed.originalCount} -> ${compressed.compressedCount} points, virtual probe generated: ${virtualDataCount} points`
          : `Data received and compressed: ${compressed.originalCount} -> ${compressed.compressedCount} points`;
        callback(null, { success: true, message });
      } else {
        await this.db.insertSensorData(data, false);
        const message = virtualDataCount > 0
          ? `Data received and buffered, virtual probe generated: ${virtualDataCount} points`
          : 'Data received and buffered';
        callback(null, { success: true, message });
      }
    } catch (error) {
      callback({
        code: grpc.status.INTERNAL,
        message: `Error processing data: ${(error as Error).message}`
      }, null);
    }
  }

  private async batchSubmitData(call: grpc.ServerUnaryCall<BatchSubmitDataRequest, BatchSubmitDataResponse>, callback: grpc.sendUnaryData<BatchSubmitDataResponse>): Promise<void> {
    try {
      const dataList = call.request.data.map(d => this.toSensorData(d));
      let totalCompressed = 0;
      let totalVirtualData = 0;

      for (const data of dataList) {
        const anomalies = this.detector.detect(data);
        for (const anomaly of anomalies) {
          await this.db.insertAnomaly(anomaly);
          
          if (anomaly.anomalyType === 'DEVICE_OFFLINE_RECOVERY' && anomaly.contextData) {
            const virtualData = anomaly.contextData.map(d => ({
              ...d,
              isVirtual: true
            }));
            await this.db.batchInsertSensorData(virtualData, true);
            totalVirtualData += virtualData.length;
          }
        }

        const compressed = this.compressor.addData(data, config.temperatureMaxJump);
        if (compressed) {
          await this.db.batchInsertSensorData(compressed.points, true);
          totalCompressed += compressed.compressedCount;
        }
      }

      const uncompressedData = dataList.filter(d => !this.compressor['deviceBuffers'].get(d.deviceId)?.includes(d));
      if (uncompressedData.length > 0) {
        await this.db.batchInsertSensorData(uncompressedData, false);
      }

      callback(null, {
        success: true,
        receivedCount: dataList.length,
        compressedCount: totalCompressed,
        virtualProbeCount: totalVirtualData
      });
    } catch (error) {
      callback({
        code: grpc.status.INTERNAL,
        message: `Error processing batch data: ${(error as Error).message}`
      }, null);
    }
  }

  private async queryAnomalies(call: grpc.ServerUnaryCall<QueryAnomaliesRequest, QueryAnomaliesResponse>, callback: grpc.sendUnaryData<QueryAnomaliesResponse>): Promise<void> {
    try {
      const request = call.request;
      const gpsFence: GPSFence | undefined = request.minLat !== undefined && request.maxLat !== undefined && request.minLng !== undefined && request.maxLng !== undefined
        ? { minLat: request.minLat, maxLat: request.maxLat, minLng: request.minLng, maxLng: request.maxLng }
        : undefined;

      const anomalies = await this.db.queryAnomalies(
        request.deviceId,
        request.startTime,
        request.endTime,
        gpsFence,
        request.anomalyTypes
      );

      const contextMinutes = request.contextMinutes || 30;
      const anomaliesWithContext: Anomaly[] = [];

      for (const anomaly of anomalies) {
        const contextStartTime = anomaly.startTime - contextMinutes * 60 * 1000;
        const contextEndTime = anomaly.endTime + contextMinutes * 60 * 1000;
        const contextData = await this.db.getDeviceDataInRange(
          anomaly.deviceId,
          contextStartTime,
          contextEndTime
        );
        anomaliesWithContext.push({
          ...anomaly,
          contextData
        });
      }

      callback(null, {
        anomalies: anomaliesWithContext,
        totalCount: anomalies.length
      });
    } catch (error) {
      callback({
        code: grpc.status.INTERNAL,
        message: `Error querying anomalies: ${(error as Error).message}`
      }, null);
    }
  }

  private async getDeviceStatus(call: grpc.ServerUnaryCall<GetDeviceStatusRequest, GetDeviceStatusResponse>, callback: grpc.sendUnaryData<GetDeviceStatusResponse>): Promise<void> {
    try {
      const status = await this.db.getDeviceStatus(call.request.deviceId);
      if (!status) {
        callback({
          code: grpc.status.NOT_FOUND,
          message: 'Device not found'
        }, null);
        return;
      }
      callback(null, { status });
    } catch (error) {
      callback({
        code: grpc.status.INTERNAL,
        message: `Error getting device status: ${(error as Error).message}`
      }, null);
    }
  }

  start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const protoDescriptor = {
        service: {
          fullName: 'coldchain.ColdChainService'
        }
      };

      this.server.addService(
        protoDescriptor,
        {
          submitData: this.submitData.bind(this),
          batchSubmitData: this.batchSubmitData.bind(this),
          queryAnomalies: this.queryAnomalies.bind(this),
          getDeviceStatus: this.getDeviceStatus.bind(this)
        }
      );

      this.server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
        if (err) {
          reject(err);
        } else {
          this.server.start();
          console.log(`gRPC server started on port ${port}`);
          resolve();
        }
      });
    });
  }

  async stop(): Promise<void> {
    const allCompressed = this.compressor.flushAll(config.temperatureMaxJump);
    for (const compressed of allCompressed) {
      await this.db.batchInsertSensorData(compressed.points, true);
    }
    await this.db.close();
    this.server.forceShutdown();
    console.log('gRPC server stopped');
  }
}

export default GrpcServer;
