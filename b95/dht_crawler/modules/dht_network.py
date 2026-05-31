import asyncio
import random
import socket
import struct
import hashlib
import bencode
from collections import OrderedDict
from typing import Set, Tuple, Optional, Dict, List
import logging

from .upnp_helper import UPnPPortMapper
from .relay_nodes import RelayManager, HolePuncher
from .nat_detector import NATDetector, NATType
from .quic_transport import FallbackTransport, is_quic_available

logger = logging.getLogger(__name__)

BOOTSTRAP_NODES = [
    ("router.bittorrent.com", 6881),
    ("dht.transmissionbt.com", 6881),
    ("router.utorrent.com", 6881),
]

def generate_node_id() -> bytes:
    return hashlib.sha1(bytes([random.randint(0, 255) for _ in range(20)])).digest()

def decode_nodes(nodes_data: bytes) -> List[Tuple[str, int, bytes]]:
    nodes = []
    for i in range(0, len(nodes_data), 26):
        if i + 26 > len(nodes_data):
            break
        node_id = nodes_data[i:i+20]
        ip = socket.inet_ntoa(nodes_data[i+20:i+24])
        port = struct.unpack("!H", nodes_data[i+24:i+26])[0]
        nodes.append((ip, port, node_id))
    return nodes

def encode_nodes(nodes: List[Tuple[str, int, bytes]]) -> bytes:
    result = b""
    for ip, port, node_id in nodes:
        result += node_id
        result += socket.inet_aton(ip)
        result += struct.pack("!H", port)
    return result

class TraversalStrategy:
    def __init__(self, name: str, enabled: bool = True):
        self.name = name
        self.enabled = enabled
        self.success_count = 0
        self.fail_count = 0
        self.last_used = 0.0
        
    @property
    def success_rate(self) -> float:
        total = self.success_count + self.fail_count
        if total == 0:
            return 0.5
        return self.success_count / total
        
    def record_success(self):
        self.success_count += 1
        self.last_used = asyncio.get_event_loop().time()
        
    def record_failure(self):
        self.fail_count += 1
        self.last_used = asyncio.get_event_loop().time()

