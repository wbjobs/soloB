const FPGA_VID = 0x0403;
const FPGA_PID = 0x6014;
const CHUNK_SIZE = 1024;

const PARTITIONS = {
  A: 0x01,
  B: 0x02
};

const PARTITION_STATE = {
  VALID: 0x01,
  INVALID: 0x00,
  UNKNOWN: 0xFF
};

const COMMANDS = {
  GET_VERSION: 0x01,
  GET_CRC: 0x02,
  UPLOAD_START: 0x03,
  UPLOAD_CHUNK: 0x04,
  UPLOAD_END: 0x05,
  VERIFY: 0x06,
  UPGRADE: 0x07,
  ROLLBACK: 0x08,
  ACK: 0x0A,
  NACK: 0x0B,
  GET_PARTITION_INFO: 0x0C,
  SET_ACTIVE_PARTITION: 0x0D,
  GET_ACTIVE_PARTITION: 0x0E,
  ERASE_PARTITION: 0x0F,
  MARK_PARTITION_VALID: 0x10,
  MARK_PARTITION_INVALID: 0x11,
  GET_UPGRADE_STATUS: 0x12
};

class FpgaUsbService {
  constructor() {
    this.device = null;
    this.interfaceNumber = null;
    this.endpointIn = null;
    this.endpointOut = null;
  }

  async connect() {
    try {
      const devices = await navigator.usb.getDevices();
      let targetDevice = devices.find(d => 
        d.vendorId === FPGA_VID && d.productId === FPGA_PID
      );

      if (!targetDevice) {
        targetDevice = await navigator.usb.requestDevice({
          filters: [{ vendorId: FPGA_VID, productId: FPGA_PID }]
        });
      }

      await targetDevice.open();
      
      if (targetDevice.configuration === null) {
        await targetDevice.selectConfiguration(1);
      }

      const interfaces = targetDevice.configuration.interfaces;
      for (const iface of interfaces) {
        for (const alt of iface.alternates) {
          for (const endpoint of alt.endpoints) {
            if (endpoint.direction === 'in') {
              this.endpointIn = endpoint.endpointNumber;
            } else if (endpoint.direction === 'out') {
              this.endpointOut = endpoint.endpointNumber;
            }
          }
          if (this.endpointIn !== null && this.endpointOut !== null) {
            this.interfaceNumber = iface.interfaceNumber;
            await targetDevice.claimInterface(this.interfaceNumber);
            break;
          }
        }
      }

      this.device = targetDevice;
      return { success: true, device: targetDevice };
    } catch (error) {
      console.error('USB连接错误:', error);
      return { success: false, error: error.message };
    }
  }

  async disconnect() {
    if (this.device) {
      try {
        await this.device.close();
      } catch (e) {
        console.warn('关闭设备时出错:', e);
      }
      this.device = null;
      this.interfaceNumber = null;
      this.endpointIn = null;
      this.endpointOut = null;
    }
  }

  async sendCommand(command, data = new Uint8Array([])) {
    if (!this.device) throw new Error('设备未连接');

    const packet = new Uint8Array(1 + data.length);
    packet[0] = command;
    packet.set(data, 1);

    await this.device.transferOut(this.endpointOut, packet);
  }

  async readResponse(length = 64) {
    if (!this.device) throw new Error('设备未连接');

    const result = await this.device.transferIn(this.endpointIn, length);
    return new Uint8Array(result.data.buffer);
  }

  async getFirmwareVersion() {
    try {
      await this.sendCommand(COMMANDS.GET_VERSION);
      const response = await this.readResponse(32);
      
      if (response[0] === COMMANDS.ACK) {
        const versionStr = String.fromCharCode(...response.slice(1, response.indexOf(0) || 32));
        return versionStr || 'v1.0.0';
      }
      return '未知';
    } catch (error) {
      console.error('读取版本错误:', error);
      return '未知';
    }
  }

