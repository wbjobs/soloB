import os
import hashlib
import bencode
from typing import List, Dict, Optional, Tuple
from pathlib import Path
import math


class TorrentCreator:
    def __init__(self, piece_size: int = 262144):  # 默认256KB
        self.piece_size = piece_size
        self.piece_hashes: List[bytes] = []
        self.files: List[Dict] = []
        self.total_size = 0
        self.name = ""
        self.infohash: Optional[bytes] = None
        self.infohash_hex: Optional[str] = None
        
    def create_from_file(self, file_path: str, name: Optional[str] = None) -> Dict:
        """从单个文件创建种子"""
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
            
        self.name = name or path.name
        self.files = [{
            'path': path.name,
            'length': path.stat().st_size
        }]
        self.total_size = path.stat().st_size
        
        self._calculate_piece_hashes_single(path)
        return self._build_torrent_dict()
        
    def create_from_directory(self, dir_path: str, name: Optional[str] = None) -> Dict:
        """从目录创建种子"""
        path = Path(dir_path)
        if not path.exists() or not path.is_dir():
            raise NotADirectoryError(f"Directory not found: {dir_path}")
            
        self.name = name or path.name
        self._collect_files(path)
        self._calculate_piece_hashes_multi(path)
        return self._build_torrent_dict()
        
    def _collect_files(self, root_path: Path):
        """收集目录下所有文件"""
        self.files = []
        self.total_size = 0
        
        for file_path in root_path.rglob("*"):
            if file_path.is_file():
                rel_path = file_path.relative_to(root_path)
                file_length = file_path.stat().st_size
                self.files.append({
                    'path': str(rel_path),
                    'length': file_length
                })
                self.total_size += file_length
                
        self.files.sort(key=lambda x: x['path'])
        
    def _calculate_piece_hashes_single(self, file_path: Path):
        """计算单个文件的piece哈希"""
        self.piece_hashes = []
        file_size = file_path.stat().st_size
        num_pieces = math.ceil(file_size / self.piece_size)
        
        with open(file_path, 'rb') as f:
            for i in range(num_pieces):
                piece_data = f.read(self.piece_size)
                piece_hash = hashlib.sha1(piece_data).digest()
                self.piece_hashes.append(piece_hash)
                
    def _calculate_piece_hashes_multi(self, root_path: Path):
        """计算多文件的piece哈希（连续读取）"""
        self.piece_hashes = []
        current_piece = b""
        
        for file_info in self.files:
            file_path = root_path / file_info['path']
            with open(file_path, 'rb') as f:
                while True:
                    chunk = f.read(self.piece_size - len(current_piece))
                    if not chunk:
                        break
                    current_piece += chunk
                    if len(current_piece) == self.piece_size:
                        piece_hash = hashlib.sha1(current_piece).digest()
                        self.piece_hashes.append(piece_hash)
                        current_piece = b""
                        
        if current_piece:
            piece_hash = hashlib.sha1(current_piece).digest()
            self.piece_hashes.append(piece_hash)
            
    def _build_torrent_dict(self) -> Dict:
        """构建torrent字典并计算infohash"""
        pieces = b"".join(self.piece_hashes)
        
        if len(self.files) == 1:
            info = {
                b'name': self.name.encode('utf-8'),
                b'piece length': self.piece_size,
                b'pieces': pieces,
                b'length': self.files[0]['length']
            }
        else:
            files_list = []
            for f in self.files:
                path_parts = f['path'].split(os.sep)
                files_list.append({
                    b'path': [p.encode('utf-8') for p in path_parts],
                    b'length': f['length']
                })
            info = {
                b'name': self.name.encode('utf-8'),
                b'piece length': self.piece_size,
                b'pieces': pieces,
                b'files': files_list
            }
        
        bencoded_info = bencode.encode(info)
        self.infohash = hashlib.sha1(bencoded_info).digest()
        self.infohash_hex = self.infohash.hex()
        
        torrent = {
            b'announce': b'',
            b'announce-list': [],
            b'created by': b'DHT Seeder',
            b'comment': b'Created for DHT seeding',
            b'info': info
        }
        
        return torrent
        
    def get_magnet_link(self, trackers: Optional[List[str]] = None) -> str:
        """生成magnet link"""
        if not self.infohash_hex:
            raise ValueError("Torrent not created yet")
            
        magnet = f"magnet:?xt=urn:btih:{self.infohash_hex}"
        magnet += f"&dn={self.name}"
        
        if trackers:
            for tracker in trackers:
                magnet += f"&tr={tracker}"
                
        return magnet
        
    def save_torrent(self, output_path: str):
        """保存torrent文件"""
        torrent = self._build_torrent_dict()
        with open(output_path, 'wb') as f:
            f.write(bencode.encode(torrent))
        return output_path


class PieceProvider:
    """Piece数据提供器"""
    def __init__(self, creator: TorrentCreator, root_path: str):
        self.creator = creator
        self.root_path = Path(root_path)
        self.piece_size = creator.piece_size
        self._file_cache = {}
        
    def get_piece(self, piece_index: int) -> Optional[bytes]:
        """获取指定piece的数据"""
        if piece_index >= len(self.creator.piece_hashes):
            return None
            
        if len(self.creator.files) == 1:
            return self._get_piece_single(piece_index)
        else:
            return self._get_piece_multi(piece_index)
            
    def _get_piece_single(self, piece_index: int) -> Optional[bytes]:
        """单文件模式获取piece"""
        file_path = self.root_path / self.creator.files[0]['path']
        offset = piece_index * self.piece_size
        
        with open(file_path, 'rb') as f:
            f.seek(offset)
            return f.read(self.piece_size)
            
    def _get_piece_multi(self, piece_index: int) -> Optional[bytes]:
        """多文件模式获取piece（可能跨文件）"""
        piece_data = b""
        remaining = self.piece_size
        global_offset = piece_index * self.piece_size
        
        for file_info in self.creator.files:
            file_length = file_info['length']
            
            if global_offset >= file_length:
                global_offset -= file_length
                continue
                
            file_path = self.root_path / file_info['path']
            bytes_to_read = min(remaining, file_length - global_offset)
            
            with open(file_path, 'rb') as f:
                f.seek(global_offset)
                piece_data += f.read(bytes_to_read)
                
            remaining -= bytes_to_read
            global_offset = 0
            
            if remaining <= 0:
                break
                
        return piece_data if piece_data else None
