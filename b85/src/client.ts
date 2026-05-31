import * as fs from 'fs';
import * as path from 'path';
import { FileMetadata, TorrentInfo, TransferStats, NodeInfo } from './types';
import { calculateSHA256, splitFileIntoChunks, verifyFile, formatBytes, formatSpeed, getLocalIPs } from './utils';
import { TrackerClient } from './tracker';
import { DHT } from './dht';
import { PeerServer, PeerClient } from './peer';
import { generateAESKey, generateRSAKeyPair, encryptFileKey, decryptFileKey, signData, verifySignature } from './crypto';

export class P2PClient {
  private peerServer: PeerServer;
  private dht: DHT;
  private trackerClients: TrackerClient[] = [];
  private torrentCache: Map<string, TorrentInfo> = new Map();
  private downloadCache: Map<string, number[]> = new Map();
  private rsaKeyPair?: { publicKey: string; privateKey: string };

  constructor(peerPort: number = 6882, dhtPort: number = 6881) {
    this.peerServer = new PeerServer(peerPort);
    this.dht = new DHT(dhtPort);
    this.rsaKeyPair = generateRSAKeyPair();
  }

  async start(): Promise<void> {
    await this.peerServer.start();
    await this.dht.start();
  }

  async stop(): Promise<void> {
    await this.peerServer.stop();
    await this.dht.stop();
  }

  addTracker(trackerUrl: string): void {
    this.trackerClients.push(new TrackerClient(trackerUrl));
  }

  addBootstrapNode(ip: string, port: number): void {
    this.dht.addBootstrapNode(ip, port);
  }

  async createTorrent(filePath: string, trackerUrls: string[] = [], encrypt: boolean = true): Promise<TorrentInfo> {
    const metadata = await splitFileIntoChunks(filePath);
    const infoHash = calculateSHA256(Buffer.from(JSON.stringify(metadata)));

    let aesKey: Buffer | undefined;
    let encryptedAESKey: string | undefined;

    if (encrypt && this.rsaKeyPair) {
      aesKey = generateAESKey();
      encryptedAESKey = encryptFileKey(aesKey.toString('hex'), this.rsaKeyPair.publicKey);
    }

    const torrent: TorrentInfo = {
      infoHash,
      metadata,
      trackerUrls,
      dhtNodes: [],
      encryptedAESKey,
      publicKey: this.rsaKeyPair?.publicKey
    };

    const torrentFilePath = `${filePath}.torrent`;
    fs.writeFileSync(torrentFilePath, JSON.stringify(torrent, null, 2));

    this.peerServer.addFile(infoHash, metadata, filePath, aesKey);
    this.torrentCache.set(infoHash, torrent);

    for (const trackerUrl of trackerUrls) {
      const trackerClient = new TrackerClient(trackerUrl);
      try {
        await trackerClient.announce(
          infoHash,
          this.peerServer.getPort(),
          'started',
          0,
          metadata.fileSize,
          0
        );
      } catch (e) {
        // Ignore tracker errors
      }
    }

    this.dht.announcePeer(infoHash, this.peerServer.getPort());

    return torrent;
  }

  async downloadTorrent(
    torrentPath: string,
    outputPath: string,
    onProgress?: (stats: TransferStats) => void
  ): Promise<boolean> {
    const torrent: TorrentInfo = JSON.parse(fs.readFileSync(torrentPath, 'utf-8'));
    const { infoHash, metadata, trackerUrls, encryptedAESKey } = torrent;

    if (this.checkInstantDownload(infoHash, outputPath)) {
      console.log('秒传成功！文件已存在。');
      return true;
    }

    this.prepareOutputFile(outputPath, metadata);
    const downloadedChunks = this.loadDownloadProgress(infoHash) || [];

    let aesKey: Buffer | undefined;
    if (encryptedAESKey && this.rsaKeyPair) {
      try {
        const decryptedKey = decryptFileKey(encryptedAESKey, this.rsaKeyPair.privateKey);
        aesKey = Buffer.from(decryptedKey, 'hex');
        console.log('AES密钥解密成功，传输将使用加密模式');
      } catch (e) {
        console.warn('AES密钥解密失败，传输可能不安全');
      }
    }

    const allPeers = await this.discoverPeers(infoHash, trackerUrls);

    if (allPeers.length === 0) {
      console.log('未发现可用节点');
      return false;
    }

    console.log(`发现 ${allPeers.length} 个节点`);

    const peerClient = new PeerClient(infoHash, metadata, outputPath, downloadedChunks, trackerUrls, this.peerServer.getPort(), aesKey);
    peerClient.setOnProgress((stats) => {
      this.saveDownloadProgress(infoHash, peerClient.getDownloadedChunks());
      if (onProgress) {
        onProgress(stats);
      }
    });

    await peerClient.connectToPeers(allPeers);

    this.peerServer.addIncompleteFile(
      infoHash,
      metadata,
      outputPath,
      peerClient.getDownloadedChunks(),
      aesKey
    );

    const success = await peerClient.download();

    if (success) {
      this.cleanupProgress(infoHash);
      const verifyResult = await verifyFile(outputPath, metadata);
      if (verifyResult.success) {
        console.log('文件校验通过！');
        this.announceCompleted(infoHash, metadata.fileSize, trackerUrls);
      } else {
        console.log(`文件校验失败！有 ${verifyResult.failedChunks.length} 个块损坏`);
      }
    }

    peerClient.disconnect();

    return success;
  }