  async getFirmwareCRC() {
    try {
      await this.sendCommand(COMMANDS.GET_CRC);
      const response = await this.readResponse(8);
      
      if (response[0] === COMMANDS.ACK && response.length >= 5) {
        const crc = (response[1] << 24) | (response[2] << 16) | 
                    (response[3] << 8) | response[4];
        return '0x' + crc.toString(16).toUpperCase().padStart(8, '0');
      }
      return '未知';
    } catch (error) {
      console.error('读取CRC错误:', error);
      return '未知';
    }
  }

  async uploadFirmware(file, onProgress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = async (e) => {
        try {
          const firmwareData = new Uint8Array(e.target.result);
          const totalChunks = Math.ceil(firmwareData.length / CHUNK_SIZE);
          
          await this.sendCommand(COMMANDS.UPLOAD_START, new Uint8Array([
            (firmwareData.length >> 24) & 0xFF,
            (firmwareData.length >> 16) & 0xFF,
            (firmwareData.length >> 8) & 0xFF,
            firmwareData.length & 0xFF
          ]));
          
          let ack = await this.readResponse(2);
          if (ack[0] !== COMMANDS.ACK) {
            throw new Error('上传开始命令未被确认');
          }

          for (let i = 0; i < totalChunks; i++) {
            const offset = i * CHUNK_SIZE;
            const chunk = firmwareData.slice(offset, offset + CHUNK_SIZE);
            
            const chunkHeader = new Uint8Array([
              (i >> 24) & 0xFF,
              (i >> 16) & 0xFF,
              (i >> 8) & 0xFF,
              i & 0xFF
            ]);
            
            await this.sendCommand(COMMANDS.UPLOAD_CHUNK, 
              new Uint8Array([...chunkHeader, ...chunk]));
            
            ack = await this.readResponse(2);
            if (ack[0] !== COMMANDS.ACK) {
              throw new Error(`块 ${i} 上传失败`);
            }

            if (onProgress) {
              onProgress(Math.round(((i + 1) / totalChunks) * 100));
            }
          }

          await this.sendCommand(COMMANDS.UPLOAD_END);
          ack = await this.readResponse(2);
          
          resolve(ack[0] === COMMANDS.ACK);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsArrayBuffer(file);
    });
  }

  async verifyFirmware() {
    try {
      await this.sendCommand(COMMANDS.VERIFY);
      const response = await this.readResponse(2);
      return response[0] === COMMANDS.ACK;
    } catch (error) {
      console.error('验证错误:', error);
      return false;
    }
  }

  async triggerUpgrade() {
    try {
      await this.sendCommand(COMMANDS.UPGRADE);
      const response = await this.readResponse(2);
      return response[0] === COMMANDS.ACK;
    } catch (error) {
      console.error('升级触发错误:', error);
      return false;
    }
  }

  async rollbackFirmware() {
    try {
      await this.sendCommand(COMMANDS.ROLLBACK);
      const response = await this.readResponse(2);
      return response[0] === COMMANDS.ACK;
    } catch (error) {
      console.error('回滚错误:', error);
      return false;
    }
  }

  isConnected() {
    return this.device !== null;
  }

  async getActivePartition() {
    try {
      await this.sendCommand(COMMANDS.GET_ACTIVE_PARTITION);
      const response = await this.readResponse(4);
      
      if (response[0] === COMMANDS.ACK) {
        return response[1] === PARTITIONS.A ? 'A' : 'B';
      }
      return null;
    } catch (error) {
      console.error('读取激活分区错误:', error);
      return null;
    }
  }

  async getPartitionInfo(partition) {
    try {
      const partitionCode = partition === 'A' ? PARTITIONS.A : PARTITIONS.B;
      await this.sendCommand(COMMANDS.GET_PARTITION_INFO, new Uint8Array([partitionCode]));
      const response = await this.readResponse(64);
      
      if (response[0] === COMMANDS.ACK) {
        const state = response[1] === PARTITION_STATE.VALID ? 'valid' : 'invalid';
        
        let versionEnd = 2;
        while (versionEnd < response.length && response[versionEnd] !== 0) {
          versionEnd++;
        }
        const version = String.fromCharCode(...response.slice(2, versionEnd));
        
        const crcOffset = versionEnd + 1;
        const crc = (response[crcOffset] << 24) | (response[crcOffset + 1] << 16) |
                    (response[crcOffset + 2] << 8) | response[crcOffset + 3];
        
        return {
          partition,
          state,
          version: version || 'unknown',
          crc: '0x' + crc.toString(16).toUpperCase().padStart(8, '0')
        };
      }
      return null;
    } catch (error) {
      console.error(`读取分区 ${partition} 信息错误:`, error);
      return null;
    }
  }

