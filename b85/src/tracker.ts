import * as http from 'http';
import * as url from 'url';
import { NodeInfo, TrackerAnnounceRequest, TrackerAnnounceResponse } from './types';
import { calculateSubnet, generateNodeId } from './utils';

interface TorrentState {
  complete: number;
  incomplete: number;
  peers: Map<string, NodeInfo>;
}

export class TrackerServer {
  private server: http.Server;
  private torrents: Map<string, TorrentState> = new Map();
  private port: number;

  constructor(port: number = 8080) {
    this.port = port;
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`Tracker server running on port ${this.port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const parsedUrl = url.parse(req.url || '', true);
    const pathname = parsedUrl.pathname;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (pathname === '/announce') {
      this.handleAnnounce(parsedUrl.query, req, res);
    } else if (pathname === '/scrape') {
      this.handleScrape(parsedUrl.query, res);
    } else if (pathname === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  private handleAnnounce(query: any, req: http.IncomingMessage, res: http.ServerResponse) {
    const infoHash = query.info_hash as string;
    const nodeId = query.node_id as string;
    const port = parseInt(query.port as string) || 0;
    const event = query.event as 'started' | 'stopped' | 'completed';
    const downloaded = parseInt(query.downloaded as string) || 0;
    const uploaded = parseInt(query.uploaded as string) || 0;
    const left = parseInt(query.left as string) || 0;

    if (!infoHash || !nodeId || !port) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing required parameters' }));
      return;
    }

    const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
    const subnet = calculateSubnet(ip);

    let torrent = this.torrents.get(infoHash);
    if (!torrent) {
      torrent = {
        complete: 0,
        incomplete: 0,
        peers: new Map()
      };
      this.torrents.set(infoHash, torrent);
    }

    const nodeInfo: NodeInfo = {
      id: nodeId,
      ip,
      port,
      subnet,
      lastSeen: Date.now(),
      availableChunks: new Set(),
      uploadSpeed: 0,
      downloadSpeed: 0
    };

    if (event === 'started') {
      torrent.peers.set(nodeId, nodeInfo);
      if (left === 0) {
        torrent.complete++;
      } else {
        torrent.incomplete++;
      }
    } else if (event === 'stopped') {
      torrent.peers.delete(nodeId);
      if (left === 0) {
        torrent.complete--;
      } else {
        torrent.incomplete--;
      }
    } else if (event === 'completed') {
      torrent.incomplete--;
      torrent.complete++;
      torrent.peers.set(nodeId, nodeInfo);
    } else {
      torrent.peers.set(nodeId, nodeInfo);
    }

    const peers = Array.from(torrent.peers.values())
      .filter(p => p.id !== nodeId)
      .slice(0, 50);

    const response: TrackerAnnounceResponse = {
      peers,
      interval: 60,
      complete: torrent.complete,
      incomplete: torrent.incomplete
    };

    res.writeHead(200);
    res.end(JSON.stringify(response));
  }

  private handleScrape(query: any, res: http.ServerResponse) {
    const infoHash = query.info_hash as string;
    
    if (infoHash) {
      const torrent = this.torrents.get(infoHash);
      if (torrent) {
        res.end(JSON.stringify({
          [infoHash]: {
            complete: torrent.complete,
            incomplete: torrent.incomplete,
            peers: torrent.peers.size
          }
        }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Torrent not found' }));
      }
    } else {
      const result: any = {};
      this.torrents.forEach((torrent, hash) => {
        result[hash] = {
          complete: torrent.complete,
          incomplete: torrent.incomplete,
          peers: torrent.peers.size
        };
      });
      res.end(JSON.stringify(result));
    }
  }

  getPeers(infoHash: string): NodeInfo[] {
    const torrent = this.torrents.get(infoHash);
    return torrent ? Array.from(torrent.peers.values()) : [];
  }
}

export class TrackerClient {
  private trackerUrl: string;
  private nodeId: string;

  constructor(trackerUrl: string) {
    this.trackerUrl = trackerUrl;
    this.nodeId = generateNodeId();
  }

  async announce(
    infoHash: string,
    port: number,
    event: 'started' | 'stopped' | 'completed' = 'started',
    downloaded: number = 0,
    uploaded: number = 0,
    left: number = 0
  ): Promise<TrackerAnnounceResponse> {
    const params = new URLSearchParams({
      info_hash: infoHash,
      node_id: this.nodeId,
      port: port.toString(),
      event,
      downloaded: downloaded.toString(),
      uploaded: uploaded.toString(),
      left: left.toString()
    });

    const response = await fetch(`${this.trackerUrl}/announce?${params}`);
    if (!response.ok) {
      throw new Error(`Tracker request failed: ${response.status}`);
    }

    return response.json() as Promise<TrackerAnnounceResponse>;
  }

  async scrape(infoHash?: string): Promise<any> {
    const params = infoHash ? `?info_hash=${infoHash}` : '';
    const response = await fetch(`${this.trackerUrl}/scrape${params}`);
    if (!response.ok) {
      throw new Error(`Scrape request failed: ${response.status}`);
    }
    return response.json();
  }
}
