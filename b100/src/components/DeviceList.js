import React from 'react';
import DeviceCard from './DeviceCard';

function DeviceList({ devices, onRemoveDevice, onAbortDevice, onResetDevice, onRefreshDevice, isUpgrading }) {
  if (devices.length === 0) {
    return (
      <div className="device-list-empty">
        <div className="empty-icon">📱</div>
        <h3>暂无设备</h3>
        <p>点击"添加设备"按钮连接FPGA设备</p>
      </div>
    );
  }

  return (
    <div className="device-list">
      {devices.map(device => (
        <DeviceCard
          key={device.id}
          device={device}
          onRemove={onRemoveDevice}
          onAbort={onAbortDevice}
          onReset={onResetDevice}
          onRefresh={onRefreshDevice}
          isUpgrading={isUpgrading}
        />
      ))}
    </div>
  );
}

export default DeviceList;