  async getAllPartitionInfo() {
    const infoA = await this.getPartitionInfo('A');
    const infoB = await this.getPartitionInfo('B');
    const active = await this.getActivePartition();
    
    return {
      active,
      partitions: {
        A: infoA,
        B: infoB
      }
    };
  }

  getInactivePartition(activePartition) {
    return activePartition === 'A' ? 'B' : 'A';
  }

  async erasePartition(partition) {
    try {
      const partitionCode = partition === 'A' ? PARTITIONS.A : PARTITIONS.B;
      await this.sendCommand(COMMANDS.ERASE_PARTITION, new Uint8Array([partitionCode]));
      const response = await this.readResponse(2);
      return response[0] === COMMANDS.ACK;
    } catch (error) {
      console.error(`擦除分区 ${partition} 错误:`, error);
      return false;
    }
  }

  async markPartitionValid(partition, isValid = true) {
    try {
      const partitionCode = partition === 'A' ? PARTITIONS.A : PARTITIONS.B;
      const command = isValid ? COMMANDS.MARK_PARTITION_VALID : COMMANDS.MARK_PARTITION_INVALID;
      await this.sendCommand(command, new Uint8Array([partitionCode]));
      const response = await this.readResponse(2);
      return response[0] === COMMANDS.ACK;
    } catch (error) {
      console.error(`标记分区 ${partition} 状态错误:`, error);
      return false;
    }
  }

  async setActivePartition(partition) {
    try {
      const partitionCode = partition === 'A' ? PARTITIONS.A : PARTITIONS.B;
      await this.sendCommand(COMMANDS.SET_ACTIVE_PARTITION, new Uint8Array([partitionCode]));
      const response = await this.readResponse(2);
      return response[0] === COMMANDS.ACK;
    } catch (error) {
      console.error(`设置激活分区 ${partition} 错误:`, error);
      return false;
    }
  }

  async getUpgradeStatus() {
    try {
      await this.sendCommand(COMMANDS.GET_UPGRADE_STATUS);
      const response = await this.readResponse(4);
      
      if (response[0] === COMMANDS.ACK) {
        return {
          inProgress: response[1] === 0x01,
          targetPartition: response[2] === PARTITIONS.A ? 'A' : 'B',
          lastSuccess: response[3] === 0x01
        };
      }
      return null;
    } catch (error) {
      console.error('读取升级状态错误:', error);
      return null;
    }
  }

  async uploadFirmwareToPartition(file, partition, onProgress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = async (e) => {
        try {
          const firmwareData = new Uint8Array(e.target.result);
          const totalChunks = Math.ceil(firmwareData.length / CHUNK_SIZE);
          const partitionCode = partition === 'A' ? PARTITIONS.A : PARTITIONS.B;
          
          await this.sendCommand(COMMANDS.UPLOAD_START, new Uint8Array([
            partitionCode,
            (firmwareData.length >> 24) & 0xFF,
            (firmwareData.length >> 16) & 0xFF,
            (firmwareData.length >> 8) & 0xFF,
            firmwareData.length & 0xFF
          ]));
          
          let ack = await this.readResponse(2);
          if (ack[0] !== COMMANDS.ACK) {
            throw new Error('上传开始命令未被确认');
          }

          for (let i = 0; i < totalChunks; i++) {
            const offset = i * CHUNK_SIZE;
            const chunk = firmwareData.slice(offset, offset + CHUNK_SIZE);
            
            const chunkHeader = new Uint8Array([
              partitionCode,
              (i >> 24) & 0xFF,
              (i >> 16) & 0xFF,
              (i >> 8) & 0xFF,
              i & 0xFF
            ]);
            
            await this.sendCommand(COMMANDS.UPLOAD_CHUNK, 
              new Uint8Array([...chunkHeader, ...chunk]));
            
            ack = await this.readResponse(2);
            if (ack[0] !== COMMANDS.ACK) {
              throw new Error(`块 ${i} 上传失败`);
            }

            if (onProgress) {
              onProgress(Math.round(((i + 1) / totalChunks) * 100));
            }
          }

          await this.sendCommand(COMMANDS.UPLOAD_END, new Uint8Array([partitionCode]));
          ack = await this.readResponse(2);
          
          resolve(ack[0] === COMMANDS.ACK);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsArrayBuffer(file);
    });
  }

