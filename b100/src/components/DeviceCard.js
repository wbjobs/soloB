import React from 'react';
import { DEVICE_STATUS } from '../services/deviceManager';

function DeviceCard({ device, onRemove, onAbort, onReset, onRefresh, isUpgrading }) {
  const getStatusColor = () => {
    switch (device.status) {
      case DEVICE_STATUS.CONNECTED: return 'status-connected';
      case DEVICE_STATUS.CONNECTING: return 'status-connecting';
      case DEVICE_STATUS.UPGRADING: return 'status-upgrading';
      case DEVICE_STATUS.VERIFYING: return 'status-verifying';
      case DEVICE_STATUS.SUCCESS: return 'status-success';
      case DEVICE_STATUS.FAILED: return 'status-failed';
      default: return 'status-disconnected';
    }
  };

  const getStatusText = () => {
    switch (device.status) {
      case DEVICE_STATUS.CONNECTED: return '已连接';
      case DEVICE_STATUS.CONNECTING: return '连接中...';
      case DEVICE_STATUS.UPGRADING: return '升级中...';
      case DEVICE_STATUS.VERIFYING: return '验证中...';
      case DEVICE_STATUS.SUCCESS: return '升级成功';
      case DEVICE_STATUS.FAILED: return '升级失败';
      default: return '已断开';
    }
  };

  const getStatusIcon = () => {
    switch (device.status) {
      case DEVICE_STATUS.CONNECTED: return '●';
      case DEVICE_STATUS.CONNECTING: return '◐';
      case DEVICE_STATUS.UPGRADING: return '↑';
      case DEVICE_STATUS.VERIFYING: return '✓';
      case DEVICE_STATUS.SUCCESS: return '✓';
      case DEVICE_STATUS.FAILED: return '✗';
      default: return '○';
    }
  };

  const canAbort = device.status === DEVICE_STATUS.UPGRADING || device.status === DEVICE_STATUS.VERIFYING;
  const canReset = device.status === DEVICE_STATUS.SUCCESS || device.status === DEVICE_STATUS.FAILED;

  return (
    <div className={`device-card ${getStatusColor()}`}>
      <div className="device-header">
        <div className="device-title">
          <span className={`status-icon ${getStatusColor()}`}>
            {getStatusIcon()}
          </span>
          <span className="device-name">{device.name}</span>
        </div>
        <div className="device-actions">
          {canAbort && (
            <button
              className="btn btn-small btn-danger"
              onClick={() => onAbort(device.id)}
              title="取消升级"
            >
              取消
            </button>
          )}
          {canReset && (
            <button
              className="btn btn-small btn-secondary"
              onClick={() => onReset(device.id)}
              title="重置状态"
            >
              重置
            </button>
          )}
          <button
            className="btn btn-small btn-secondary"
            onClick={() => onRefresh(device.id)}
            disabled={canAbort}
            title="刷新信息"
          >
            ↻
          </button>
          <button
            className="btn btn-small btn-danger"
            onClick={() => onRemove(device.id)}
            disabled={canAbort}
            title="断开连接"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="device-info">
        {device.vendorId && (
          <div className="info-item">
            <span className="info-label">VID/PID:</span>
            <span className="info-value">
              0x{device.vendorId.toString(16).padStart(4, '0')} / 0x{device.productId.toString(16).padStart(4, '0')}
            </span>
          </div>
        )}

        {device.partitionInfo && (
          <div className="info-item">
            <span className="info-label">活动分区:</span>
            <span className="info-value">{device.partitionInfo.active}</span>
          </div>
        )}

        {device.status === DEVICE_STATUS.UPGRADING || device.status === DEVICE_STATUS.VERIFYING ? (
          <>
            <div className="progress-container">
              <div className="progress-header">
                <span className="progress-label">进度</span>
                <span className="progress-percent">{device.progress}%</span>
              </div>
              <div className="progress-bar-wide">
                <div
                  className="progress-fill"
                  style={{ width: `${device.progress}%` }}
                />
              </div>
            </div>
            <div className="throughput-info">
              <span className="throughput-label">传输速度:</span>
              <span className="throughput-value">{device.throughput} KB/s</span>
              <span className="bytes-label">已传输:</span>
              <span className="bytes-value">{(device.bytesTransferred / 1024).toFixed(1)} KB</span>
            </div>
          </>
        ) : (
          <div className={`status-badge ${getStatusColor()}`}>
            {getStatusText()}
          </div>
        )}

        {device.error && (
          <div className="error-message">
            {device.error}
          </div>
        )}
      </div>
    </div>
  );
}

export default DeviceCard;
