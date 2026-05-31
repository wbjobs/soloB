import * as tls from 'tls';
import * as fs from 'fs';
import { FileMetadata, NodeInfo, TransferStats, TrackerAnnounceResponse, EncryptedChunk, AuthMessage } from './types';
import { calculateSHA256, generateNodeId, getLocalIPs, sortPeersBySubnet, verifyChunk } from './utils';
import {
  generateJWT,
  verifyJWT,
  generateAESKey,
  setGlobalAESKey,
  getGlobalAESKey,
  encryptChunkAES256GCM,
  decryptChunkAES256GCM,
  verifyEncryptedChunkHash,
  getTLSServerOptions,
  getTLSClientOptions,
  generateRSAKeyPair,
  signData,
  verifySignature
} from './crypto';

interface PeerMessage {
  type: 'handshake' | 'bitfield' | 'have' | 'request' | 'piece' | 'piece_encrypted' | 'cancel' | 'choke' | 'unchoke' | 'auth';
  infoHash?: string;
  nodeId?: string;
  pieceIndex?: number;
  begin?: number;
  length?: number;
  data?: string;
  bitfield?: boolean[];
  auth?: AuthMessage;
  encrypted?: EncryptedChunk;
}

interface ChunkRequest {
  chunkIndex: number;
  peerKey: string;
  requestedAt: number;
  retryCount: number;
}

interface Peer {
  key: string;
  socket: tls.TLSSocket;
  bitfield: boolean[];
  slowCount: number;
  isChoked: boolean;
  isAuthenticated: boolean;
  nodeId?: string;
  publicKey?: string;
  aesKey?: Buffer;
}

const REQUEST_TIMEOUT = 30000;
const MAX_RETRIES = 5;
const MAX_PEERS = 15;
const STALL_THRESHOLD = 60000;
const REFRESH_PEERS_INTERVAL = 120000;
const AUTH_TIMEOUT = 10000;

export class PeerServer {
  private server: tls.Server;
  private nodeId: string;
  private port: number;
  private connections: Map<string, Peer> = new Map();
  private availableFiles: Map<string, FileMetadata> = new Map();
  private filePaths: Map<string, string> = new Map();
  private downloadedChunks: Map<string, Set<number>> = new Map();
  private fileAESKeys: Map<string, Buffer> = new Map();
  private keyPair: { publicKey: string; privateKey: string };
  private stats: TransferStats = {
    totalChunks: 0,
    downloadedChunks: 0,
    uploadedChunks: 0,
    bytesDownloaded: 0,
    bytesUploaded: 0,
    startTime: Date.now(),
    currentSpeed: 0,
    averageSpeed: 0,
    connectedPeers: 0
  };

