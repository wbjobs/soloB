import React, { useRef } from 'react';

function BatchUpgradePanel({
  devices,
  selectedFirmware,
  isUpgrading,
  batchStatus,
  maxDevices,
  onAddDevice,
  onRemoveAll,
  onSetFirmware,
  onStartUpgrade,
  onAbortAll,
  canConnectMore
}) {
  const fileInputRef = useRef(null);

  const connectedCount = devices.length;
  const upgradableCount = devices.filter(d => d.status === 'connected').length;

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file && file.name.endsWith('.bit')) {
      onSetFirmware(file);
    } else {
      alert('请选择 .bit 格式的固件文件');
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.bit')) {
      onSetFirmware(file);
    } else {
      alert('请选择 .bit 格式的固件文件');
    }
  };

  return (
    <div className="batch-upgrade-panel">
      <div className="panel-header">
        <h2>批量升级</h2>
        <div className="device-count">
          {connectedCount} / {maxDevices} 设备
        </div>
      </div>

      {batchStatus && (
        <div className="batch-status">
          <div className="status-row">
            <span className="status-item success">
              ✓ 成功: {batchStatus.success}
            </span>
            <span className="status-item failed">
              ✗ 失败: {batchStatus.failed}
            </span>
            <span className="status-item upgrading">
              ↑ 升级中: {batchStatus.upgrading}
            </span>
            <span className="status-item pending">
              ○ 等待: {batchStatus.pending}
            </span>
          </div>
          {batchStatus.total > 0 && (
            <div className="success-rate">
              成功率: {batchStatus.successRate}%
            </div>
          )}
        </div>
      )}

      <div className="firmware-section">
        <h3>固件文件</h3>
        <div
          className="firmware-dropzone"
          onClick={() => !isUpgrading && fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".bit"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
            disabled={isUpgrading}
          />
          {selectedFirmware ? (
            <div className="firmware-info">
              <div className="firmware-name">📦 {selectedFirmware.name}</div>
              <div className="firmware-size">
                {(selectedFirmware.size / 1024).toFixed(2)} KB
              </div>
            </div>
          ) : (
            <div className="firmware-placeholder">
              点击或拖拽 .bit 文件到此处
            </div>
          )}
        </div>
      </div>

      <div className="action-buttons">
        <button
          className="btn btn-primary"
          onClick={onAddDevice}
          disabled={isUpgrading || !canConnectMore}
        >
          + 添加设备
        </button>
        <button
          className="btn btn-success"
          onClick={onStartUpgrade}
          disabled={isUpgrading || !selectedFirmware || upgradableCount === 0}
        >
          {isUpgrading ? '升级中...' : `开始升级 (${upgradableCount})`}
        </button>
        {isUpgrading && (
          <button
            className="btn btn-danger"
            onClick={onAbortAll}
          >
            全部取消
          </button>
        )}
        <button
          className="btn btn-secondary"
          onClick={onRemoveAll}
          disabled={isUpgrading || connectedCount === 0}
        >
          断开全部
        </button>
      </div>

      {!canConnectMore && (
        <div className="warning-message">
          ⚠️ 已达到最大设备数量限制 ({maxDevices}个)
        </div>
      )}

      {selectedFirmware && upgradableCount === 0 && connectedCount > 0 && (
        <div className="warning-message">
          ⚠️ 没有可升级的设备，请确保设备处于已连接状态
        </div>
      )}
    </div>
  );
}

export default BatchUpgradePanel;