  async verifyPartition(partition) {
    try {
      const partitionCode = partition === 'A' ? PARTITIONS.A : PARTITIONS.B;
      await this.sendCommand(COMMANDS.VERIFY, new Uint8Array([partitionCode]));
      const response = await this.readResponse(2);
      return response[0] === COMMANDS.ACK;
    } catch (error) {
      console.error(`验证分区 ${partition} 错误:`, error);
      return false;
    }
  }

  async safeUpgrade(file, onProgress) {
    if (!this.isConnected()) {
      throw new Error('设备未连接');
    }

    const partitionInfo = await this.getAllPartitionInfo();
    if (!partitionInfo.active) {
      throw new Error('无法获取当前激活分区');
    }

    const targetPartition = this.getInactivePartition(partitionInfo.active);
    console.log(`开始安全升级，目标分区: ${targetPartition}`);

    try {
      if (onProgress) onProgress({ stage: 'erase', progress: 0 });
      const eraseSuccess = await this.erasePartition(targetPartition);
      if (!eraseSuccess) {
        throw new Error('擦除目标分区失败');
      }

      if (onProgress) onProgress({ stage: 'upload', progress: 0 });
      const uploadSuccess = await this.uploadFirmwareToPartition(
        file, 
        targetPartition, 
        (progress) => {
          if (onProgress) onProgress({ stage: 'upload', progress });
        }
      );
      if (!uploadSuccess) {
        await this.markPartitionValid(targetPartition, false);
        throw new Error('固件上传失败');
      }

      if (onProgress) onProgress({ stage: 'verify', progress: 0 });
      const verifySuccess = await this.verifyPartition(targetPartition);
      if (!verifySuccess) {
        await this.markPartitionValid(targetPartition, false);
        throw new Error('固件验证失败');
      }

      await this.markPartitionValid(targetPartition, true);

      if (onProgress) onProgress({ stage: 'switch', progress: 0 });
      const switchSuccess = await this.setActivePartition(targetPartition);
      if (!switchSuccess) {
        throw new Error('切换启动分区失败');
      }

      if (onProgress) onProgress({ stage: 'complete', progress: 100 });
      
      return {
        success: true,
        previousPartition: partitionInfo.active,
        newPartition: targetPartition
      };

    } catch (error) {
      console.error('安全升级失败:', error);
      await this.markPartitionValid(targetPartition, false);
      throw error;
    }
  }

  async safeRollback() {
    if (!this.isConnected()) {
      throw new Error('设备未连接');
    }

    const partitionInfo = await this.getAllPartitionInfo();
    if (!partitionInfo.active) {
      throw new Error('无法获取当前激活分区');
    }

    const fallbackPartition = this.getInactivePartition(partitionInfo.active);
    const fallbackInfo = partitionInfo.partitions[fallbackPartition];

    if (!fallbackInfo || fallbackInfo.state !== 'valid') {
      throw new Error(`分区 ${fallbackPartition} 无效，无法回滚`);
    }

    const success = await this.setActivePartition(fallbackPartition);
    
    return {
      success,
      previousPartition: partitionInfo.active,
      rollbackPartition: fallbackPartition
    };
  }
}

export default new FpgaUsbService();
export { FPGA_VID, FPGA_PID, CHUNK_SIZE };
