import React, { useState, useRef } from 'react';

function FirmwareUpload({ isConnected, onUpload, onUploadComplete, upgradeStatus, partitionInfo }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file && file.name.endsWith('.bit')) {
      setSelectedFile(file);
    } else {
      alert('请选择 .bit 格式的固件文件');
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.bit')) {
      setSelectedFile(file);
    } else {
      alert('请选择 .bit 格式的固件文件');
    }
  };

  const handleSafeUpgrade = async () => {
    if (!selectedFile || !isConnected || isUploading) return;
    
    setIsUploading(true);
    
    try {
      const result = await onUpload(selectedFile);
      
      if (result.success) {
        onUploadComplete(true, selectedFile.name, 
          `安全升级成功！已切换到新分区`);
      } else {
        onUploadComplete(false, selectedFile.name, 
          `安全升级失败: ${result.error || '未知错误'}`);
      }
    } catch (error) {
      onUploadComplete(false, selectedFile.name, `升级错误: ${error.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const getTargetPartition = () => {
    if (!partitionInfo || !partitionInfo.active) return '未知';
    return partitionInfo.active === 'A' ? 'B' : 'A';
  };

  const getStageProgress = () => {
    switch (upgradeStatus.stage) {
      case 'erase': return 10;
      case 'upload': return 10 + upgradeStatus.progress * 0.6;
      case 'verify': return 75;
      case 'switch': return 90;
      case 'complete': return 100;
      default: return 0;
    }
  };

  return (
    <div className="card">
      <h2>安全升级 (A/B 双备份)</h2>

      <div className="upgrade-info">
        <div className="info-row">
        <span className="info-label">目标分区:</span>
        <span className="info-value highlight">分区 {getTargetPartition()}</span>
      </div>
      <p className="info-text">
        <strong>安全保障:</strong> 固件将上传到非活动分区，只有验证通过后才会切换启动分区。
        升级过程中任何时候断电都不会变砖，系统将从原分区启动。
      </p>
      </div>
      
      <div 
        className={`file-upload-area ${isDragging ? 'dragover' : ''}`}
        onClick={() => !isUploading && fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".bit"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
          disabled={isUploading}
        />
        <p>点击或拖拽 .bit 固件文件到此处</p>
      </div>
      
      {selectedFile && (
        <div className="file-info">
          <div className="file-name">{selectedFile.name}</div>
          <div className="file-size">文件大小: {(selectedFile.size / 1024).toFixed(2)} KB</div>
        </div>
      )}
      
      {isUploading && (
        <div className="upgrade-progress">
          <div className="progress-stage">
            <strong>当前阶段: {upgradeStatus.message}
          </div>
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${getStageProgress()}%` }}
            />
          </div>
          <div className="progress-text">
            {Math.round(getStageProgress())}%
          </div>
        </div>
      )}
      
      <div className="button-group">
        <button 
          className="btn btn-primary"
          onClick={handleSafeUpgrade}
          disabled={!isConnected || !selectedFile || isUploading}
        >
          {isUploading ? '升级中...' : '开始安全升级'}
        </button>
      </div>

      <div className="upgrade-steps">
        <h4>升级步骤:</h4>
        <ol>
          <li className={upgradeStatus.stage === 'erase' ? 'active' : ''}>擦除目标分区</li>
          <li className={upgradeStatus.stage === 'upload' ? 'active' : ''}>上传固件 (1024字节分块)</li>
          <li className={upgradeStatus.stage === 'verify' ? 'active' : ''}>验证固件完整性</li>
          <li className={upgradeStatus.stage === 'switch' ? 'active' : ''}>标记分区有效</li>
          <li className={upgradeStatus.stage === 'switch' ? 'active' : ''}>切换启动分区</li>
          <li className={upgradeStatus.stage === 'complete' ? 'active' : ''}>完成</li>
        </ol>
      </div>
    </div>
  );
}

export default FirmwareUpload;