  private checkInstantDownload(infoHash: string, outputPath: string): boolean {
    if (!fs.existsSync(outputPath)) return false;

    const cachedChunks = this.downloadCache.get(infoHash);
    if (!cachedChunks) return false;

    const torrent = this.torrentCache.get(infoHash);
    if (!torrent) return false;

    const stats = fs.statSync(outputPath);
    if (stats.size !== torrent.metadata.fileSize) return false;

    const expectedChunks = torrent.metadata.chunkCount;
    return cachedChunks.length === expectedChunks;
  }

  private prepareOutputFile(outputPath: string, metadata: FileMetadata): void {
    if (!fs.existsSync(outputPath)) {
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const fd = fs.openSync(outputPath, 'w');
      fs.ftruncateSync(fd, metadata.fileSize);
      fs.closeSync(fd);
    }
  }

  private saveDownloadProgress(infoHash: string, chunks: number[]): void {
    this.downloadCache.set(infoHash, chunks);
    const progressPath = path.join(
      process.env.HOME || process.env.USERPROFILE || '.',
      '.p2p_downloads',
      `${infoHash}.progress`
    );
    const dir = path.dirname(progressPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(progressPath, JSON.stringify(chunks));
  }

  private loadDownloadProgress(infoHash: string): number[] | null {
    const progressPath = path.join(
      process.env.HOME || process.env.USERPROFILE || '.',
      '.p2p_downloads',
      `${infoHash}.progress`
    );
    if (fs.existsSync(progressPath)) {
      try {
        return JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
      } catch {
        return null;
      }
    }
    return null;
  }

  private cleanupProgress(infoHash: string): void {
    this.downloadCache.delete(infoHash);
    const progressPath = path.join(
      process.env.HOME || process.env.USERPROFILE || '.',
      '.p2p_downloads',
      `${infoHash}.progress`
    );
    if (fs.existsSync(progressPath)) {
      fs.unlinkSync(progressPath);
    }
  }

  private async discoverPeers(infoHash: string, trackerUrls: string[]): Promise<NodeInfo[]> {
    const allPeers: NodeInfo[] = [];
    const peerSet = new Set<string>();

    for (const trackerUrl of trackerUrls) {
      try {
        const trackerClient = new TrackerClient(trackerUrl);
        const response = await trackerClient.announce(
          infoHash,
          this.peerServer.getPort(),
          'started'
        );
        for (const peer of response.peers) {
          const peerKey = `${peer.ip}:${peer.port}`;
          if (!peerSet.has(peerKey)) {
            peerSet.add(peerKey);
            allPeers.push(peer);
          }
        }
      } catch (e) {
        // Ignore tracker errors
      }
    }

    try {
      const dhtPeers = await this.dht.getPeers(infoHash);
      for (const peerStr of dhtPeers) {
        if (!peerSet.has(peerStr)) {
          peerSet.add(peerStr);
          const [ip, port] = peerStr.split(':');
          allPeers.push({
            id: '',
            ip,
            port: parseInt(port),
            subnet: '',
            lastSeen: Date.now(),
            availableChunks: new Set(),
            uploadSpeed: 0,
            downloadSpeed: 0
          });
        }
      }
    } catch (e) {
      // Ignore DHT errors
    }

    return allPeers;
  }

  private announceCompleted(infoHash: string, fileSize: number, trackerUrls: string[]): void {
    for (const trackerUrl of trackerUrls) {
      try {
        const trackerClient = new TrackerClient(trackerUrl);
        trackerClient.announce(
          infoHash,
          this.peerServer.getPort(),
          'completed',
          0,
          fileSize,
          0
        );
      } catch (e) {
        // Ignore tracker errors
      }
    }
    this.dht.announcePeer(infoHash, this.peerServer.getPort());
  }

  getServerStats(): TransferStats {
    return this.peerServer.getStats();
  }
}
