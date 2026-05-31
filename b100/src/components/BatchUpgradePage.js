import React from 'react';
import { useBatchUpgrade } from '../hooks/useBatchUpgrade';
import BatchUpgradePanel from './BatchUpgradePanel';
import DeviceList from './DeviceList';
import { addLog } from '../services/indexedDB';

function BatchUpgradePage() {
  const {
    devices,
    selectedFirmware,
    isUpgrading,
    batchStatus,
    maxDevices,
    addDevice,
    removeDevice,
    removeAllDevices,
    setFirmwareFile,
    startBatchUpgrade,
    abortAllUpgrades,
    abortDeviceUpgrade,
    resetDeviceStatus,
    refreshDeviceInfo,
    canConnectMore
  } = useBatchUpgrade();

  const handleAddDevice = async () => {
    try {
      const result = await addDevice();
      if (result.success) {
        await addLog({
          timestamp: new Date().toISOString(),
          type: 'success',
          version: '设备连接',
          message: `成功连接 ${result.device?.name || '设备'}`
        });
      } else {
        await addLog({
          timestamp: new Date().toISOString(),
          type: 'error',
          version: '设备连接',
          message: `连接失败: ${result.error}`
        });
      }
    } catch (error) {
      alert(error.message);
    }
  };

  const handleRemoveDevice = async (deviceId) => {
    const device = devices.find(d => d.id === deviceId);
    await removeDevice(deviceId);
    await addLog({
      timestamp: new Date().toISOString(),
      type: 'info',
      version: '设备断开',
      message: `已断开 ${device?.name || '设备'}`
    });
  };

  const handleStartUpgrade = async () => {
    try {
      await addLog({
        timestamp: new Date().toISOString(),
        type: 'info',
        version: '批量升级',
        message: `开始批量升级 ${selectedFirmware?.name}`
      });

      const results = await startBatchUpgrade();
      
      const successCount = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
      const failCount = results.length - successCount;

      await addLog({
        timestamp: new Date().toISOString(),
        type: failCount === 0 ? 'success' : 'error',
        version: '批量升级',
        message: `升级完成: 成功 ${successCount}, 失败 ${failCount}`
      });
    } catch (error) {
      await addLog({
        timestamp: new Date().toISOString(),
        type: 'error',
        version: '批量升级',
        message: `升级失败: ${error.message}`
      });
    }
  };

  return (
    <div className="batch-upgrade-page">
      <div className="page-content">
        <div className="sidebar-panel">
          <BatchUpgradePanel
            devices={devices}
            selectedFirmware={selectedFirmware}
            isUpgrading={isUpgrading}
            batchStatus={batchStatus}
            maxDevices={maxDevices}
            onAddDevice={handleAddDevice}
            onRemoveAll={removeAllDevices}
            onSetFirmware={setFirmwareFile}
            onStartUpgrade={handleStartUpgrade}
            onAbortAll={abortAllUpgrades}
            canConnectMore={canConnectMore}
          />
        </div>
        <div className="main-panel">
          <DeviceList
            devices={devices}
            onRemoveDevice={handleRemoveDevice}
            onAbortDevice={abortDeviceUpgrade}
            onResetDevice={resetDeviceStatus}
            onRefreshDevice={refreshDeviceInfo}
            isUpgrading={isUpgrading}
          />
        </div>
      </div>
    </div>
  );
}

export default BatchUpgradePage;
