import asyncio
import struct
import hashlib
import bencode
from typing import Dict, List, Tuple, Optional, Set
from collections import defaultdict

class FileAnalyzer:
    def __init__(self):
        self.downloaded_pieces: Set[int] = set()
        self.piece_hashes: List[bytes] = []
        self.piece_size: int = 0
        self.total_size: int = 0
        self.files: List[dict] = []
        
    def parse_torrent(self, torrent_data: bytes) -> dict:
        try:
            torrent = bencode.decode(torrent_data)
            info = torrent.get(b'info') or torrent.get('info', {})
            
            self.piece_size = info.get(b'piece length') or info.get('piece length', 0)
            pieces = info.get(b'pieces') or info.get('pieces', b'')
            
            self.piece_hashes = [pieces[i:i+20] for i in range(0, len(pieces), 20)]
            
            if b'files' in info or 'files' in info:
                files = info.get(b'files') or info.get('files', [])
                self.files = []
                self.total_size = 0
                for f in files:
                    path = f.get(b'path') or f.get('path', [])
                    if isinstance(path, list):
                        path = '/'.join(p.decode('utf-8') if isinstance(p, bytes) else str(p) for p in path)
                    length = f.get(b'length') or f.get('length', 0)
                    self.files.append({
                        'path': path,
                        'size': length
                    })
                    self.total_size += length
            else:
                name = info.get(b'name') or info.get('name', 'unknown')
                if isinstance(name, bytes):
                    name = name.decode('utf-8')
                length = info.get(b'length') or info.get('length', 0)
                self.files = [{'path': name, 'size': length}]
                self.total_size = length
            
            return {
                'piece_count': len(self.piece_hashes),
                'piece_size': self.piece_size,
                'total_size': self.total_size,
                'files': self.files
            }
        except Exception as e:
            print(f"Error parsing torrent: {e}")
            return {}
    
    async def download_piece(self, peer_addr: Tuple[str, int], infohash: bytes, 
                            piece_index: int) -> Optional[bytes]:
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(peer_addr[0], peer_addr[1]),
                timeout=10
            )
            
            pstr = b"BitTorrent protocol"
            handshake = struct.pack("!B", len(pstr)) + pstr + b"\x00" * 8 + infohash + hashlib.sha1(b"-FA0001-" + b"0" * 12).digest()
            writer.write(handshake)
            await asyncio.wait_for(writer.drain(), timeout=5)
            
            response = await asyncio.wait_for(reader.read(68), timeout=5)
            if len(response) < 68:
                writer.close()
                return None
            
            bitfield_msg = await asyncio.wait_for(self.read_message(reader), timeout=5)
            if bitfield_msg and bitfield_msg[0] == 5:
                have_piece = self.check_piece_in_bitfield(bitfield_msg[1:], piece_index)
                if not have_piece:
                    writer.close()
                    return None
            
            interested_msg = struct.pack("!IB", 1, 2)
            writer.write(interested_msg)
            await asyncio.wait_for(writer.drain(), timeout=5)
            
            unchoke_msg = await asyncio.wait_for(self.read_message(reader), timeout=10)
            
            piece_begin = 0
            piece_length = min(self.piece_size, 16384)
            block_data = b""
            
            while piece_begin < self.piece_size:
                request_msg = struct.pack("!IBIII", 13, 6, piece_index, piece_begin, piece_length)
                writer.write(request_msg)
                await asyncio.wait_for(writer.drain(), timeout=5)
                
                piece_msg = await asyncio.wait_for(self.read_message(reader), timeout=15)
                if piece_msg and piece_msg[0] == 7:
                    idx, begin, data = struct.unpack("!II", piece_msg[1:9])[0], struct.unpack("!II", piece_msg[1:9])[1], piece_msg[9:]
                    if idx == piece_index and begin == piece_begin:
                        block_data += data
                        piece_begin += len(data)
                        piece_length = min(self.piece_size - piece_begin, 16384)
                    else:
                        break
                else:
                    break
            
            writer.close()
            await writer.wait_closed()
            
            if len(block_data) > 0 and len(block_data) <= self.piece_size:
                if piece_index < len(self.piece_hashes):
                    block_hash = hashlib.sha1(block_data).digest()
                    if block_hash == self.piece_hashes[piece_index]:
                        self.downloaded_pieces.add(piece_index)
                        return block_data
            
            return None
        except Exception as e:
            return None
    
    async def read_message(self, reader) -> Optional[bytes]:
        try:
            length_data = await reader.readexactly(4)
            length = struct.unpack("!I", length_data)[0]
            if length == 0:
                return b""
            message = await reader.readexactly(length)
            return message
        except:
            return None
    
    def check_piece_in_bitfield(self, bitfield: bytes, piece_index: int) -> bool:
        byte_index = piece_index // 8
        bit_index = 7 - (piece_index % 8)
        if byte_index >= len(bitfield):
            return False
        return (bitfield[byte_index] >> bit_index) & 1 == 1
    
    async def analyze_file_integrity(self, peers: List[Tuple[str, int]], infohash: str,
                                     max_pieces_to_check: int = 10) -> dict:
        infohash_bytes = bytes.fromhex(infohash) if len(infohash) == 40 else infohash.encode()
        
        if not self.piece_hashes:
            return {'error': 'Torrent metadata not available'}
        
        pieces_to_check = min(max_pieces_to_check, len(self.piece_hashes))
        pieces_checked = 0
        pieces_valid = 0
        
        semaphore = asyncio.Semaphore(5)
        
        async def check_piece(piece_idx: int):
            nonlocal pieces_checked, pieces_valid
            async with semaphore:
                for peer_addr in peers[:10]:
                    data = await self.download_piece(peer_addr, infohash_bytes, piece_idx)
                    if data is not None:
                        pieces_checked += 1
                        pieces_valid += 1
                        break
        
        tasks = [check_piece(i) for i in range(pieces_to_check)]
        await asyncio.gather(*tasks, return_exceptions=True)
        
        integrity_score = pieces_valid / pieces_to_check if pieces_to_check > 0 else 0
        
        availability_map = defaultdict(int)
        for piece_idx in self.downloaded_pieces:
            availability_map[piece_idx] += 1
        
        return {
            'total_pieces': len(self.piece_hashes),
            'pieces_checked': pieces_to_check,
            'pieces_valid': pieces_valid,
            'integrity_score': round(integrity_score, 4),
            'downloaded_pieces_count': len(self.downloaded_pieces),
            'completion_percentage': round(len(self.downloaded_pieces) / len(self.piece_hashes) * 100, 2) if self.piece_hashes else 0,
            'total_size': self.total_size,
            'files': self.files
        }
    
    def get_file_distribution(self) -> dict:
        file_status = []
        for f in self.files:
            file_status.append({
                'path': f['path'],
                'size': f['size'],
                'size_human': self.format_size(f['size'])
            })
        
        return {
            'file_count': len(self.files),
            'files': file_status,
            'total_size': self.total_size,
            'total_size_human': self.format_size(self.total_size)
        }
    
    def format_size(self, size: int) -> str:
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size < 1024:
                return f"{size:.2f} {unit}"
            size /= 1024
        return f"{size:.2f} PB"
