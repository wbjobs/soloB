import fpgaUsbService from './fpgaUsb';
import deviceManager, { DEVICE_STATUS } from './deviceManager';

const UPGRADE_STAGES = {
  IDLE: 'idle',
  ERASE: 'erase',
  UPLOAD: 'upload',
  VERIFY: 'verify',
  SWITCH: 'switch',
  COMPLETE: 'complete',
  ERROR: 'error'
};

class BatchUpgradeService {
  constructor() {
    this.upgradePromises = new Map();
    this.abortControllers = new Map();
    this.firmwareFile = null;
    this.listeners = new Set();
  }

  addListener(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyListeners(event, data) {
    this.listeners.forEach(listener => listener(event, data));
  }

  setFirmwareFile(file) {
    this.firmwareFile = file;
  }

  async upgradeDevice(deviceId, abortSignal) {
    const device = deviceManager.getDevice(deviceId);
    if (!device) {
      throw new Error('设备不存在');
    }

    if (!this.firmwareFile) {
      throw new Error('未选择固件文件');
    }

    deviceManager.updateDeviceStatus(deviceId, DEVICE_STATUS.UPGRADING);

    try {
      if (abortSignal.aborted) {
        throw new Error('升级已取消');
      }

      // 步骤1: 擦除分区
      this.notifyListeners('stage', { deviceId, stage: UPGRADE_STAGES.ERASE, progress: 5 });
      deviceManager.updateDeviceProgress(deviceId, 5);

      const partitionInfo = await fpgaUsbService.getAllPartitionInfo();
      const targetPartition = partitionInfo.active === 'A' ? 'B' : 'A';
      
      const eraseSuccess = await fpgaUsbService.erasePartition(targetPartition);
      if (!eraseSuccess) {
        throw new Error('擦除分区失败');
      }

      if (abortSignal.aborted) {
        throw new Error('升级已取消');
      }

      // 步骤2: 上传固件
      this.notifyListeners('stage', { deviceId, stage: UPGRADE_STAGES.UPLOAD, progress: 10 });
      deviceManager.updateDeviceProgress(deviceId, 10);

      await this.uploadFirmwareWithProgress(deviceId, this.firmwareFile, targetPartition, abortSignal);

      if (abortSignal.aborted) {
        throw new Error('升级已取消');
      }

      // 步骤3: 验证固件
      this.notifyListeners('stage', { deviceId, stage: UPGRADE_STAGES.VERIFY, progress: 85 });
      deviceManager.updateDeviceProgress(deviceId, 85);
      deviceManager.updateDeviceStatus(deviceId, DEVICE_STATUS.VERIFYING);

      const verifySuccess = await fpgaUsbService.verifyPartition(targetPartition);
      if (!verifySuccess) {
        throw new Error('固件验证失败');
      }

      if (abortSignal.aborted) {
        throw new Error('升级已取消');
      }

      // 步骤4: 标记有效并切换分区
      this.notifyListeners('stage', { deviceId, stage: UPGRADE_STAGES.SWITCH, progress: 95 });
      deviceManager.updateDeviceProgress(deviceId, 95);

      await fpgaUsbService.markPartitionValid(targetPartition, true);
      const switchSuccess = await fpgaUsbService.setActivePartition(targetPartition);
      if (!switchSuccess) {
        throw new Error('切换启动分区失败');
      }

      // 完成
      this.notifyListeners('stage', { deviceId, stage: UPGRADE_STAGES.COMPLETE, progress: 100 });
      deviceManager.updateDeviceProgress(deviceId, 100);
      deviceManager.updateDeviceStatus(deviceId, DEVICE_STATUS.SUCCESS);
      deviceManager.refreshDeviceInfo(deviceId);

      return { success: true, deviceId };

    } catch (error) {
      this.notifyListeners('stage', { deviceId, stage: UPGRADE_STAGES.ERROR, progress: 0 });
      deviceManager.updateDeviceStatus(deviceId, DEVICE_STATUS.FAILED, error.message);
      deviceManager.updateDeviceProgress(deviceId, 0);
      throw error;
    }
  }

  async uploadFirmwareWithProgress(deviceId, file, partition, abortSignal) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const firmwareData = new Uint8Array(e.target.result);
          const totalChunks = Math.ceil(firmwareData.length / 1024);
          
          await fpgaUsbService.sendCommand(0x03, new Uint8Array([
            partition === 'A' ? 0x01 : 0x02,
            (firmwareData.length >> 24) & 0xFF,
            (firmwareData.length >> 16) & 0xFF,
            (firmwareData.length >> 8) & 0xFF,
            firmwareData.length & 0xFF
          ]));
          
          let ack = await fpgaUsbService.readResponse(2);
          if (ack[0] !== 0x0A) {
            throw new Error('上传开始命令未被确认');
          }

          for (let i = 0; i < totalChunks; i++) {
            if (abortSignal.aborted) {
              throw new Error('升级已取消');
            }

            const offset = i * 1024;
            const chunk = firmwareData.slice(offset, offset + 1024);
            
            const chunkHeader = new Uint8Array([
              partition === 'A' ? 0x01 : 0x02,
              (i >> 24) & 0xFF,
              (i >> 16) & 0xFF,
              (i >> 8) & 0xFF,
              i & 0xFF
            ]);
            
            await fpgaUsbService.sendCommand(0x04, new Uint8Array([...chunkHeader, ...chunk]));
            
            ack = await fpgaUsbService.readResponse(2);
            if (ack[0] !== 0x0A) {
              throw new Error(`块 ${i} 上传失败`);
            }

            deviceManager.updateBytesTransferred(deviceId, chunk.length);
            
            const progress = 10 + Math.round(((i + 1) / totalChunks) * 75);
            deviceManager.updateDeviceProgress(deviceId, progress);
          }

          await fpgaUsbService.sendCommand(0x05, new Uint8Array([partition === 'A' ? 0x01 : 0x02]));
          ack = await fpgaUsbService.readResponse(2);
          
          if (ack[0] === 0x0A) {
            resolve();
          } else {
            throw new Error('上传结束命令未被确认');
          }
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsArrayBuffer(file);
    });
  }

  async startBatchUpgrade(deviceIds) {
    if (!this.firmwareFile) {
      throw new Error('请先选择固件文件');
    }

    const results = [];
    
    const upgradePromises = deviceIds.map(async (deviceId) => {
      const abortController = new AbortController();
      this.abortControllers.set(deviceId, abortController);

      try {
        const result = await this.upgradeDevice(deviceId, abortController.signal);
        results.push(result);
        return result;
      } catch (error) {
        return { success: false, deviceId, error: error.message };
      } finally {
        this.abortControllers.delete(deviceId);
      }
    });

    const allResults = await Promise.allSettled(upgradePromises);
    return allResults;
  }

  abortDeviceUpgrade(deviceId) {
    const abortController = this.abortControllers.get(deviceId);
    if (abortController) {
      abortController.abort();
      this.abortControllers.delete(deviceId);
      return true;
    }
    return false;
  }

  abortAllUpgrades() {
    this.abortControllers.forEach((controller) => {
      controller.abort();
    });
    this.abortControllers.clear();
  }

  getUpgradeStatus(deviceId) {
    return deviceManager.getDevice(deviceId);
  }

  getBatchStatus() {
    const devices = deviceManager.getDevicesList();
    const total = devices.length;
    const success = devices.filter(d => d.status === DEVICE_STATUS.SUCCESS).length;
    const failed = devices.filter(d => d.status === DEVICE_STATUS.FAILED).length;
    const upgrading = devices.filter(d => 
      d.status === DEVICE_STATUS.UPGRADING || d.status === DEVICE_STATUS.VERIFYING
    ).length;
    const pending = devices.filter(d => d.status === DEVICE_STATUS.CONNECTED).length;

    return {
      total,
      success,
      failed,
      upgrading,
      pending,
      isAllComplete: upgrading === 0 && pending === 0,
      successRate: total > 0 ? ((success / total) * 100).toFixed(1) : 0
    };
  }

  resetDeviceStatus(deviceId) {
    deviceManager.updateDeviceStatus(deviceId, DEVICE_STATUS.CONNECTED);
    deviceManager.updateDeviceProgress(deviceId, 0);
  }

  resetAllStatus() {
    const devices = deviceManager.getDevicesList();
    devices.forEach(device => {
      if (device.status !== DEVICE_STATUS.UPGRADING && device.status !== DEVICE_STATUS.VERIFYING) {
        this.resetDeviceStatus(device.id);
      }
    });
  }
}

export default new BatchUpgradeService();
export { UPGRADE_STAGES };
