import React from 'react';

function DeviceConnection({ isConnected, device, onConnect, onDisconnect }) {
  return (
    <div className="connection-status">
      <div className={`status-indicator ${isConnected ? 'connected' : ''}`} />
      <span>{isConnected ? '已连接' : '未连接'}</span>
      {device && (
        <span className="device-info">
          VID: 0x{device.vendorId.toString(16).padStart(4, '0')} / PID: 0x{device.productId.toString(16).padStart(4, '0')}
        </span>
      )}
      <button 
        className={`btn ${isConnected ? 'btn-danger' : 'btn-primary'}`}
        onClick={isConnected ? onDisconnect : onConnect}
      >
        {isConnected ? '断开连接' : '连接设备'}
      </button>
    </div>
  );
}

export default DeviceConnection;
