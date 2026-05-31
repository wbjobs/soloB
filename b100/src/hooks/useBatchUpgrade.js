import { useState, useEffect, useCallback } from 'react';
import deviceManager, { MAX_DEVICES, DEVICE_STATUS } from '../services/deviceManager';
import batchUpgradeService from '../services/batchUpgradeService';

export function useBatchUpgrade() {
  const [devices, setDevices] = useState([]);
  const [selectedFirmware, setSelectedFirmware] = useState(null);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [batchStatus, setBatchStatus] = useState(null);

  useEffect(() => {
    const removeListener = deviceManager.addListener((updatedDevices) => {
      setDevices([...updatedDevices]);
      setBatchStatus(batchUpgradeService.getBatchStatus());
    });

    return removeListener;
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setBatchStatus(batchUpgradeService.getBatchStatus());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const addDevice = useCallback(async () => {
    if (!deviceManager.canConnectMore()) {
      throw new Error(`最多支持连接 ${MAX_DEVICES} 个设备`);
    }
    return await deviceManager.connectDevice();
  }, []);

  const removeDevice = useCallback(async (deviceId) => {
    batchUpgradeService.abortDeviceUpgrade(deviceId);
    return await deviceManager.disconnectDevice(deviceId);
  }, []);

  const removeAllDevices = useCallback(async () => {
    batchUpgradeService.abortAllUpgrades();
    return await deviceManager.disconnectAll();
  }, []);

  const setFirmwareFile = useCallback((file) => {
    setSelectedFirmware(file);
    batchUpgradeService.setFirmwareFile(file);
  }, []);

  const startBatchUpgrade = useCallback(async (selectedDeviceIds = null) => {
    if (!selectedFirmware) {
      throw new Error('请先选择固件文件');
    }

    const deviceIds = selectedDeviceIds || devices
      .filter(d => d.status === DEVICE_STATUS.CONNECTED)
      .map(d => d.id);

    if (deviceIds.length === 0) {
      throw new Error('没有可升级的设备');
    }

    setIsUpgrading(true);
    batchUpgradeService.resetAllStatus();

    const results = await batchUpgradeService.startBatchUpgrade(deviceIds);
    setIsUpgrading(false);
    setBatchStatus(batchUpgradeService.getBatchStatus());

    return results;
  }, [devices, selectedFirmware]);

  const abortAllUpgrades = useCallback(() => {
    batchUpgradeService.abortAllUpgrades();
  }, []);

  const abortDeviceUpgrade = useCallback((deviceId) => {
    batchUpgradeService.abortDeviceUpgrade(deviceId);
  }, []);

  const resetDeviceStatus = useCallback((deviceId) => {
    batchUpgradeService.resetDeviceStatus(deviceId);
  }, []);

  const refreshDeviceInfo = useCallback(async (deviceId) => {
    await deviceManager.refreshDeviceInfo(deviceId);
  }, []);

  const getConnectedDeviceCount = useCallback(() => {
    return deviceManager.getConnectedCount();
  }, []);

  const canConnectMore = useCallback(() => {
    return deviceManager.canConnectMore();
  }, []);

  return {
    devices,
    selectedFirmware,
    isUpgrading,
    batchStatus,
    maxDevices: MAX_DEVICES,
    deviceStatus: DEVICE_STATUS,
    addDevice,
    removeDevice,
    removeAllDevices,
    setFirmwareFile,
    startBatchUpgrade,
    abortAllUpgrades,
    abortDeviceUpgrade,
    resetDeviceStatus,
    refreshDeviceInfo,
    getConnectedDeviceCount,
    canConnectMore
  };
}
