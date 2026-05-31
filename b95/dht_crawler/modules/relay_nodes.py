import asyncio
import random
import bencode
import hashlib
import socket
from typing import List, Tuple, Dict, Optional, Set
from collections import OrderedDict
from dataclasses import dataclass
from enum import Enum
import logging

logger = logging.getLogger(__name__)

class RelayStatus(Enum):
    UNKNOWN = "unknown"
    ONLINE = "online"
    OFFLINE = "offline"
    BUSY = "busy"

@dataclass
class RelayNode:
    host: str
    port: int
    public_key: Optional[bytes] = None
    status: RelayStatus = RelayStatus.UNKNOWN
    latency: float = 9999.0
    success_count: int = 0
    fail_count: int = 0
    
    @property
    def addr(self) -> Tuple[str, int]:
        return (self.host, self.port)
    
    @property
    def reliability(self) -> float:
        total = self.success_count + self.fail_count
        if total == 0:
            return 0.5
        return self.success_count / total

PREDEFINED_RELAYS = [
    RelayNode("router.bittorrent.com", 6881),
    RelayNode("dht.transmissionbt.com", 6881),
    RelayNode("router.utorrent.com", 6881),
    RelayNode("dht.libtorrent.org", 25401),
    RelayNode("dht.aelitis.com", 6881),
    RelayNode("dht.node.pw", 6881),
    RelayNode("bootstrap.jami.net", 4222),
    RelayNode("dht.ratnetwork.org", 6881),
]

