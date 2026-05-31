import React from 'react';

function FirmwareInfo({ isConnected, partitionInfo, firmwareInfo, onReadInfo, onRollback, onSwitchPartition, onRefresh }) {
  const renderPartitionCard = (partition, info, isActive) => {
    if (!info) {
      return (
        <div key={partition} className="partition-card unavailable">
          <h4>分区 {partition}</h4>
          <p>信息不可用</p>
        </div>
      );
    }

    return (
      <div key={partition} className={`partition-card ${info.state} ${isActive ? 'active' : ''}`}>
        <div className="partition-header">
          <h4>分区 {partition}</h4>
          {isActive && <span className="active-badge">当前运行</span>}
        </div>
        <div className="partition-content">
          <div className="info-row">
            <span className="info-label">状态:</span>
            <span className={`info-value status-${info.state}`}>
              {info.state === 'valid' ? '✓ 有效' : '✗ 无效'}
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">版本:</span>
            <span className="info-value">{info.version}</span>
          </div>
          <div className="info-row">
            <span className="info-label">CRC:</span>
            <span className="info-value">{info.crc}</span>
          </div>
        </div>
        {!isActive && info.state === 'valid' && (
          <button 
            className="btn btn-small btn-secondary"
            onClick={() => onSwitchPartition(partition)}
          >
            切换到此分区
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="card">
      <h2>
        固件信息
        <button 
          className="btn btn-small btn-secondary refresh-btn"
          onClick={onRefresh}
          disabled={!isConnected}
        >
          刷新
        </button>
      </h2>

      {partitionInfo ? (
        <>
          <div className="partitions-grid">
            {renderPartitionCard('A', partitionInfo.partitions?.A, partitionInfo.active === 'A')}
            {renderPartitionCard('B', partitionInfo.partitions?.B, partitionInfo.active === 'B')}
          </div>
          
          <div className="partition-summary">
            <p>
              <strong>当前运行分区:</strong> {partitionInfo.active || '未知'}
            </p>
            <p>
              <strong>安全升级说明:</strong> 固件将上传到非活动分区，验证成功后自动切换。
              任何时候断电都不会变砖，系统将从备用分区启动。
            </p>
          </div>

          <div className="button-group">
            <button 
              className="btn btn-warning"
              onClick={onRollback}
              disabled={!isConnected || !canRollback(partitionInfo)}
            >
              一键回滚到备用分区
            </button>
          </div>

          {!canRollback(partitionInfo) && (
            <p className="warning-text">
              备用分区无效，无法回滚。请先确保两个分区都有有效固件。
            </p>
          )}
        </>
      ) : (
        <div className="empty-state">
          {isConnected ? '加载中...' : '请先连接设备'}
        </div>
      )}
    </div>
  );
}

function canRollback(partitionInfo) {
  if (!partitionInfo || !partitionInfo.active) return false;
  const inactivePartition = partitionInfo.active === 'A' ? 'B' : 'A';
  const inactiveInfo = partitionInfo.partitions?.[inactivePartition];
  return inactiveInfo && inactiveInfo.state === 'valid';
}

export default FirmwareInfo;
