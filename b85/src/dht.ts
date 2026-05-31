import * as dgram from 'dgram';
import { DHTMessage, NodeInfo } from './types';
import { calculateSubnet, generateNodeId } from './utils';

interface DHTNode {
  id: string;
  ip: string;
  port: number;
  lastSeen: number;
}

export class DHT {
  private socket: dgram.Socket;
  private nodeId: string;
  private port: number;
  private routingTable: Map<string, DHTNode> = new Map();
  private tokenTable: Map<string, string> = new Map();
  private peers: Map<string, Set<string>> = new Map();
  private isRunning: boolean = false;

  constructor(port: number = 6881) {
    this.port = port;
    this.nodeId = generateNodeId();
    this.socket = dgram.createSocket('udp4');
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.on('error', (err) => {
        if (!this.isRunning) {
          reject(err);
        }
      });

      this.socket.on('message', this.handleMessage.bind(this));

      this.socket.bind(this.port, () => {
        this.isRunning = true;
        console.log(`DHT node running on port ${this.port}, node ID: ${this.nodeId}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.isRunning = false;
      this.socket.close(() => resolve());
    });
  }

  private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo) {
    try {
      const message: DHTMessage = JSON.parse(msg.toString());
      
      switch (message.type) {
        case 'ping':
          this.handlePing(message, rinfo);
          break;
        case 'find_node':
          this.handleFindNode(message, rinfo);
          break;
        case 'get_peers':
          this.handleGetPeers(message, rinfo);
          break;
        case 'announce_peer':
          this.handleAnnouncePeer(message, rinfo);
          break;
      }

      this.addNode(message.id, rinfo.address, rinfo.port);
    } catch (e) {
      // Ignore invalid messages
    }
  }

  private handlePing(message: DHTMessage, rinfo: dgram.RemoteInfo) {
    this.sendMessage({
      type: 'ping',
      id: this.nodeId
    }, rinfo.address, rinfo.port);
  }

  private handleFindNode(message: DHTMessage, rinfo: dgram.RemoteInfo) {
    const nodes = this.findClosestNodes(message.target || message.id);
    this.sendMessage({
      type: 'find_node',
      id: this.nodeId,
      nodes: nodes
    }, rinfo.address, rinfo.port);
  }

  private handleGetPeers(message: DHTMessage, rinfo: dgram.RemoteInfo) {
    const infoHash = message.infoHash!;
    const token = generateNodeId().slice(0, 8);
    this.tokenTable.set(`${rinfo.address}:${rinfo.port}`, token);

    const peers = this.peers.get(infoHash);
    if (peers && peers.size > 0) {
      this.sendMessage({
        type: 'get_peers',
        id: this.nodeId,
        token,
        values: Array.from(peers)
      }, rinfo.address, rinfo.port);
    } else {
      const nodes = this.findClosestNodes(infoHash);
      this.sendMessage({
        type: 'get_peers',
        id: this.nodeId,
        token,
        nodes
      }, rinfo.address, rinfo.port);
    }
  }

  private handleAnnouncePeer(message: DHTMessage, rinfo: dgram.RemoteInfo) {
    const infoHash = message.infoHash!;
    const storedToken = this.tokenTable.get(`${rinfo.address}:${rinfo.port}`);
    
    if (storedToken !== message.token) {
      return;
    }

    if (!this.peers.has(infoHash)) {
      this.peers.set(infoHash, new Set());
    }
    this.peers.get(infoHash)!.add(`${rinfo.address}:${message.port}`);
  }

  private sendMessage(message: any, ip: string, port: number) {
    try {
      const data = Buffer.from(JSON.stringify(message));
      this.socket.send(data, port, ip);
    } catch (e) {
      // Ignore send errors
    }
  }

  private addNode(id: string, ip: string, port: number) {
    this.routingTable.set(id, {
      id,
      ip,
      port,
      lastSeen: Date.now()
    });

    if (this.routingTable.size > 1000) {
      const oldest = Array.from(this.routingTable.values())
        .sort((a, b) => a.lastSeen - b.lastSeen)[0];
      this.routingTable.delete(oldest.id);
    }
  }

  private findClosestNodes(targetId: string, count: number = 8): DHTNode[] {
    return Array.from(this.routingTable.values())
      .sort((a, b) => this.xorDistance(a.id, targetId) - this.xorDistance(b.id, targetId))
      .slice(0, count);
  }

  private xorDistance(id1: string, id2: string): number {
    let distance = 0;
    const len = Math.min(id1.length, id2.length);
    for (let i = 0; i < len; i++) {
      distance = (distance << 8) | (parseInt(id1[i], 16) ^ parseInt(id2[i], 16));
    }
    return distance;
  }

  async ping(ip: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 2000);
      
      const onMessage = (msg: Buffer, rinfo: dgram.RemoteInfo) => {
        if (rinfo.address === ip && rinfo.port === port) {
          try {
            const message = JSON.parse(msg.toString());
            if (message.type === 'ping') {
              clearTimeout(timeout);
              this.socket.removeListener('message', onMessage);
              resolve(true);
            }
          } catch (e) {}
        }
      };

      this.socket.on('message', onMessage);
      this.sendMessage({ type: 'ping', id: this.nodeId }, ip, port);
    });
  }

  async getPeers(infoHash: string): Promise<string[]> {
    const allPeers: Set<string> = new Set();
    
    const localPeers = this.peers.get(infoHash);
    if (localPeers) {
      localPeers.forEach(p => allPeers.add(p));
    }

    const nodes = this.findClosestNodes(infoHash, 10);
    for (const node of nodes) {
      this.sendMessage({
        type: 'get_peers',
        id: this.nodeId,
        infoHash
      }, node.ip, node.port);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
    return Array.from(allPeers);
  }

  announcePeer(infoHash: string, port: number, ip?: string) {
    const peerIp = ip || this.getLocalIp();
    if (!this.peers.has(infoHash)) {
      this.peers.set(infoHash, new Set());
    }
    this.peers.get(infoHash)!.add(`${peerIp}:${port}`);

    const nodes = this.findClosestNodes(infoHash, 10);
    for (const node of nodes) {
      const token = this.tokenTable.get(`${node.ip}:${node.port}`) || '';
      this.sendMessage({
        type: 'announce_peer',
        id: this.nodeId,
        infoHash,
        port,
        token
      }, node.ip, node.port);
    }
  }

  private getLocalIp(): string {
    const interfaces = require('os').networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  addBootstrapNode(ip: string, port: number) {
    this.sendMessage({ type: 'ping', id: this.nodeId }, ip, port);
  }

  getNodeCount(): number {
    return this.routingTable.size;
  }
}