class DHTNetwork:
    def __init__(self, port: int = 6881, enable_traversal: bool = True,
                 enable_upnp: bool = True, enable_relay: bool = True,
                 enable_quic: bool = True, enable_nat_detection: bool = True):
        self.port = port
        self.node_id = generate_node_id()
        self.transport = None
        self.protocol = None
        self.routing_table: OrderedDict[bytes, Tuple[str, int]] = OrderedDict()
        self.pending_queries: Dict[str, asyncio.Future] = {}
        self.transaction_id_counter = 0
        
        self.enable_traversal = enable_traversal
        self.enable_upnp = enable_upnp
        self.enable_relay = enable_relay
        self.enable_quic = enable_quic
        self.enable_nat_detection = enable_nat_detection
        
        self.traversal_strategies: Dict[str, TraversalStrategy] = {}
        self.active_strategy: Optional[str] = None
        self.nat_type: NATType = NATType.UNKNOWN
        
        self.upnp_mapper: Optional[UPnPPortMapper] = None
        self.relay_manager: Optional[RelayManager] = None
        self.hole_puncher: Optional[HolePuncher] = None
        self.nat_detector: Optional[NATDetector] = None
        self.fallback_transport: Optional[FallbackTransport] = None
        
        self.external_ip: Optional[str] = None
        self.external_port: Optional[int] = None
        self.bootstrap_completed = False
        
        self._init_strategies()
        
    def _init_strategies(self):
        self.traversal_strategies = {
            "direct_udp": TraversalStrategy("direct_udp"),
            "upnp": TraversalStrategy("upnp", enabled=self.enable_upnp),
            "relay": TraversalStrategy("relay", enabled=self.enable_relay),
            "hole_punch": TraversalStrategy("hole_punch", enabled=True),
            "tcp_fallback": TraversalStrategy("tcp_fallback", enabled=True),
            "quic_fallback": TraversalStrategy("quic_fallback", enabled=self.enable_quic and is_quic_available()),
        }
        
    def get_transaction_id(self) -> bytes:
        tid = struct.pack("!H", self.transaction_id_counter)
        self.transaction_id_counter = (self.transaction_id_counter + 1) % 65536
        return tid
    
    async def start(self):
        loop = asyncio.get_running_loop()
        self.transport, self.protocol = await loop.create_datagram_endpoint(
            lambda: DHTProtocol(self),
            local_addr=("0.0.0.0", self.port)
        )
        print(f"DHT node started on port {self.port}, node_id: {self.node_id.hex()}")
        
        if self.enable_traversal:
            await self._initialize_traversal()
        
        await self.bootstrap()
        asyncio.create_task(self.refresh_routing_table())
        if self.enable_traversal:
            asyncio.create_task(self._monitor_strategies())
        
    async def _initialize_traversal(self):
        print("Initializing NAT traversal strategies...")
        
        if self.enable_nat_detection:
            self.nat_detector = NATDetector()
            try:
                self.nat_type = await asyncio.wait_for(self.nat_detector.detect(self.port), timeout=10.0)
                print(f"NAT Type detected: {self.nat_type.value}")
                print(f"Network info: {self.nat_detector.get_strategy_description()}")
            except Exception as e:
                logger.warning(f"NAT detection failed: {e}")
                self.nat_type = NATType.UNKNOWN
        
        if self.enable_upnp:
            self.upnp_mapper = UPnPPortMapper()
            try:
                if await asyncio.wait_for(self.upnp_mapper.discover_gateway(), timeout=5.0):
                    print("UPnP gateway discovered")
                    if await asyncio.wait_for(self.upnp_mapper.add_port_mapping(self.port, self.port), timeout=5.0):
                        print(f"UPnP port mapping added: {self.port}")
                        self.external_ip = await self.upnp_mapper.get_external_ip_address()
                        if self.external_ip:
                            print(f"External IP: {self.external_ip}")
                            self.traversal_strategies["upnp"].record_success()
                    else:
                        print("UPnP port mapping failed")
                        self.traversal_strategies["upnp"].record_failure()
                else:
                    print("No UPnP gateway found")
                    self.traversal_strategies["upnp"].enabled = False
            except Exception as e:
                logger.warning(f"UPnP initialization failed: {e}")
                self.traversal_strategies["upnp"].enabled = False
        
        if self.enable_relay:
            self.relay_manager = RelayManager()
            try:
                await asyncio.wait_for(self.relay_manager.initialize(self.transport), timeout=10.0)
                active_count = len(self.relay_manager.active_relays)
                print(f"Relay nodes ready: {active_count} active super nodes")
                if active_count > 0:
                    self.hole_puncher = HolePuncher(self.relay_manager)
                else:
                    self.traversal_strategies["relay"].enabled = False
            except Exception as e:
                logger.warning(f"Relay manager initialization failed: {e}")
                self.traversal_strategies["relay"].enabled = False
        
        if self.enable_quic and is_quic_available():
            try:
                self.fallback_transport = FallbackTransport(use_quic=True, use_tcp=True)
                print("QUIC/TCP fallback transport ready")
            except Exception as e:
                logger.warning(f"Fallback transport initialization failed: {e}")
                self.traversal_strategies["quic_fallback"].enabled = False
        
        self._select_best_strategy()
        if self.active_strategy:
            print(f"Active traversal strategy: {self.active_strategy}")
        
    def _select_best_strategy(self):
        if self.nat_detector:
            recommended = self.nat_detector.get_recommended_strategy()
            for strategy_name in recommended:
                strategy = self.traversal_strategies.get(strategy_name)
                if strategy and strategy.enabled:
                    self.active_strategy = strategy_name
                    return
                    
        for strategy_name, strategy in self.traversal_strategies.items():
            if strategy.enabled and strategy.success_rate > 0.3:
                self.active_strategy = strategy_name
                return
        
        if self.traversal_strategies["direct_udp"].enabled:
            self.active_strategy = "direct_udp"
            
    async def _monitor_strategies(self):
        while True:
            try:
                if not self.bootstrap_completed and len(self.routing_table) > 0:
                    self.bootstrap_completed = True
                    self.traversal_strategies["direct_udp"].record_success()
                    
                await asyncio.sleep(30)
                self._select_best_strategy()
                
            except Exception as e:
                logger.debug(f"Strategy monitor error: {e}")
                await asyncio.sleep(5)
    
    async def bootstrap(self):
        bootstrap_methods = [
            self._bootstrap_direct,
            self._bootstrap_via_relays,
            self._bootstrap_via_tcp,
        ]
        
        for method in bootstrap_methods:
            try:
                if await asyncio.wait_for(method(), timeout=10.0):
                    logger.info(f"Bootstrap succeeded via {method.__name__}")
                    break
            except Exception as e:
                logger.debug(f"Bootstrap method {method.__name__} failed: {e}")
                continue
                
        await asyncio.sleep(1)
        
    async def _bootstrap_direct(self) -> bool:
        success = False
        for host, port in BOOTSTRAP_NODES:
            try:
                ip = socket.gethostbyname(host)
                await self.find_node(ip, port, self.node_id, use_strategy="direct_udp")
                success = True
            except Exception as e:
                logger.debug(f"Direct bootstrap failed for {host}:{port} - {e}")
        return success
        
    async def _bootstrap_via_relays(self) -> bool:
        if not self.relay_manager or not self.relay_manager.active_relays:
            return False
            
        try:
            await self.relay_manager.relay_find_node(self.node_id, self.node_id)
            return True
        except:
            return False
            
    async def _bootstrap_via_tcp(self) -> bool:
        if not self.fallback_transport:
            return False
            
        try:
            for host, port in BOOTSTRAP_NODES[:2]:
                try:
                    ip = socket.gethostbyname(host)
                    tid = self.get_transaction_id()
                    msg = {
                        "t": tid,
                        "y": "q",
                        "q": "find_node",
                        "a": {
                            "id": self.node_id,
                            "target": self.node_id
                        }
                    }
                    encoded = bencode.encode(msg)
                    await self.fallback_transport.send(encoded, (ip, port), mode="tcp")
                except:
                    continue
            return True
        except:
            return False
        
    async def find_node(self, ip: str, port: int, target_id: bytes, use_strategy: Optional[str] = None):
        strategy = use_strategy or self.active_strategy or "direct_udp"
        tid = self.get_transaction_id()
        msg = {
            "t": tid,
            "y": "q",
            "q": "find_node",
            "a": {
                "id": self.node_id,
                "target": target_id
            }
        }
        future = asyncio.get_running_loop().create_future()
        self.pending_queries[tid.hex()] = future
        
        try:
            await self._send_with_strategy(msg, (ip, port), strategy)
            
            try:
                await asyncio.wait_for(future, timeout=5)
                self.traversal_strategies[strategy].record_success()
            except asyncio.TimeoutError:
                self.traversal_strategies[strategy].record_failure()
                if strategy != "direct_udp":
                    await self._send_with_strategy(msg, (ip, port), "direct_udp")
        finally:
            if tid.hex() in self.pending_queries:
                del self.pending_queries[tid.hex()]
    
    async def _send_with_strategy(self, msg: dict, addr: Tuple[str, int], strategy: str):
        try:
            encoded = bencode.encode(msg)
            
            if strategy == "direct_udp":
                self.transport.sendto(encoded, addr)
            elif strategy == "relay" and self.relay_manager:
                relay = self.relay_manager.get_best_relay()
                if relay:
                    self.transport.sendto(encoded, relay.addr)
            elif strategy == "tcp_fallback" and self.fallback_transport:
                await self.fallback_transport.send(encoded, addr, mode="tcp")
            elif strategy == "quic_fallback" and self.fallback_transport:
                await self.fallback_transport.send(encoded, addr, mode="quic")
            elif strategy == "hole_punch" and self.hole_puncher:
                await self.hole_puncher.initiate_hole_punch(addr, self.port)
                self.transport.sendto(encoded, addr)
            else:
                self.transport.sendto(encoded, addr)
                
        except Exception as e:
            logger.debug(f"Send with strategy {strategy} failed: {e}")
            self.transport.sendto(encoded, addr)
    
    def send_message(self, msg: dict, addr: Tuple[str, int]):
        try:
            encoded = bencode.encode(msg)
            self.transport.sendto(encoded, addr)
        except Exception as e:
            pass
    
    def handle_response(self, msg: dict, addr: Tuple[str, int]):
        tid = msg.get(b"t") if isinstance(msg.get(b"t"), bytes) else msg.get("t", b"")
        if isinstance(tid, str):
            tid = tid.encode()
        
        tid_hex = tid.hex()
        if tid_hex in self.pending_queries:
            future = self.pending_queries[tid_hex]
            if not future.done():
                future.set_result(msg)
            
            r = msg.get(b"r") if isinstance(msg.get(b"r"), dict) else msg.get("r", {})
            if isinstance(r, dict):
                nodes = r.get(b"nodes") if isinstance(r.get(b"nodes"), bytes) else r.get("nodes", b"")
                if isinstance(nodes, bytes):
                    for node_ip, node_port, node_id in decode_nodes(nodes):
                        if len(self.routing_table) < 1000:
                            self.routing_table[node_id] = (node_ip, node_port)
    
    def handle_query(self, msg: dict, addr: Tuple[str, int]):
        q = msg.get(b"q") if isinstance(msg.get(b"q"), bytes) else msg.get("q", b"")
        if isinstance(q, bytes):
            q = q.decode()
        
        tid = msg.get(b"t") if isinstance(msg.get(b"t"), bytes) else msg.get("t", b"")
        
        if q == "ping":
            response = {
                "t": tid,
                "y": "r",
                "r": {"id": self.node_id}
            }
            self.send_message(response, addr)
        elif q == "find_node":
            a = msg.get(b"a") if isinstance(msg.get(b"a"), dict) else msg.get("a", {})
            target = a.get(b"target") if isinstance(a.get(b"target"), bytes) else a.get("target", b"")
            closest_nodes = self.get_closest_nodes(target)
            response = {
                "t": tid,
                "y": "r",
                "r": {
                    "id": self.node_id,
                    "nodes": encode_nodes(closest_nodes)
                }
            }
            self.send_message(response, addr)
    
    def get_closest_nodes(self, target_id: bytes, count: int = 8) -> List[Tuple[str, int, bytes]]:
        nodes = []
        for node_id, (ip, port) in list(self.routing_table.items())[:count]:
            nodes.append((ip, port, node_id))
        return nodes
    
    async def refresh_routing_table(self):
        while True:
            try:
                if len(self.routing_table) < 10:
                    await self.bootstrap()
                
                for node_id, (ip, port) in list(self.routing_table.items())[:5]:
                    await self.find_node(ip, port, self.node_id)
                    await asyncio.sleep(0.1)
                
                await asyncio.sleep(30)
            except Exception as e:
                logger.debug(f"Refresh routing table error: {e}")
                await asyncio.sleep(5)
    
    async def get_peers(self, infohash: bytes, timeout: int = 30) -> Set[Tuple[str, int]]:
        peers = set()
        start_time = asyncio.get_event_loop().time()
        
        async def query_node(node_ip: str, node_port: int, strategy: str = "direct_udp"):
            tid = self.get_transaction_id()
            msg = {
                "t": tid,
                "y": "q",
                "q": "get_peers",
                "a": {
                    "id": self.node_id,
                    "info_hash": infohash
                }
            }
            future = asyncio.get_running_loop().create_future()
            self.pending_queries[tid.hex()] = future
            
            try:
                await self._send_with_strategy(msg, (node_ip, node_port), strategy)
                response = await asyncio.wait_for(future, timeout=3)
                r = response.get(b"r") if isinstance(response.get(b"r"), dict) else response.get("r", {})
                if isinstance(r, dict):
                    values = r.get(b"values") if isinstance(r.get(b"values"), list) else r.get("values", [])
                    for peer_data in values:
                        if isinstance(peer_data, bytes) and len(peer_data) >= 6:
                            peer_ip = socket.inet_ntoa(peer_data[:4])
                            peer_port = struct.unpack("!H", peer_data[4:6])[0]
                            peers.add((peer_ip, peer_port))
            except:
                pass
            finally:
                if tid.hex() in self.pending_queries:
                    del self.pending_queries[tid.hex()]
        
        while asyncio.get_event_loop().time() - start_time < timeout:
            tasks = []
            strategies_to_try = [self.active_strategy] if self.active_strategy else ["direct_udp", "relay"]
            
            for strategy in strategies_to_try:
                if strategy == "relay" and self.relay_manager:
                    for relay in self.relay_manager.active_relays[:3]:
                        tasks.append(query_node(relay.host, relay.port, strategy))
                else:
                    for node_id, (ip, port) in list(self.routing_table.items())[:15]:
                        tasks.append(query_node(ip, port, strategy))
            
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            
            if len(peers) == 0 and len(self.routing_table) == 0:
                await self.bootstrap()
                
            await asyncio.sleep(1)
        
        return peers
        
    async def announce_peer(self, infohash: bytes, port: int, timeout: int = 10) -> int:
        """向DHT网络宣告我们是某个infohash的Peer，用于播种"""
        announce_count = 0
        token_cache = {}
        
        async def get_token_and_announce(node_ip: str, node_port: int, strategy: str = "direct_udp"):
            nonlocal announce_count
            
            tid = self.get_transaction_id()
            msg = {
                "t": tid,
                "y": "q",
                "q": "get_peers",
                "a": {
                    "id": self.node_id,
                    "info_hash": infohash
                }
            }
            future = asyncio.get_running_loop().create_future()
            self.pending_queries[tid.hex()] = future
            
            try:
                await self._send_with_strategy(msg, (node_ip, node_port), strategy)
                response = await asyncio.wait_for(future, timeout=3)
                r = response.get(b"r") if isinstance(response.get(b"r"), dict) else response.get("r", {})
                
                if isinstance(r, dict):
                    token = r.get(b"token") if isinstance(r.get(b"token"), bytes) else r.get("token")
                    if token:
                        tid2 = self.get_transaction_id()
                        announce_msg = {
                            "t": tid2,
                            "y": "q",
                            "q": "announce_peer",
                            "a": {
                                "id": self.node_id,
                                "info_hash": infohash,
                                "port": port,
                                "token": token,
                                "implied_port": 1
                            }
                        }
                        await self._send_with_strategy(announce_msg, (node_ip, node_port), strategy)
                        announce_count += 1
            except:
                pass
            finally:
                if tid.hex() in self.pending_queries:
                    del self.pending_queries[tid.hex()]
        
        tasks = []
        strategies_to_try = [self.active_strategy] if self.active_strategy else ["direct_udp", "relay"]
        
        for strategy in strategies_to_try:
            if strategy == "relay" and self.relay_manager:
                for relay in self.relay_manager.active_relays:
                    tasks.append(get_token_and_announce(relay.host, relay.port, strategy))
            else:
                for node_id, (ip, node_port) in list(self.routing_table.items())[:20]:
                    tasks.append(get_token_and_announce(ip, node_port, strategy))
        
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        
        return announce_count
        
    async def announce_periodically(self, infohash: bytes, port: int, interval: int = 300):
        """定期向DHT网络宣告Peer状态"""
        while True:
            count = await self.announce_peer(infohash, port)
            logger.debug(f"Announced to {count} DHT nodes for infohash {infohash.hex()}")
            await asyncio.sleep(interval)
    
    def get_traversal_stats(self) -> dict:
        return {
            "nat_type": self.nat_type.value,
            "external_ip": self.external_ip,
            "external_port": self.external_port,
            "active_strategy": self.active_strategy,
            "strategies": {
                name: {
                    "enabled": s.enabled,
                    "success_rate": s.success_rate,
                    "success_count": s.success_count,
                    "fail_count": s.fail_count
                }
                for name, s in self.traversal_strategies.items()
            },
            "relay_nodes_count": len(self.relay_manager.active_relays) if self.relay_manager else 0,
            "routing_table_size": len(self.routing_table),
            "bootstrap_completed": self.bootstrap_completed
        }
    
    async def close(self):
        if self.transport:
            self.transport.close()
            
        if self.upnp_mapper:
            await self.upnp_mapper.cleanup()
            
        if self.fallback_transport:
            self.fallback_transport.cleanup()

class DHTProtocol(asyncio.DatagramProtocol):
    def __init__(self, dht_node: DHTNetwork):
        self.dht_node = dht_node
    
    def datagram_received(self, data: bytes, addr: Tuple[str, int]):
        try:
            msg = bencode.decode(data)
            y = msg.get(b"y") if isinstance(msg.get(b"y"), bytes) else msg.get("y", b"")
            if isinstance(y, bytes):
                y = y.decode()
            
            if y == "r":
                self.dht_node.handle_response(msg, addr)
            elif y == "q":
                self.dht_node.handle_query(msg, addr)
        except Exception as e:
            pass