class RelayManager:
    def __init__(self, max_relays: int = 10):
        self.max_relays = max_relays
        self.relays: List[RelayNode] = list(PREDEFINED_RELAYS[:max_relays])
        self.active_relays: List[RelayNode] = []
        self.relay_stats: Dict[Tuple[str, int], Dict] = {}
        self._pending_requests: Dict[bytes, Tuple[asyncio.Future, RelayNode]] = {}
        self._transport = None
        
    async def initialize(self, transport=None):
        self._transport = transport
        await self._probe_relays()
        self._select_active_relays()
        
    async def _probe_relays(self, timeout: float = 3.0):
        async def probe_relay(relay: RelayNode):
            start = asyncio.get_event_loop().time()
            try:
                if self._transport:
                    msg_id = bytes([random.randint(0, 255) for _ in range(4)])
                    ping_msg = {
                        "t": msg_id,
                        "y": "q",
                        "q": "ping",
                        "a": {"id": hashlib.sha1(b"relay_probe").digest()}
                    }
                    
                    encoded = bencode.encode(ping_msg)
                    self._transport.sendto(encoded, relay.addr)
                    
                    await asyncio.sleep(min(timeout, 1.0))
                    
                    relay.status = RelayStatus.ONLINE
                    relay.latency = (asyncio.get_event_loop().time() - start) * 1000
                    relay.success_count += 1
                else:
                    reader, writer = await asyncio.wait_for(
                        asyncio.open_connection(relay.host, relay.port),
                        timeout=timeout
                    )
                    writer.close()
                    await writer.wait_closed()
                    
                    relay.status = RelayStatus.ONLINE
                    relay.latency = (asyncio.get_event_loop().time() - start) * 1000
                    relay.success_count += 1
                    
            except Exception as e:
                relay.status = RelayStatus.OFFLINE
                relay.fail_count += 1
                logger.debug(f"Relay probe failed for {relay.host}:{relay.port}: {e}")
        
        tasks = [probe_relay(relay) for relay in self.relays]
        await asyncio.gather(*tasks, return_exceptions=True)
        
    def _select_active_relays(self, min_reliability: float = 0.3):
        online_relays = [r for r in self.relays if r.status == RelayStatus.ONLINE]
        sorted_relays = sorted(
            online_relays,
            key=lambda r: (r.reliability, -r.latency),
            reverse=True
        )
        
        self.active_relays = sorted_relays[:self.max_relays // 2]
        logger.info(f"Selected {len(self.active_relays)} active relay nodes")
        
    def get_best_relay(self) -> Optional[RelayNode]:
        if self.active_relays:
            return self.active_relays[0]
        return None
        
    def get_random_relay(self) -> Optional[RelayNode]:
        if self.active_relays:
            return random.choice(self.active_relays)
        return None
        
    def get_all_active(self) -> List[RelayNode]:
        return list(self.active_relays)
        
    async def relay_find_node(self, target_id: bytes, local_node_id: bytes) -> List[Tuple[str, int, bytes]]:
        nodes = []
        
        async def query_via_relay(relay: RelayNode):
            try:
                msg_id = bytes([random.randint(0, 255) for _ in range(4)])
                msg = {
                    "t": msg_id,
                    "y": "q",
                    "q": "find_node",
                    "a": {
                        "id": local_node_id,
                        "target": target_id
                    }
                }
                
                if self._transport:
                    encoded = bencode.encode(msg)
                    self._transport.sendto(encoded, relay.addr)
                    await asyncio.sleep(0.5)
                    
            except Exception as e:
                logger.debug(f"Relay find_node failed: {e}")
        
        tasks = [query_via_relay(relay) for relay in self.active_relays[:5]]
        await asyncio.gather(*tasks, return_exceptions=True)
        
        return nodes
    
    async def relay_get_peers(self, infohash: bytes, local_node_id: bytes) -> Set[Tuple[str, int]]:
        peers = set()
        
        async def query_via_relay(relay: RelayNode):
            try:
                msg_id = bytes([random.randint(0, 255) for _ in range(4)])
                msg = {
                    "t": msg_id,
                    "y": "q",
                    "q": "get_peers",
                    "a": {
                        "id": local_node_id,
                        "info_hash": infohash
                    }
                }
                
                if self._transport:
                    encoded = bencode.encode(msg)
                    self._transport.sendto(encoded, relay.addr)
                    
            except Exception as e:
                logger.debug(f"Relay get_peers failed: {e}")
        
        tasks = [query_via_relay(relay) for relay in self.active_relays]
        await asyncio.gather(*tasks, return_exceptions=True)
        
        return peers
    
    async def report_success(self, relay: RelayNode):
        relay.success_count += 1
        self._select_active_relays()
        
    async def report_failure(self, relay: RelayNode):
        relay.fail_count += 1
        if relay.reliability < 0.2:
            self.active_relays.remove(relay)
            await self._probe_relays()
    
    def add_custom_relay(self, host: str, port: int):
        relay = RelayNode(host, port)
        self.relays.append(relay)

class HolePuncher:
    def __init__(self, relay_manager: RelayManager):
        self.relay_manager = relay_manager
        self.predicted_ports: Set[int] = set()
        
    async def predict_port_mapping(self, local_port: int, count: int = 5) -> List[int]:
        ports = []
        base_port = local_port
        
        for i in range(count):
            ports.append(base_port + i)
            ports.append(max(1024, base_port - i))
            ports.append(random.randint(1024, 65535))
        
        return list(set(ports))
    
    async def initiate_hole_punch(self, target_addr: Tuple[str, int], 
                                    local_port: int, protocol: str = "udp") -> bool:
        predicted_ports = await self.predict_port_mapping(local_port)
        
        success = False
        for port in predicted_ports[:10]:
            try:
                if protocol == "udp":
                    transport, _ = await asyncio.get_running_loop().create_datagram_endpoint(
                        lambda: asyncio.DatagramProtocol(),
                        local_addr=("0.0.0.0", port)
                    )
                    punch_msg = b"hole_punch_" + bytes([random.randint(0, 255) for _ in range(8)])
                    transport.sendto(punch_msg, target_addr)
                    transport.close()
                    success = True
                    break
            except:
                continue
                
        return success
    
    async def coordinate_hole_punch(self, target_id: bytes, local_id: bytes,
                                      target_addr: Tuple[str, int]) -> bool:
        relay = self.relay_manager.get_best_relay()
        if not relay:
            return False
            
        msg = {
            "t": bytes([random.randint(0, 255) for _ in range(4)]),
            "y": "q",
            "q": "announce_peer",
            "a": {
                "id": local_id,
                "info_hash": target_id,
                "port": target_addr[1],
                "token": b"hole_punch"
            }
        }
        
        try:
            transport = self.relay_manager._transport
            if transport:
                encoded = bencode.encode(msg)
                transport.sendto(encoded, relay.addr)
                await asyncio.sleep(0.5)
                return True
        except:
            pass
            
        return False
