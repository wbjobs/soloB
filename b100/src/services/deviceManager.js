import fpgaUsbService from './fpgaUsb';

const MAX_DEVICES = 10;

const DEVICE_STATUS = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  UPGRADING: 'upgrading',
  VERIFYING: 'verifying',
  SUCCESS: 'success',
  FAILED: 'failed'
};

class DeviceManager {
  constructor() {
    this.devices = new Map();
    this.deviceCounter = 0;
    this.listeners = new Set();
  }

  notifyListeners() {
    this.listeners.forEach(listener => listener(this.getDevicesList()));
  }

  addListener(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getDevicesList() {
    return Array.from(this.devices.values());
  }

  getConnectedCount() {
    return Array.from(this.devices.values()).filter(d => 
      d.status === DEVICE_STATUS.CONNECTED || 
      d.status === DEVICE_STATUS.UPGRADING ||
      d.status === DEVICE_STATUS.VERIFYING
    ).length;
  }

  canConnectMore() {
    return this.getConnectedCount() < MAX_DEVICES;
  }

  async connectDevice() {
    if (!this.canConnectMore()) {
      throw new Error(`最多支持连接 ${MAX_DEVICES} 个设备`);
    }

    const deviceId = `device_${++this.deviceCounter}`;
    const deviceInfo = {
      id: deviceId,
      name: `FPGA #${this.deviceCounter}`,
      status: DEVICE_STATUS.CONNECTING,
      progress: 0,
      throughput: 0,
      startTime: null,
      bytesTransferred: 0,
      error: null,
      partitionInfo: null,
      usbDevice: null
    };

    this.devices.set(deviceId, deviceInfo);
    this.notifyListeners();

    try {
      const result = await fpgaUsbService.connect();
      
      if (result.success) {
        const partitionInfo = await fpgaUsbService.getAllPartitionInfo();
        
        this.devices.set(deviceId, {
          ...deviceInfo,
          status: DEVICE_STATUS.CONNECTED,
          partitionInfo,
          usbDevice: result.device,
          vendorId: result.device.vendorId,
          productId: result.device.productId
        });
        this.notifyListeners();
        return { success: true, deviceId };
      } else {
        this.devices.delete(deviceId);
        this.notifyListeners();
        return { success: false, error: '连接失败' };
      }
    } catch (error) {
      this.devices.delete(deviceId);
      this.notifyListeners();
      return { success: false, error: error.message };
    }
  }

  async disconnectDevice(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) return false;

    try {
      await fpgaUsbService.disconnect();
    } catch (e) {
      console.warn('断开连接时出错:', e);
    }

    this.devices.delete(deviceId);
    this.notifyListeners();
    return true;
  }

  updateDeviceProgress(deviceId, progress, throughput = 0) {
    const device = this.devices.get(deviceId);
    if (!device) return;

    this.devices.set(deviceId, {
      ...device,
      progress,
      throughput
    });
    this.notifyListeners();
  }

  updateDeviceStatus(deviceId, status, error = null) {
    const device = this.devices.get(deviceId);
    if (!device) return;

    this.devices.set(deviceId, {
      ...device,
      status,
      error,
      startTime: status === DEVICE_STATUS.UPGRADING ? Date.now() : device.startTime,
      bytesTransferred: status === DEVICE_STATUS.UPGRADING ? 0 : device.bytesTransferred
    });
    this.notifyListeners();
  }

  updateBytesTransferred(deviceId, bytes) {
    const device = this.devices.get(deviceId);
    if (!device) return;

    const newBytes = device.bytesTransferred + bytes;
    const elapsed = (Date.now() - device.startTime) / 1000;
    const throughput = elapsed > 0 ? (newBytes / 1024 / elapsed).toFixed(2) : 0;

    this.devices.set(deviceId, {
      ...device,
      bytesTransferred: newBytes,
      throughput: parseFloat(throughput)
    });
    this.notifyListeners();
  }

  async refreshDeviceInfo(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) return;

    try {
      const partitionInfo = await fpgaUsbService.getAllPartitionInfo();
      this.devices.set(deviceId, {
        ...device,
        partitionInfo
      });
      this.notifyListeners();
    } catch (error) {
      console.error('刷新设备信息失败:', error);
    }
  }

  getDevice(deviceId) {
    return this.devices.get(deviceId);
  }

  disconnectAll() {
    const promises = Array.from(this.devices.keys()).map(id => 
      this.disconnectDevice(id)
    );
    return Promise.all(promises);
  }
}

export default new DeviceManager();
export { MAX_DEVICES, DEVICE_STATUS };
