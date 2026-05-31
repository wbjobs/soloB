import { useState, useCallback, useRef } from 'react';
import fpgaUsbService from '../services/fpgaUsb';

const UPGRADE_STAGES = {
  idle: '空闲',
  erase: '擦除分区',
  upload: '上传固件',
  verify: '验证固件',
  switch: '切换分区',
  complete: '完成',
  error: '错误'
};

export function useFpgaUsb() {
  const [device, setDevice] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [partitionInfo, setPartitionInfo] = useState(null);
  const [upgradeStatus, setUpgradeStatus] = useState({
    stage: 'idle',
    progress: 0,
    message: ''
  });
  const [firmwareInfo, setFirmwareInfo] = useState({
    version: null,
    crc: null,
    size: null,
    previousVersion: 'v1.0.0'
  });
  const uploadedFileRef = useRef(null);

  const loadPartitionInfo = useCallback(async () => {
    if (!fpgaUsbService.isConnected()) return false;

    try {
      const info = await fpgaUsbService.getAllPartitionInfo();
      setPartitionInfo(info);
      
      if (info.active && info.partitions[info.active]) {
        const activeInfo = info.partitions[info.active];
        setFirmwareInfo(prev => ({
          ...prev,
          version: activeInfo.version,
          crc: activeInfo.crc
        }));
      }
      
      return true;
    } catch (error) {
      console.error('加载分区信息失败:', error);
      return false;
    }
  }, []);

  const connectDevice = useCallback(async () => {
    const result = await fpgaUsbService.connect();
    if (result.success) {
      setDevice(result.device);
      setIsConnected(true);
      await loadPartitionInfo();
    }
    return result.success;
  }, [loadPartitionInfo]);

  const disconnectDevice = useCallback(async () => {
    await fpgaUsbService.disconnect();
    setDevice(null);
    setIsConnected(false);
    setPartitionInfo(null);
    setFirmwareInfo({
      version: null,
      crc: null,
      size: null,
      previousVersion: 'v1.0.0'
    });
    setUpgradeStatus({ stage: 'idle', progress: 0, message: '' });
  }, []);

  const readFirmwareInfo = useCallback(async () => {
    return await loadPartitionInfo();
  }, [loadPartitionInfo]);

  const safeUpgradeFirmware = useCallback(async (file) => {
    if (!fpgaUsbService.isConnected()) {
      setUpgradeStatus({ stage: 'error', progress: 0, message: '设备未连接' });
      return { success: false, error: '设备未连接' };
    }

    uploadedFileRef.current = file;

    try {
      const result = await fpgaUsbService.safeUpgrade(
        file,
        (status) => {
          setUpgradeStatus({
            stage: status.stage,
            progress: status.progress,
            message: UPGRADE_STAGES[status.stage] || status.stage
          });
        }
      );

      if (result.success) {
        setUpgradeStatus({
          stage: 'complete',
          progress: 100,
          message: `升级成功！已从分区 ${result.previousPartition} 切换到 ${result.newPartition}`
        });
        await loadPartitionInfo();
      }

      return result;
    } catch (error) {
      setUpgradeStatus({
        stage: 'error',
        progress: 0,
        message: `升级失败: ${error.message}`
      });
      return { success: false, error: error.message };
    }
  }, [loadPartitionInfo]);

  const safeRollbackFirmware = useCallback(async () => {
    if (!fpgaUsbService.isConnected()) return { success: false, error: '设备未连接' };

    try {
      const result = await fpgaUsbService.safeRollback();
      
      if (result.success) {
        await loadPartitionInfo();
      }

      return result;
    } catch (error) {
      console.error('回滚失败:', error);
      return { success: false, error: error.message };
    }
  }, [loadPartitionInfo]);

  const switchPartition = useCallback(async (partition) => {
    if (!fpgaUsbService.isConnected()) return false;

    try {
      const success = await fpgaUsbService.setActivePartition(partition);
      if (success) {
        await loadPartitionInfo();
      }
      return success;
    } catch (error) {
      console.error('切换分区失败:', error);
      return false;
    }
  }, [loadPartitionInfo]);

  const refreshPartitionInfo = useCallback(async () => {
    return await loadPartitionInfo();
  }, [loadPartitionInfo]);

  return {
    device,
    isConnected,
    firmwareInfo,
    partitionInfo,
    upgradeStatus,
    connectDevice,
    disconnectDevice,
    readFirmwareInfo,
    safeUpgradeFirmware,
    safeRollbackFirmware,
    switchPartition,
    refreshPartitionInfo
  };
}
