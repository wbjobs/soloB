import asyncio
import struct
import hashlib
import time
from typing import Dict, Set, Optional, Tuple, List
from collections import defaultdict

from .torrent_creator import TorrentCreator, PieceProvider


class BitTorrentPeer:
    """表示一个连接的Peer"""
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, 
                 peer_id: bytes, addr: Tuple[str, int]):
        self.reader = reader
        self.writer = writer
        self.peer_id = peer_id
        self.addr = addr
        self.connected = False
        self.am_choking = True
        self.am_interested = False
        self.peer_choking = True
        self.peer_interested = False
        self.bitfield = set()
        self.downloaded = 0
        self.uploaded = 0
        self.last_active = time.time()


class BitTorrentSeeder:
    """BitTorrent播种服务器 - 处理Peer连接并提供Piece数据"""
    
    def __init__(self, creator: TorrentCreator, piece_provider: PieceProvider, port: int = 6881):
        self.creator = creator
        self.piece_provider = piece_provider
        self.port = port
        self.infohash = creator.infohash
        self.peer_id = hashlib.sha1(b"-DS0001-" + bytes([int(time.time()) % 256] * 12)).digest()
        
        self.peers: Dict[Tuple[str, int], BitTorrentPeer] = {}
        self.active_connections = 0
        self.max_connections = 50
        
        self.server = None
        self._running = False
        
        # 统计信息
        self.total_uploaded = 0
        self.total_downloaded = 0
        self.connections_peak = 0
        
        # 扩散监控回调
        self.on_peer_connected = None
        self.on_piece_uploaded = None
        
    async def start(self):
        """启动播种服务器"""
        self._running = True
        self.server = await asyncio.start_server(
            self._handle_connection,
            '0.0.0.0',
            self.port
        )
        print(f"BitTorrent seeder started on port {self.port}")
        print(f"Peer ID: {self.peer_id.hex()}")
        print(f"Infohash: {self.infohash.hex()}")
        
        asyncio.create_task(self.server.serve_forever())
        
    async def stop(self):
        """停止播种服务器"""
        self._running = False
        if self.server:
            self.server.close()
            await self.server.wait_closed()
        
        for peer in list(self.peers.values()):
            try:
                peer.writer.close()
                await peer.writer.wait_closed()
            except:
                pass
        self.peers.clear()
        
    async def _handle_connection(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        """处理新的Peer连接"""
        addr = writer.get_extra_info('peername')
        if not addr:
            writer.close()
            return
            
        peer_addr = (addr[0], addr[1])
        
        if len(self.peers) >= self.max_connections:
            print(f"Max connections reached, rejecting {peer_addr}")
            writer.close()
            return
            
        try:
            handshake = await asyncio.wait_for(reader.read(68), timeout=10)
            if len(handshake) < 68:
                writer.close()
                return
                
            pstrlen = handshake[0]
            pstr = handshake[1:1+pstrlen]
            
            if pstr != b"BitTorrent protocol":
                writer.close()
                return
                
            reserved = handshake[1+pstrlen: 9+pstrlen]
            infohash = handshake[9+pstrlen: 29+pstrlen]
            peer_id = handshake[29+pstrlen: 49+pstrlen]
            
            if infohash != self.infohash:
                print(f"Wrong infohash from {peer_addr}")
                writer.close()
                return
                
            response_handshake = self._build_handshake()
            writer.write(response_handshake)
            await writer.drain()
            
            peer = BitTorrentPeer(reader, writer, peer_id, peer_addr)
            peer.connected = True
            self.peers[peer_addr] = peer
            self.active_connections += 1
            self.connections_peak = max(self.connections_peak, self.active_connections)
            
            if self.on_peer_connected:
                self.on_peer_connected(peer_addr, peer_id)
                
            print(f"Peer connected: {peer_addr[0]}:{peer_addr[1]}")
            print(f"Active peers: {len(self.peers)}")
            
            await self._send_bitfield(peer)
            
            await self._peer_message_loop(peer)
            
        except Exception as e:
            print(f"Connection error from {peer_addr}: {e}")
        finally:
            if peer_addr in self.peers:
                del self.peers[peer_addr]
                self.active_connections -= 1
            try:
                writer.close()
                await writer.wait_closed()
            except:
                pass
                
    def _build_handshake(self) -> bytes:
        """构建握手消息"""
        pstr = b"BitTorrent protocol"
        pstrlen = len(pstr)
        reserved = b"\x00" * 8
        return struct.pack("!B", pstrlen) + pstr + reserved + self.infohash + self.peer_id
        
    async def _send_bitfield(self, peer: BitTorrentPeer):
        """发送bitfield消息（我们有所有pieces）"""
        num_pieces = len(self.creator.piece_hashes)
        num_bytes = (num_pieces + 7) // 8
        bitfield = b"\xff" * (num_bytes - 1)
        
        last_bits = num_pieces % 8
        if last_bits > 0:
            last_byte = (0xff << (8 - last_bits)) & 0xff
            bitfield += bytes([last_byte])
        else:
            bitfield += b"\xff"
            
        msg_len = 1 + len(bitfield)
        msg = struct.pack("!IB", msg_len, 5) + bitfield
        peer.writer.write(msg)
        await peer.writer.drain()
        
    async def _peer_message_loop(self, peer: BitTorrentPeer):
        """处理Peer消息循环"""
        while self._running and peer.connected:
            try:
                msg_len_data = await asyncio.wait_for(peer.reader.readexactly(4), timeout=120)
                if not msg_len_data:
                    break
                    
                msg_len = struct.unpack("!I", msg_len_data)[0]
                
                if msg_len == 0:
                    peer.writer.write(b"\x00\x00\x00\x00")
                    await peer.writer.drain()
                    continue
                    
                msg_data = await asyncio.wait_for(peer.reader.readexactly(msg_len), timeout=30)
                if not msg_data:
                    break
                    
                msg_id = msg_data[0]
                payload = msg_data[1:]
                
                peer.last_active = time.time()
                
                await self._handle_message(peer, msg_id, payload)
                
            except asyncio.TimeoutError:
                    break
            except Exception as e:
                break
                
    async def _handle_message(self, peer: BitTorrentPeer, msg_id: int, payload: bytes):
        """处理单个Peer消息"""
        if msg_id == 0:
            peer.peer_choking = True
        elif msg_id == 1:
            peer.peer_choking = False
        elif msg_id == 2:
            peer.peer_interested = True
            await self._send_unchoke(peer)
        elif msg_id == 3:
            peer.peer_interested = False
        elif msg_id == 4:
            if len(payload) >= 4:
                piece_idx = struct.unpack("!I", payload[:4])[0]
                peer.bitfield.add(piece_idx)
        elif msg_id == 6:
            await self._handle_request(peer, payload)
        elif msg_id == 8:
            await self._handle_cancel(peer, payload)
            
    async def _send_unchoke(self, peer: BitTorrentPeer):
        """发送unchoke消息"""
        msg = struct.pack("!IB", 1, 1)
        peer.writer.write(msg)
        await peer.writer.drain()
        peer.am_choking = False
        
    async def _handle_request(self, peer: BitTorrentPeer, payload: bytes):
        """处理piece请求"""
        if len(payload) < 12:
            return
            
        index, begin, length = struct.unpack("!III", payload[:12])
        
        piece_data = self.piece_provider.get_piece(index)
        if not piece_data:
            return
            
        block_data = piece_data[begin:begin+length]
        
        response = struct.pack("!IBIII", 9 + len(block_data), 7, index, begin) + block_data
        
        peer.writer.write(response)
        await peer.writer.drain()
        
        peer.uploaded += len(block_data)
        self.total_uploaded += len(block_data)
        
        if self.on_piece_uploaded:
            self.on_piece_uploaded(peer.addr, index, len(block_data))
            
    async def _handle_cancel(self, peer: BitTorrentPeer, payload: bytes):
        """处理取消请求（忽略）"""
        pass
        
    def get_stats(self) -> Dict:
        """获取播种统计信息"""
        return {
            'active_peers': len(self.peers),
            'peak_connections': self.connections_peak,
            'total_uploaded_bytes': self.total_uploaded,
            'total_downloaded_bytes': self.total_downloaded,
            'upload_rate': self._calculate_upload_rate(),
            'piece_count': len(self.creator.piece_hashes),
            'total_size': self.creator.total_size
        }
        
    def _calculate_upload_rate(self) -> float:
        """计算上传速率（简化版）"""
        return 0.0
