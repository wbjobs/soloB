import asyncio
import socket
from typing import Optional, Dict, Tuple, Any
from collections import deque
import logging

logger = logging.getLogger(__name__)

try:
    from aioquic.asyncio import connect, QuicConnectionProtocol
    from aioquic.quic.configuration import QuicConfiguration
    from aioquic.quic.events import StreamDataReceived, ConnectionTerminated, DatagramFrameReceived
    AIOQUIC_AVAILABLE = True
except ImportError:
    AIOQUIC_AVAILABLE = False
    logger.warning("aioquic not available, QUIC transport disabled")

class DHTQuicProtocol:
    def __init__(self):
        self.configuration: Optional[QuicConfiguration] = None
        self.protocol: Optional[QuicConnectionProtocol] = None
        self.connected = False
        self._pending_datagrams: deque[bytes] = deque()
        self._stream_id = 0
        
    async def connect(self, host: str, port: int, timeout: int = 10) -> bool:
        if not AIOQUIC_AVAILABLE:
            logger.warning("QUIC not available (aioquic not installed)")
            return False
            
        try:
            self.configuration = QuicConfiguration(
                is_client=True,
                max_datagram_frame_size=1350,
                idle_timeout=timeout
            )
            self.configuration.verify_mode = None
            
            self.protocol = await connect(
                host,
                port,
                configuration=self.configuration,
                create_protocol=lambda: QuicConnectionProtocol(
                    configuration=self.configuration,
                    stream_handler=self._stream_handler
                )
            )
            
            self.connected = True
            logger.info(f"QUIC connected to {host}:{port}")
            return True
            
        except Exception as e:
            logger.error(f"QUIC connection failed: {e}")
            return False
    
    def _stream_handler(self, stream_id: int, data: bytes) -> None:
        try:
            self._pending_datagrams.append(data)
        except Exception as e:
            logger.error(f"QUIC stream handler error: {e}")
    
    async def send_datagram(self, data: bytes) -> bool:
        if not self.connected or not self.protocol:
            return False
            
        try:
            stream_id = self._next_stream_id()
            self.protocol._quic.send_stream_data(stream_id, data, end_stream=True)
            self.protocol.transmit()
            return True
        except Exception as e:
            logger.error(f"QUIC send datagram error: {e}")
            return False
    
    async def receive_datagram(self, timeout: float = 5.0) -> Optional[bytes]:
        start = asyncio.get_event_loop().time()
        
        while asyncio.get_event_loop().time() - start < timeout:
            if self._pending_datagrams:
                return self._pending_datagrams.popleft()
            await asyncio.sleep(0.01)
            
        return None
    
    def _next_stream_id(self) -> int:
        stream_id = self._stream_id
        self._stream_id += 2
        return stream_id
    
    def close(self):
        if self.protocol:
            try:
                self.protocol.close()
            except:
                pass
        self.connected = False

class QuicTransportManager:
    def __init__(self):
        self.connections: Dict[Tuple[str, int], DHTQuicProtocol] = {}
        
    async def get_connection(self, host: str, port: int) -> Optional[DHTQuicProtocol]:
        key = (host, port)
        
        if key in self.connections and self.connections[key].connected:
            return self.connections[key]
            
        proto = DHTQuicProtocol()
        if await proto.connect(host, port):
            self.connections[key] = proto
            return proto
            
        return None
    
    async def send_to(self, data: bytes, addr: Tuple[str, int]) -> bool:
        host, port = addr
        conn = await self.get_connection(host, port)
        if conn:
            return await conn.send_datagram(data)
        return False
    
    async def recv_from(self, addr: Tuple[str, int], timeout: float = 5.0) -> Optional[bytes]:
        if addr in self.connections:
            return await self.connections[addr].receive_datagram(timeout)
        return None
    
    def cleanup(self):
        for conn in self.connections.values():
            conn.close()
        self.connections.clear()

class FallbackTransport:
    def __init__(self, use_quic: bool = True, use_tcp: bool = True):
        self.use_quic = use_quic and AIOQUIC_AVAILABLE
        self.use_tcp = use_tcp
        self.quic_manager = QuicTransportManager() if self.use_quic else None
        self._tcp_buffer: Dict[Tuple[str, int], deque[bytes]] = {}
        
    async def send(self, data: bytes, addr: Tuple[str, int], mode: str = "udp") -> bool:
        if mode == "quic" and self.use_quic:
            return await self.quic_manager.send_to(data, addr)
        elif mode == "tcp" and self.use_tcp:
            return await self._send_tcp(data, addr)
        return False
    
    async def _send_tcp(self, data: bytes, addr: Tuple[str, int]) -> bool:
        try:
            host, port = addr
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port),
                timeout=5
            )
            
            msg_len = len(data).to_bytes(4, 'big')
            writer.write(msg_len + data)
            await asyncio.wait_for(writer.drain(), timeout=5)
            
            try:
                response_len = await asyncio.wait_for(reader.readexactly(4), timeout=5)
                response = await asyncio.wait_for(reader.readexactly(int.from_bytes(response_len, 'big')), timeout=5)
                
                if addr not in self._tcp_buffer:
                    self._tcp_buffer[addr] = deque()
                self._tcp_buffer[addr].append(response)
            except:
                pass
                
            writer.close()
            await writer.wait_closed()
            return True
            
        except Exception as e:
            logger.debug(f"TCP send failed: {e}")
            return False
    
    async def recv(self, addr: Tuple[str, int], timeout: float = 5.0) -> Optional[bytes]:
        if addr in self._tcp_buffer and self._tcp_buffer[addr]:
            return self._tcp_buffer[addr].popleft()
            
        if self.use_quic and addr in self.quic_manager.connections:
            return await self.quic_manager.recv_from(addr, timeout)
            
        return None
    
    def cleanup(self):
        if self.quic_manager:
            self.quic_manager.cleanup()
        self._tcp_buffer.clear()

def is_quic_available() -> bool:
    return AIOQUIC_AVAILABLE
