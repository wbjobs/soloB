import asyncio
import socket
import struct
from typing import Optional, Tuple, Dict, List
from enum import Enum
import logging

logger = logging.getLogger(__name__)

class NATType(Enum):
    UNKNOWN = "unknown"
    OPEN_INTERNET = "open_internet"
    FULL_CONE = "full_cone"
    RESTRICTED_CONE = "restricted_cone"
    PORT_RESTRICTED_CONE = "port_restricted_cone"
    SYMMETRIC = "symmetric"
    BLOCKED = "blocked"

STUN_SERVERS = [
    ("stun.l.google.com", 19302),
    ("stun1.l.google.com", 19302),
    ("stun2.l.google.com", 19302),
    ("stun3.l.google.com", 19302),
    ("stun4.l.google.com", 19302),
    ("stun.ekiga.net", 3478),
    ("stun.softjoys.com", 3478),
    ("stun.voipbuster.com", 3478),
]

class STUNClient:
    BINDING_REQUEST = 0x0001
    BINDING_RESPONSE = 0x0101
    MAGIC_COOKIE = 0x2112A442
    
    def __init__(self):
        self.local_addr: Optional[Tuple[str, int]] = None
        self.mapped_addr: Optional[Tuple[str, int]] = None
        self.changed_addr: Optional[Tuple[str, int]] = None
        
    def _build_binding_request(self, transaction_id: bytes) -> bytes:
        msg_type = struct.pack('!H', self.BINDING_REQUEST)
        msg_length = struct.pack('!H', 0)
        magic_cookie = struct.pack('!I', self.MAGIC_COOKIE)
        return msg_type + msg_length + magic_cookie + transaction_id
    
    def _parse_stun_response(self, data: bytes) -> Dict:
        if len(data) < 20:
            return {}
            
        msg_type = struct.unpack('!H', data[0:2])[0]
        msg_length = struct.unpack('!H', data[2:4])[0]
        magic_cookie = struct.unpack('!I', data[4:8])[0]
        
        if magic_cookie != self.MAGIC_COOKIE:
            return {}
            
        if msg_type != self.BINDING_RESPONSE:
            return {}
            
        result = {}
        offset = 20
        
        while offset < 20 + msg_length and offset + 4 <= len(data):
            attr_type = struct.unpack('!H', data[offset:offset+2])[0]
            attr_length = struct.unpack('!H', data[offset+2:offset+4])[0]
            attr_value = data[offset+4:offset+4+attr_length]
            
            if attr_type == 0x0001:
                if len(attr_value) >= 8:
                    family = struct.unpack('!H', attr_value[0:2])[0]
                    port = struct.unpack('!H', attr_value[2:4])[0]
                    if family == 0x01:
                        ip = socket.inet_ntoa(attr_value[4:8])
                        result['mapped_address'] = (ip, port)
            elif attr_type == 0x0005:
                if len(attr_value) >= 8:
                    family = struct.unpack('!H', attr_value[0:2])[0]
                    port = struct.unpack('!H', attr_value[2:4])[0]
                    if family == 0x01:
                        ip = socket.inet_ntoa(attr_value[4:8])
                        result['changed_address'] = (ip, port)
            
            offset += 4 + ((attr_length + 3) & ~3)
            
        return result
    
    async def _send_stun_request(self, sock, server_addr: Tuple[str, int], 
                                  transaction_id: bytes) -> Optional[Dict]:
        try:
            sock.sendto(self._build_binding_request(transaction_id), server_addr)
            
            data, addr = await asyncio.wait_for(
                asyncio.get_event_loop().sock_recvfrom(sock, 1024),
                timeout=3.0
            )
            
            return self._parse_stun_response(data)
        except Exception as e:
            logger.debug(f"STUN request to {server_addr} failed: {e}")
            return None
    
    async def discover(self, local_port: int = 0) -> Tuple[Optional[Tuple[str, int]], 
                                                             Optional[Tuple[str, int]]]:
        loop = asyncio.get_event_loop()
        
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setblocking(False)
        sock.bind(('0.0.0.0', local_port))
        
        self.local_addr = sock.getsockname()
        
        for server in STUN_SERVERS:
            try:
                transaction_id = bytes([ord('0') + i for i in range(12)])
                result = await self._send_stun_request(sock, server, transaction_id)
                
                if 'mapped_address' in result:
                    self.mapped_addr = result['mapped_address']
                    if 'changed_address' in result:
                        self.changed_addr = result['changed_address']
                    break
            except:
                continue
        
        sock.close()
        return self.mapped_addr, self.changed_addr

