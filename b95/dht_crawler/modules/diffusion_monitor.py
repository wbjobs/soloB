import time
import json
from typing import Dict, Set, Tuple, List, Optional
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta


@dataclass
class PeerRecord:
    """Peer连接记录"""
    ip: str
    port: int
    peer_id: bytes
    first_seen: float
    last_seen: float
    pieces_downloaded: Set[int] = field(default_factory=set)
    total_bytes_downloaded: int = 0
    is_seeder: bool = False


@dataclass
class DiffusionEvent:
    """扩散事件"""
    timestamp: float
    event_type: str  # 'connect', 'disconnect', 'piece_download', 'became_seeder'
    peer_addr: Tuple[str, int]
    details: dict = field(default_factory=dict)


class DiffusionMonitor:
    """扩散监控器 - 追踪种子扩散过程和速度"""
    
    def __init__(self, infohash: str, seed_node_id: bytes):
        self.infohash = infohash
        self.seed_node_id = seed_node_id
        self.start_time = time.time()
        
        self.peers: Dict[Tuple[str, int], PeerRecord] = {}
        self.disconnected_peers: Dict[Tuple[str, int], PeerRecord] = {}
        self.events: List[DiffusionEvent] = []
        
        # 扩散拓扑 - 邻接表 (peer -> set of peers it likely received from)
        self.adjacency: Dict[str, Set[str]] = defaultdict(set)
        
        # 种子节点标识
        self.seed_node_key = self._addr_to_key(('0.0.0.0', 0))
        self.adjacency[self.seed_node_key] = set()
        
        # 统计
        self.total_unique_peers = 0
        self.total_pieces_distributed = 0
        self.peak_concurrent_peers = 0
        self.completed_seeders = 0
        
        # Piece分发追踪
        self.piece_distribution: Dict[int, Set[str]] = defaultdict(set)
        
    def _addr_to_key(self, addr: Tuple[str, int]) -> str:
        """将地址转换为字符串键"""
        return f"{addr[0]}:{addr[1]}"
        
    def on_peer_connected(self, addr: Tuple[str, int], peer_id: bytes):
        """Peer连接事件"""
        key = self._addr_to_key(addr)
        
        if key not in self.peers:
            peer = PeerRecord(
                ip=addr[0],
                port=addr[1],
                peer_id=peer_id,
                first_seen=time.time(),
                last_seen=time.time()
            )
            self.peers[key] = peer
            self.total_unique_peers += 1
            
            # 新连接的peer很可能从我们这获取，添加到拓扑
            self.adjacency[self.seed_node_key].add(key)
            if key not in self.adjacency:
                self.adjacency[key] = set()
                
        else:
            self.peers[key].last_seen = time.time()
            
        self.peak_concurrent_peers = max(self.peak_concurrent_peers, len(self.peers))
        
        self.events.append(DiffusionEvent(
            timestamp=time.time(),
            event_type='connect',
            peer_addr=addr,
            details={'peer_count': len(self.peers)}
        ))
        
    def on_peer_disconnected(self, addr: Tuple[str, int]):
        """Peer断开事件"""
        key = self._addr_to_key(addr)
        
        if key in self.peers:
            peer = self.peers[key]
            peer.last_seen = time.time()
            
            if len(peer.pieces_downloaded) >= len(self.piece_distribution):
                peer.is_seeder = True
                self.completed_seeders += 1
                
            self.disconnected_peers[key] = peer
            del self.peers[key]
            
            self.events.append(DiffusionEvent(
                timestamp=time.time(),
                event_type='disconnect',
                peer_addr=addr,
                details={
                    'pieces_downloaded': len(peer.pieces_downloaded),
                    'total_bytes': peer.total_bytes_downloaded,
                    'became_seeder': peer.is_seeder
                }
            ))
            
    def on_piece_downloaded(self, addr: Tuple[str, int], piece_index: int, bytes_downloaded: int):
        """Piece下载事件"""
        key = self._addr_to_key(addr)
        
        if key in self.peers:
            peer = self.peers[key]
            peer.pieces_downloaded.add(piece_index)
            peer.total_bytes_downloaded += bytes_downloaded
            
            self.piece_distribution[piece_index].add(key)
            self.total_pieces_distributed += 1
            
            self.events.append(DiffusionEvent(
                timestamp=time.time(),
                event_type='piece_download',
                peer_addr=addr,
                details={
                    'piece_index': piece_index,
                    'bytes': bytes_downloaded,
                    'total_pieces_for_peer': len(peer.pieces_downloaded)
                }
            ))
            
    def get_diffusion_speed(self, window_seconds: int = 60) -> Dict:
        """计算扩散速度"""
        now = time.time()
        window_start = now - window_seconds
        
        recent_peers = sum(
            1 for p in self.peers.values() 
            if p.first_seen >= window_start
        )
        
        recent_pieces = sum(
            1 for e in self.events 
            if e.event_type == 'piece_download' and e.timestamp >= window_start
        )
        
        recent_bytes = sum(
            e.details.get('bytes', 0) 
            for e in self.events 
            if e.event_type == 'piece_download' and e.timestamp >= window_start
        )
        
        elapsed = now - self.start_time
        return {
            'peers_per_minute': (recent_peers / window_seconds) * 60,
            'pieces_per_minute': (recent_pieces / window_seconds) * 60,
            'bytes_per_second': recent_bytes / window_seconds,
            'avg_peers_per_hour': (self.total_unique_peers / elapsed) * 3600 if elapsed > 0 else 0,
            'total_unique_peers': self.total_unique_peers,
            'concurrent_peers': len(self.peers),
            'peak_concurrent_peers': self.peak_concurrent_peers
        }
        
    def get_topology_adjacency_list(self) -> Dict[str, List[str]]:
        """生成邻接表格式的拓扑图"""
        result = {}
        
        for node, neighbors in self.adjacency.items():
            if node == self.seed_node_key:
                result['seed'] = sorted(list(neighbors))
            else:
                result[node] = sorted(list(neighbors))
                
        return result
        
    def get_detailed_topology(self) -> Dict:
        """生成详细拓扑信息"""
        topology = self.get_topology_adjacency_list()
        
        peer_details = {}
        for key, peer in self.peers.items():
            peer_details[key] = {
                'ip': peer.ip,
                'port': peer.port,
                'connected_seconds': int(time.time() - peer.first_seen),
                'pieces_downloaded': len(peer.pieces_downloaded),
                'total_bytes_downloaded': peer.total_bytes_downloaded,
                'is_seeder': peer.is_seeder
            }
            
        for key, peer in self.disconnected_peers.items():
            peer_details[f"{key} (disconnected)"] = {
                'ip': peer.ip,
                'port': peer.port,
                'connected_seconds': int(peer.last_seen - peer.first_seen),
                'pieces_downloaded': len(peer.pieces_downloaded),
                'total_bytes_downloaded': peer.total_bytes_downloaded,
                'is_seeder': peer.is_seeder
            }
            
        return {
            'infohash': self.infohash,
            'seed_node': 'seed',
            'adjacency_list': topology,
            'peer_details': peer_details,
            'piece_distribution': {
                str(piece): sorted(list(peers)) 
                for piece, peers in self.piece_distribution.items()
            }
        }
        
    def get_distribution_coverage(self) -> Dict:
        """获取Piece分发覆盖情况"""
        total_pieces = len(self.piece_distribution)
        if total_pieces == 0:
            return {
                'total_pieces': 0,
                'distributed_pieces': 0,
                'coverage_percent': 0.0,
                'avg_peers_per_piece': 0.0
            }
            
        distributed_pieces = sum(1 for peers in self.piece_distribution.values() if len(peers) > 0)
        avg_peers_per_piece = sum(len(peers) for peers in self.piece_distribution.values()) / total_pieces
        
        return {
            'total_pieces': total_pieces,
            'distributed_pieces': distributed_pieces,
            'coverage_percent': (distributed_pieces / total_pieces) * 100,
            'avg_peers_per_piece': avg_peers_per_piece
        }
        
    def save_topology_json(self, output_path: str):
        """保存拓扑图为JSON文件"""
        topology = self.get_detailed_topology()
        
        topology['statistics'] = {
            'elapsed_time_seconds': int(time.time() - self.start_time),
            'diffusion_speed': self.get_diffusion_speed(),
            'coverage': self.get_distribution_coverage(),
            'completed_seeders': self.completed_seeders,
            'total_pieces_distributed': self.total_pieces_distributed
        }
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(topology, f, indent=2, ensure_ascii=False)
            
        return output_path
        
    def print_summary(self):
        """打印扩散摘要"""
        elapsed = int(time.time() - self.start_time)
        hours, remainder = divmod(elapsed, 3600)
        minutes, seconds = divmod(remainder, 60)
        
        print("\n" + "="*60)
        print("种子扩散状态摘要")
        print("="*60)
        print(f"运行时间: {hours:02d}:{minutes:02d}:{seconds:02d}")
        print(f"活跃Peer数: {len(self.peers)}")
        print(f"峰值Peer数: {self.peak_concurrent_peers}")
        print(f"总唯一Peer数: {self.total_unique_peers}")
        print(f"完整下载完成数: {self.completed_seeders}")
        print()
        
        speed = self.get_diffusion_speed()
        print(f"扩散速度:")
        print(f"  Peer/分钟: {speed['peers_per_minute']:.2f}")
        print(f"  Piece/分钟: {speed['pieces_per_minute']:.2f}")
        print(f"  传输速率: {speed['bytes_per_second'] / 1024:.2f} KB/s")
        print()
        
        coverage = self.get_distribution_coverage()
        print(f"Piece分发覆盖:")
        print(f"  总Piece数: {coverage['total_pieces']}")
        print(f"  已分发: {coverage['distributed_pieces']} ({coverage['coverage_percent']:.1f}%)")
        print(f"  平均每Piece分享数: {coverage['avg_peers_per_piece']:.1f}")
        print("="*60 + "\n")