  constructor(port: number = 6882) {
    this.port = port;
    this.nodeId = generateNodeId();
    this.keyPair = generateRSAKeyPair();
    
    const tlsOptions = getTLSServerOptions();
    this.server = new tls.Server(tlsOptions, this.handleConnection.bind(this));
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`Peer server (TLS 1.3) running on port ${this.port}, node ID: ${this.nodeId}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.connections.forEach(peer => peer.socket.destroy());
      this.connections.clear();
      this.server.close(() => resolve());
    });
  }

  getNodeId(): string {
    return this.nodeId;
  }

  getPort(): number {
    return this.port;
  }

  getPublicKey(): string {
    return this.keyPair.publicKey;
  }

  addFile(infoHash: string, metadata: FileMetadata, filePath: string, aesKey?: Buffer): void {
    this.availableFiles.set(infoHash, metadata);
    this.filePaths.set(infoHash, filePath);
    this.downloadedChunks.set(infoHash, new Set(metadata.chunks.map(c => c.index)));
    
    const key = aesKey || generateAESKey();
    this.fileAESKeys.set(infoHash, key);
    setGlobalAESKey(key);
  }

  addIncompleteFile(infoHash: string, metadata: FileMetadata, filePath: string, downloaded: number[], aesKey?: Buffer): void {
    this.availableFiles.set(infoHash, metadata);
    this.filePaths.set(infoHash, filePath);
    this.downloadedChunks.set(infoHash, new Set(downloaded));
    
    if (aesKey) {
      this.fileAESKeys.set(infoHash, aesKey);
      setGlobalAESKey(aesKey);
    }
  }

  getFileAESKey(infoHash: string): Buffer | undefined {
    return this.fileAESKeys.get(infoHash);
  }

  private handleConnection(socket: tls.TLSSocket): void {
    const peerKey = `${socket.remoteAddress}:${socket.remotePort}`;
    const peer: Peer = {
      key: peerKey,
      socket,
      bitfield: [],
      slowCount: 0,
      isChoked: false,
      isAuthenticated: false
    };
    this.connections.set(peerKey, peer);

    const authTimeout = setTimeout(() => {
      if (!peer.isAuthenticated) {
        socket.destroy();
        this.connections.delete(peerKey);
      }
    }, AUTH_TIMEOUT);

    let buffer = Buffer.alloc(0);

    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      this.handleMessages(buffer, peerKey);
    });

    socket.on('close', () => {
      clearTimeout(authTimeout);
      this.connections.delete(peerKey);
    });

    socket.on('error', () => {
      clearTimeout(authTimeout);
      this.connections.delete(peerKey);
    });
  }

  private handleMessages(buffer: Buffer, peerKey: string): void {
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0);
      if (buffer.length < 4 + length) break;

      const messageData = buffer.slice(4, 4 + length);
      buffer = buffer.slice(4 + length);

      try {
        const message: PeerMessage = JSON.parse(messageData.toString());
        this.handlePeerMessage(message, peerKey);
      } catch (e) {
      }
    }
  }

  private handlePeerMessage(message: PeerMessage, peerKey: string): void {
    const peer = this.connections.get(peerKey);
    if (!peer) return;

    if (message.type === 'auth') {
      this.handleAuthMessage(message.auth!, peer);
      return;
    }

    if (!peer.isAuthenticated) {
      return;
    }

    switch (message.type) {
      case 'handshake':
        this.handleHandshake(message, peer);
        break;
      case 'bitfield':
        this.handleBitfield(message, peer);
        break;
      case 'have':
        this.handleHave(message, peer);
        break;
      case 'request':
        this.handleRequest(message, peer);
        break;
      case 'piece_encrypted':
        this.handlePieceEncrypted(message, peer);
        break;
    }
  }

  private handleAuthMessage(auth: AuthMessage, peer: Peer): void {
    if (auth.type === 'auth_request') {
      const challenge = Math.random().toString(36).substring(7);
      const response: AuthMessage = {
        type: 'auth_challenge',
        nodeId: this.nodeId,
        publicKey: this.keyPair.publicKey,
        challenge
      };
      this.sendMessage(peer.socket, { type: 'auth', auth: response });
    } else if (auth.type === 'auth_response') {
      const challenge = Math.random().toString(36).substring(7);
      const signature = signData(challenge, this.keyPair.privateKey);
      const token = generateJWT(this.nodeId, peer.socket.remoteAddress || '');
      
      const response: AuthMessage = {
        type: 'auth_response',
        nodeId: this.nodeId,
        publicKey: this.keyPair.publicKey,
        challenge,
        signature,
        token
      };
      this.sendMessage(peer.socket, { type: 'auth', auth: response });
    } else if (auth.type === 'auth_challenge') {
      const signature = signData(auth.challenge!, this.keyPair.privateKey);
      const token = generateJWT(this.nodeId, peer.socket.remoteAddress || '');
      
      const response: AuthMessage = {
        type: 'auth_response',
        nodeId: this.nodeId,
        publicKey: this.keyPair.publicKey,
        challenge: auth.challenge,
        signature,
        token
      };
      this.sendMessage(peer.socket, { type: 'auth', auth: response });
    } else if (auth.type === 'auth_response') {
      if (auth.token && auth.publicKey) {
        const tokenResult = verifyJWT(auth.token);
        if (tokenResult.valid) {
          peer.isAuthenticated = true;
          peer.nodeId = auth.nodeId;
          peer.publicKey = auth.publicKey;
        }
      }
    }
  }

  private handleHandshake(message: PeerMessage, peer: Peer): void {
    const infoHash = message.infoHash!;
    const metadata = this.availableFiles.get(infoHash);
    
    if (metadata) {
      const bitfield = metadata.chunks.map(c => 
        this.downloadedChunks.get(infoHash)?.has(c.index) || false
      );
      this.sendMessage(peer.socket, {
        type: 'bitfield',
        bitfield
      });
    }
  }

  private handleBitfield(message: PeerMessage, peer: Peer): void {
    peer.bitfield = message.bitfield || [];
  }

  private handleHave(message: PeerMessage, peer: Peer): void {
    if (message.pieceIndex !== undefined && peer.bitfield) {
      peer.bitfield[message.pieceIndex] = true;
    }
  }

  private handleRequest(message: PeerMessage, peer: Peer): void {
    const infoHash = message.infoHash!;
    const pieceIndex = message.pieceIndex!;
    const metadata = this.availableFiles.get(infoHash);
    const filePath = this.filePaths.get(infoHash);
    const aesKey = this.fileAESKeys.get(infoHash);

    if (!metadata || !filePath || !aesKey) return;
    if (!this.downloadedChunks.get(infoHash)?.has(pieceIndex)) return;

    const chunk = metadata.chunks[pieceIndex];
    try {
      const fd = fs.openSync(filePath, 'r');
      const chunkData = Buffer.alloc(chunk.size);
      fs.readSync(fd, chunkData, 0, chunk.size, pieceIndex * metadata.chunkSize);
      fs.closeSync(fd);

      const encrypted = encryptChunkAES256GCM(chunkData, aesKey);
      encrypted.index = pieceIndex;

      this.sendMessage(peer.socket, {
        type: 'piece_encrypted',
        pieceIndex,
        encrypted
      });

      this.stats.uploadedChunks++;
      this.stats.bytesUploaded += chunk.size;
    } catch (e) {
    }
  }

  private handlePieceEncrypted(message: PeerMessage, peer: Peer): void {
  }

  private sendMessage(socket: tls.TLSSocket, message: PeerMessage): void {
    const data = Buffer.from(JSON.stringify(message));
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(data.length, 0);
    socket.write(Buffer.concat([lengthBuffer, data]));
  }

  getStats(): TransferStats {
    return { ...this.stats, connectedPeers: this.connections.size };
  }

  getDownloadedChunks(infoHash: string): number[] {
    return Array.from(this.downloadedChunks.get(infoHash) || []);
  }
}

export class PeerClient {
  private peers: Map<string, Peer> = new Map();
  private nodeId: string;
  private localIp: string;
  private infoHash: string;
  private metadata: FileMetadata;
  private filePath: string;
  private downloadedChunks: Set<number> = new Set();
  private pendingRequests: Map<number, ChunkRequest> = new Map();
  private chunkRetryCount: Map<number, number> = new Map();
  private stats: TransferStats;
  private onProgress?: (stats: TransferStats) => void;
  private isDownloading: boolean = false;
  private trackerUrls: string[] = [];
  private peerPort: number;
  private lastProgressTime: number = Date.now();
  private lastPeerRefresh: number = 0;
  private monitorInterval: NodeJS.Timeout | null = null;
  private keyPair: { publicKey: string; privateKey: string };
  private aesKey: Buffer | null = null;

  constructor(
    infoHash: string,
    metadata: FileMetadata,
    filePath: string,
    downloadedChunks: number[] = [],
    trackerUrls: string[] = [],
    peerPort: number = 6883,
    aesKey?: Buffer
  ) {
    this.infoHash = infoHash;
    this.metadata = metadata;
    this.filePath = filePath;
    this.nodeId = generateNodeId();
    this.localIp = getLocalIPs()[0] || '127.0.0.1';
    this.downloadedChunks = new Set(downloadedChunks);
    this.trackerUrls = trackerUrls;
    this.peerPort = peerPort;
    this.keyPair = generateRSAKeyPair();
    this.aesKey = aesKey || null;
    
    if (aesKey) {
      setGlobalAESKey(aesKey);
    }
    
    this.stats = {
      totalChunks: metadata.chunkCount,
      downloadedChunks: downloadedChunks.length,
      uploadedChunks: 0,
      bytesDownloaded: 0,
      bytesUploaded: 0,
      startTime: Date.now(),
      currentSpeed: 0,
      averageSpeed: 0,
      connectedPeers: 0
    };
  }

  setAESKey(key: Buffer): void {
    this.aesKey = key;
    setGlobalAESKey(key);
  }

  setOnProgress(callback: (stats: TransferStats) => void): void {
    this.onProgress = callback;
  }

  async connectToPeers(peers: NodeInfo[]): Promise<void> {
    const sortedPeers = sortPeersBySubnet(this.localIp, peers);
    
    for (const peer of sortedPeers.slice(0, MAX_PEERS)) {
      if (this.peers.size >= MAX_PEERS) break;
      try {
        await this.connectToPeer(peer);
      } catch (e) {
      }
    }

    this.stats.connectedPeers = this.peers.size;
  }

  private async connectToPeer(peer: NodeInfo): Promise<void> {
    return new Promise((resolve, reject) => {
      const peerKey = `${peer.ip}:${peer.port}`;
      if (this.peers.has(peerKey)) {
        resolve();
        return;
      }

      const tlsOptions = {
        ...getTLSClientOptions(),
        host: peer.ip,
        port: peer.port
      };

      const socket = tls.connect(tlsOptions, () => {
        const peerObj: Peer = {
          key: peerKey,
          socket,
          bitfield: [],
          slowCount: 0,
          isChoked: false,
          isAuthenticated: false
        };
        this.peers.set(peerKey, peerObj);
        
        this.performAuthentication(peerObj, peerKey, resolve, reject);
      });

      let buffer = Buffer.alloc(0);
      socket.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);
        this.handleMessages(buffer, peerKey);
      });

      socket.on('error', () => {
        this.cleanupPeer(peerKey);
        reject();
      });

      socket.on('close', () => {
        this.cleanupPeer(peerKey);
      });

      setTimeout(() => {
        if (!this.peers.has(peerKey)) {
          socket.destroy();
          reject();
        }
      }, 15000);
    });
  }

  private performAuthentication(peer: Peer, peerKey: string, resolve: () => void, reject: () => void): void {
    const authRequest: AuthMessage = {
      type: 'auth_request',
      nodeId: this.nodeId,
      publicKey: this.keyPair.publicKey
    };
    this.sendMessage(peer.socket, { type: 'auth', auth: authRequest });

    const authTimeout = setTimeout(() => {
      if (!peer.isAuthenticated) {
        this.cleanupPeer(peerKey);
        reject();
      }
    }, AUTH_TIMEOUT);

    const checkAuth = setInterval(() => {
      if (peer.isAuthenticated) {
        clearInterval(checkAuth);
        clearTimeout(authTimeout);
        resolve();
      }
    }, 100);
  }

  private cleanupPeer(peerKey: string): void {
    const peer = this.peers.get(peerKey);
    if (peer) {
      peer.socket.destroy();
      this.peers.delete(peerKey);
      
      this.pendingRequests.forEach((request, chunkIndex) => {
        if (request.peerKey === peerKey) {
          this.pendingRequests.delete(chunkIndex);
        }
      });
    }
    this.stats.connectedPeers = this.peers.size;
  }

  private handleMessages(buffer: Buffer, peerKey: string): void {
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0);
      if (buffer.length < 4 + length) break;

      const messageData = buffer.slice(4, 4 + length);
      buffer = buffer.slice(4 + length);

      try {
        const message: PeerMessage = JSON.parse(messageData.toString());
        this.handlePeerMessage(message, peerKey);
      } catch (e) {
      }
    }
  }

  private handlePeerMessage(message: PeerMessage, peerKey: string): void {
    const peer = this.peers.get(peerKey);
    if (!peer) return;

    if (message.type === 'auth') {
      this.handleAuthMessage(message.auth!, peer);
      return;
    }

    if (!peer.isAuthenticated) {
      return;
    }

    switch (message.type) {
      case 'bitfield':
        peer.bitfield = message.bitfield || [];
        this.scheduleRequests();
        break;
      case 'have':
        if (message.pieceIndex !== undefined && peer.bitfield) {
          peer.bitfield[message.pieceIndex] = true;
        }
        this.scheduleRequests();
        break;
      case 'piece_encrypted':
        this.handlePieceEncrypted(message, peerKey);
        this.scheduleRequests();
        break;
    }
  }

  private handleAuthMessage(auth: AuthMessage, peer: Peer): void {
    if (auth.type === 'auth_challenge') {
      const signature = signData(auth.challenge!, this.keyPair.privateKey);
      const token = generateJWT(this.nodeId, peer.socket.remoteAddress || '');
      
      const response: AuthMessage = {
        type: 'auth_response',
        nodeId: this.nodeId,
        publicKey: this.keyPair.publicKey,
        challenge: auth.challenge,
        signature,
        token
      };
      this.sendMessage(peer.socket, { type: 'auth', auth: response });
    } else if (auth.type === 'auth_response') {
      if (auth.token && auth.publicKey) {
        const tokenResult = verifyJWT(auth.token);
        if (tokenResult.valid) {
          peer.isAuthenticated = true;
          peer.nodeId = auth.nodeId;
          peer.publicKey = auth.publicKey;
          this.sendMessage(peer.socket, {
            type: 'handshake',
            infoHash: this.infoHash,
            nodeId: this.nodeId
          });
        }
      }
    }
  }

  private getRarestFirstChunks(): number[] {
    const chunkAvailability: Map<number, number> = new Map();
    
    for (let i = 0; i < this.metadata.chunkCount; i++) {
      if (!this.downloadedChunks.has(i) && !this.pendingRequests.has(i)) {
        let count = 0;
        this.peers.forEach(peer => {
          if (peer.bitfield[i]) count++;
        });
        if (count > 0) {
          chunkAvailability.set(i, count);
        }
      }
    }

    return Array.from(chunkAvailability.entries())
      .sort((a, b) => a[1] - b[1])
      .map(e => e[0]);
  }

  private scheduleRequests(): void {
    if (!this.isDownloading) return;

    const maxPending = Math.min(this.peers.size * 2, 10);
    const rarestChunks = this.getRarestFirstChunks();

    for (const chunkIndex of rarestChunks) {
      if (this.pendingRequests.size >= maxPending) break;

      for (const [peerKey, peer] of this.peers) {
        if (peer.bitfield[chunkIndex] && !peer.isChoked && peer.isAuthenticated) {
          const retryCount = this.chunkRetryCount.get(chunkIndex) || 0;
          if (retryCount < MAX_RETRIES) {
            this.requestChunk(chunkIndex, peerKey, peer.socket);
            break;
          }
        }
      }
    }
  }

  private requestChunk(chunkIndex: number, peerKey: string, socket: tls.TLSSocket): void {
    const retryCount = this.chunkRetryCount.get(chunkIndex) || 0;
    
    this.pendingRequests.set(chunkIndex, {
      chunkIndex,
      peerKey,
      requestedAt: Date.now(),
      retryCount
    });

    this.sendMessage(socket, {
      type: 'request',
      infoHash: this.infoHash,
      pieceIndex: chunkIndex
    });
  }

  private handlePieceEncrypted(message: PeerMessage, peerKey: string): void {
    const pieceIndex = message.pieceIndex!;
    const encrypted = message.encrypted!;

    if (!this.aesKey) {
      this.pendingRequests.delete(pieceIndex);
      const retries = this.chunkRetryCount.get(pieceIndex) || 0;
      this.chunkRetryCount.set(pieceIndex, retries + 1);
      return;
    }

    if (!verifyEncryptedChunkHash(encrypted)) {
      this.pendingRequests.delete(pieceIndex);
      const retries = this.chunkRetryCount.get(pieceIndex) || 0;
      this.chunkRetryCount.set(pieceIndex, retries + 1);
      return;
    }

    try {
      const chunkData = decryptChunkAES256GCM(encrypted, this.aesKey);
      
      const expectedChunk = this.metadata.chunks[pieceIndex];
      if (!verifyChunk(chunkData, expectedChunk.hash)) {
        this.pendingRequests.delete(pieceIndex);
        const retries = this.chunkRetryCount.get(pieceIndex) || 0;
        this.chunkRetryCount.set(pieceIndex, retries + 1);
        return;
      }

      const fd = fs.openSync(this.filePath, 'r+');
      fs.writeSync(fd, chunkData, 0, chunkData.length, pieceIndex * this.metadata.chunkSize);
      fs.closeSync(fd);

      this.downloadedChunks.add(pieceIndex);
      this.pendingRequests.delete(pieceIndex);
      this.chunkRetryCount.delete(pieceIndex);
      this.stats.downloadedChunks = this.downloadedChunks.size;
      this.stats.bytesDownloaded += chunkData.length;
      this.lastProgressTime = Date.now();

      const elapsed = (Date.now() - this.stats.startTime) / 1000;
      this.stats.averageSpeed = this.stats.bytesDownloaded / Math.max(elapsed, 1);

      if (this.onProgress) {
        this.onProgress(this.stats);
      }

      this.peers.forEach((peer, key) => {
        if (key !== peerKey && peer.isAuthenticated) {
          this.sendMessage(peer.socket, {
            type: 'have',
            pieceIndex
          });
        }
      });
    } catch (e) {
      this.pendingRequests.delete(pieceIndex);
      const retries = this.chunkRetryCount.get(pieceIndex) || 0;
      this.chunkRetryCount.set(pieceIndex, retries + 1);
    }
  }

  private sendMessage(socket: tls.TLSSocket, message: PeerMessage): void {
    const data = Buffer.from(JSON.stringify(message));
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(data.length, 0);
    socket.write(Buffer.concat([lengthBuffer, data]));
  }

  private checkTimeouts(): void {
    const now = Date.now();
    
    this.pendingRequests.forEach((request, chunkIndex) => {
      const elapsed = now - request.requestedAt;
      const baseTimeout = REQUEST_TIMEOUT;
      const timeoutWithBackoff = baseTimeout * Math.pow(1.5, request.retryCount);

      if (elapsed > timeoutWithBackoff) {
        this.pendingRequests.delete(chunkIndex);
        
        const peer = this.peers.get(request.peerKey);
        if (peer) {
          peer.slowCount++;
          if (peer.slowCount >= 3) {
            peer.isChoked = true;
            setTimeout(() => {
              peer.isChoked = false;
              peer.slowCount = 0;
              this.scheduleRequests();
            }, 30000);
          }
        }

        const retries = this.chunkRetryCount.get(chunkIndex) || 0;
        if (retries < MAX_RETRIES) {
          this.chunkRetryCount.set(chunkIndex, retries + 1);
        }
      }
    });
  }

  private async refreshPeersFromTracker(): Promise<NodeInfo[]> {
    const allPeers: NodeInfo[] = [];
    
    for (const trackerUrl of this.trackerUrls) {
      try {
        const params = new URLSearchParams({
          info_hash: this.infoHash,
          node_id: this.nodeId,
          port: this.peerPort.toString(),
          event: 'started',
          downloaded: this.stats.bytesDownloaded.toString(),
          uploaded: this.stats.bytesUploaded.toString(),
          left: ((this.metadata.chunkCount - this.downloadedChunks.size) * this.metadata.chunkSize).toString()
        });

        const response = await fetch(`${trackerUrl}/announce?${params}`);
        if (response.ok) {
          const data = await response.json() as TrackerAnnounceResponse;
          allPeers.push(...data.peers);
        }
      } catch (e) {
      }
    }

    return allPeers;
  }

  private async monitorDownload(): Promise<void> {
    const now = Date.now();
    
    this.checkTimeouts();

    if (now - this.lastPeerRefresh > REFRESH_PEERS_INTERVAL) {
      this.lastPeerRefresh = now;
      const newPeers = await this.refreshPeersFromTracker();
      if (newPeers.length > 0) {
        for (const peer of newPeers) {
          const peerKey = `${peer.ip}:${peer.port}`;
          if (!this.peers.has(peerKey) && this.peers.size < MAX_PEERS) {
            try {
              await this.connectToPeer(peer);
            } catch (e) {
            }
          }
        }
      }
    }

    const stallTime = now - this.lastProgressTime;
    if (stallTime > STALL_THRESHOLD && this.downloadedChunks.size < this.metadata.chunkCount) {      
      const hasAnyProvider = Array.from({ length: this.metadata.chunkCount })
        .some((_, i) => {
          if (this.downloadedChunks.has(i)) return true;
          return Array.from(this.peers.values()).some(p => p.bitfield[i]);
        });

      if (!hasAnyProvider && this.trackerUrls.length > 0) {
        const newPeers = await this.refreshPeersFromTracker();
        if (newPeers.length > 0) {
          await this.connectToPeers(newPeers);
        }
      }

      if (this.peers.size === 0) {
        this.isDownloading = false;
      }
    }

    this.scheduleRequests();
  }

  async download(): Promise<boolean> {
    this.isDownloading = true;
    this.lastProgressTime = Date.now();
    this.lastPeerRefresh = Date.now();

    this.monitorInterval = setInterval(() => {
      this.monitorDownload();
    }, 2000);

    return new Promise((resolve) => {
      const checkComplete = () => {
        if (this.downloadedChunks.size >= this.metadata.chunkCount) {
          this.isDownloading = false;
          if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
          }
          resolve(true);
        } else if (!this.isDownloading) {
          if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
          }
          resolve(false);
        } else {
          setTimeout(checkComplete, 500);
        }
      };
      checkComplete();
    });
  }

  getDownloadedChunks(): number[] {
    return Array.from(this.downloadedChunks);
  }

  getStats(): TransferStats {
    return { ...this.stats, connectedPeers: this.peers.size };
  }

  disconnect(): void {
    this.isDownloading = false;
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }
    this.peers.forEach((_, key) => this.cleanupPeer(key));
  }
}