class NATDetector:
    def __init__(self):
        self.nat_type: NATType = NATType.UNKNOWN
        self.external_ip: Optional[str] = None
        self.external_port: Optional[int] = None
        self.is_nated: bool = False
        
    async def detect(self, port: int = 0) -> NATType:
        logger.info("Starting NAT type detection...")
        
        stun = STUNClient()
        mapped_addr, changed_addr = await stun.discover(port)
        
        if not mapped_addr:
            self.nat_type = NATType.BLOCKED
            logger.info("NAT detection result: BLOCKED (no STUN response)")
            return self.nat_type
            
        self.external_ip, self.external_port = mapped_addr
        local_ip = stun.local_addr[0]
        
        if local_ip == self.external_ip:
            self.nat_type = NATType.OPEN_INTERNET
            self.is_nated = False
            logger.info(f"NAT detection result: OPEN_INTERNET (public IP: {self.external_ip})")
            return self.nat_type
            
        self.is_nated = True
        
        mapping_consistent = await self._check_mapping_consistency(port)
        
        if mapping_consistent:
            filtering_result = await self._check_filtering(port)
            
            if filtering_result == "full_cone":
                self.nat_type = NATType.FULL_CONE
            elif filtering_result == "restricted_cone":
                self.nat_type = NATType.RESTRICTED_CONE
            else:
                self.nat_type = NATType.PORT_RESTRICTED_CONE
        else:
            self.nat_type = NATType.SYMMETRIC
            
        logger.info(f"NAT detection result: {self.nat_type.value} (external: {self.external_ip}:{self.external_port})")
        return self.nat_type
    
    async def _check_mapping_consistency(self, port: int) -> bool:
        mappings = set()
        
        for i in range(3):
            stun = STUNClient()
            mapped_addr, _ = await stun.discover(port)
            if mapped_addr:
                mappings.add(mapped_addr)
        
        return len(mappings) == 1
    
    async def _check_filtering(self, port: int) -> str:
        return "port_restricted_cone"
    
    def get_recommended_strategy(self) -> List[str]:
        strategies = []
        
        if self.nat_type == NATType.OPEN_INTERNET:
            strategies = ["direct_udp"]
        elif self.nat_type == NATType.FULL_CONE:
            strategies = ["direct_udp", "upnp"]
        elif self.nat_type == NATType.RESTRICTED_CONE:
            strategies = ["upnp", "relay", "direct_udp"]
        elif self.nat_type == NATType.PORT_RESTRICTED_CONE:
            strategies = ["upnp", "hole_punch", "relay"]
        elif self.nat_type == NATType.SYMMETRIC:
            strategies = ["upnp", "relay", "tcp_fallback", "quic_fallback"]
        else:
            strategies = ["relay", "tcp_fallback", "quic_fallback"]
            
        return strategies
    
    def get_strategy_description(self) -> str:
        descriptions = {
            NATType.OPEN_INTERNET: "直接连接 - 公网IP，无需穿透",
            NATType.FULL_CONE: "全锥型NAT - 可直接接收外部连接",
            NATType.RESTRICTED_CONE: "限制锥型NAT - 仅接收已知地址的连接",
            NATType.PORT_RESTRICTED_CONE: "端口限制锥型NAT - 需要UPnP或打洞",
            NATType.SYMMETRIC: "对称型NAT - 最严格的NAT，优先使用中继",
            NATType.BLOCKED: "UDP被封锁 - 使用TCP/QUIC fallback",
            NATType.UNKNOWN: "未知NAT类型 - 尝试所有策略"
        }
        return descriptions.get(self.nat_type, "未知策略")
