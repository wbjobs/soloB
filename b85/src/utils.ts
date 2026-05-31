import * as crypto from 'crypto';
import * as os from 'os';
import { Netmask } from 'netmask';
import { CHUNK_SIZE, FileChunk, FileMetadata, NodeInfo } from './types';

export function calculateSHA256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function getLocalIPs(): string[] {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  
  return ips;
}

export function calculateSubnet(ip: string, mask: string = '255.255.255.0'): string {
  try {
    const block = new Netmask(`${ip}/${mask}`);
    return block.base;
  } catch {
    return ip.split('.').slice(0, 3).join('.') + '.0';
  }
}

export function isSameSubnet(ip1: string, ip2: string): boolean {
  const subnet1 = calculateSubnet(ip1);
  const subnet2 = calculateSubnet(ip2);
  return subnet1 === subnet2;
}

export function generateNodeId(): string {
  return crypto.randomBytes(20).toString('hex');
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatSpeed(bytesPerSecond: number): string {
  return formatBytes(bytesPerSecond) + '/s';
}

export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export async function splitFileIntoChunks(filePath: string, onProgress?: (current: number, total: number) => void): Promise<FileMetadata> {
  const fs = await import('fs');
  const path = await import('path');
  
  const stats = fs.statSync(filePath);
  const fileSize = stats.size;
  const chunkCount = Math.ceil(fileSize / CHUNK_SIZE);
  const chunks: FileChunk[] = [];
  
  const fileHash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(CHUNK_SIZE);
  
  for (let i = 0; i < chunkCount; i++) {
    const bytesRead = fs.readSync(fd, buffer, 0, CHUNK_SIZE, i * CHUNK_SIZE);
    const chunkData = buffer.slice(0, bytesRead);
    
    fileHash.update(chunkData);
    
    chunks.push({
      index: i,
      hash: calculateSHA256(chunkData),
      size: bytesRead
    });
    
    if (onProgress) {
      onProgress(i + 1, chunkCount);
    }
  }
  
  fs.closeSync(fd);
  
  return {
    fileName: path.basename(filePath),
    fileSize,
    fileHash: fileHash.digest('hex'),
    chunkSize: CHUNK_SIZE,
    chunkCount,
    chunks,
    createdAt: Date.now()
  };
}

export function verifyChunk(chunkData: Buffer, expectedHash: string): boolean {
  return calculateSHA256(chunkData) === expectedHash;
}

export async function verifyFile(filePath: string, metadata: FileMetadata): Promise<{ success: boolean; failedChunks: number[] }> {
  const fs = await import('fs');
  
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(CHUNK_SIZE);
  const failedChunks: number[] = [];
  
  for (let i = 0; i < metadata.chunkCount; i++) {
    const expectedChunk = metadata.chunks[i];
    const bytesRead = fs.readSync(fd, buffer, 0, expectedChunk.size, i * CHUNK_SIZE);
    const chunkData = buffer.slice(0, bytesRead);
    
    if (!verifyChunk(chunkData, expectedChunk.hash)) {
      failedChunks.push(i);
    }
  }
  
  fs.closeSync(fd);
  
  return {
    success: failedChunks.length === 0,
    failedChunks
  };
}

export function sortPeersBySubnet(localIp: string, peers: NodeInfo[]): NodeInfo[] {
  return [...peers].sort((a, b) => {
    const aSameSubnet = isSameSubnet(localIp, a.ip);
    const bSameSubnet = isSameSubnet(localIp, b.ip);
    
    if (aSameSubnet && !bSameSubnet) return -1;
    if (!aSameSubnet && bSameSubnet) return 1;
    
    return b.uploadSpeed - a.uploadSpeed;
  });
}
