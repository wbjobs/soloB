import * as grpc from '@grpc/grpc-js';

class ColdChainClient {
  private client: any;

  constructor(address: string = 'localhost:50051') {
    const protoDescriptor = {
      service: {
        fullName: 'coldchain.ColdChainService'
      }
    };
    this.client = new (grpc.makeGenericClientConstructor(
      protoDescriptor,
      'ColdChainService'
    ))(address, grpc.credentials.createInsecure());
  }

  async submitData(deviceId: string, temperature: number, humidity?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.submitData({
        data: {
          deviceId,
          timestamp: Date.now(),
          temperature,
          humidity
        }
      }, (error: any, response: any) => {
        if (error) {
          reject(error);
        } else {
          console.log('Submit response:', response);
          resolve();
        }
      });
    });
  }

  async queryAnomalies(startTime: number, endTime: number, deviceId?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.queryAnomalies({
        deviceId,
        startTime,
        endTime,
        contextMinutes: 30
      }, (error: any, response: any) => {
        if (error) {
          reject(error);
        } else {
          console.log('Query anomalies response:', response);
          resolve();
        }
      });
    });
  }

  async getDeviceStatus(deviceId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.getDeviceStatus({
        deviceId
      }, (error: any, response: any) => {
        if (error) {
          reject(error);
        } else {
          console.log('Device status:', response);
          resolve();
        }
      });
    });
  }
}

async function main() {
  const client = new ColdChainClient('localhost:50051');
  
  try {
    console.log('Submitting test data...');
    await client.submitData('device-001', -20, 65);
    await client.submitData('device-001', -19, 64);
    await client.submitData('device-001', -5, 60);

    console.log('Querying anomalies...');
    const now = Date.now();
    await client.queryAnomalies(now - 3600000, now, 'device-001');

    console.log('Getting device status...');
    await client.getDeviceStatus('device-001');

  } catch (error) {
    console.error('Error:', error);
  }
}

if (require.main === module) {
  main();
}

export default ColdChainClient;
