export const CHUNK_SIZE = 1024 * 1024; // 1MB

export interface EncryptedChunk {
  index: number;
  iv: string;
  tag: string;
  data: string;
  hash: string;
}

export interface AuthMessage {
  type: 'auth_request' | 'auth_response' | 'auth_challenge';
  nodeId: string;
  token?: string;
  publicKey?: string;
  challenge?: string;
  signature?: string;
  aesKey?: string;
}

export interface FileChunk {
  index: number;
  hash: string;
  size: number;
  data?: Buffer;
}

export interface FileMetadata {
  fileName: string;
  fileSize: number;
  fileHash: string;
  chunkSize: number;
  chunkCount: number;
  chunks: FileChunk[];
  createdAt: number;
}

export interface NodeInfo {
  id: string;
  ip: string;
  port: number;
  subnet: string;
  lastSeen: number;
  availableChunks: Set<number>;
  uploadSpeed: number;
  downloadSpeed: number;
}

export interface PeerConnection {
  nodeId: string;
  socket: any;
  nodeInfo: NodeInfo;
  connectedAt: number;
}

export interface TransferStats {
  totalChunks: number;
  downloadedChunks: number;
  uploadedChunks: number;
  bytesDownloaded: number;
  bytesUploaded: number;
  startTime: number;
  currentSpeed: number;
  averageSpeed: number;
  connectedPeers: number;
}

export interface TorrentInfo {
  infoHash: string;
  metadata: FileMetadata;
  trackerUrls: string[];
  dhtNodes: string[];
  encryptedAESKey?: string;
  publicKey?: string;
}

export interface TrackerAnnounceRequest {
  infoHash: string;
  nodeId: string;
  ip: string;
  port: number;
  event: 'started' | 'stopped' | 'completed';
  downloaded: number;
  uploaded: number;
  left: number;
}

export interface TrackerAnnounceResponse {
  peers: NodeInfo[];
  interval: number;
  complete: number;
  incomplete: number;
}

export interface DHTMessage {
  type: 'ping' | 'find_node' | 'get_peers' | 'announce_peer';
  id: string;
  target?: string;
  infoHash?: string;
  port?: number;
  token?: string;
}
