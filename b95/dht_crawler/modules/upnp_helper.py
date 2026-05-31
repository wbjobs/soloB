import asyncio
import socket
import struct
import xml.etree.ElementTree as ET
from typing import Optional, Tuple, List
from urllib.parse import urlparse
import logging

logger = logging.getLogger(__name__)

SSDP_ADDR = "239.255.255.250"
SSDP_PORT = 1900
SSDP_TARGET = "urn:schemas-upnp-org:device:InternetGatewayDevice:1"

class UPnPPortMapper:
    def __init__(self):
        self.gateway_url: Optional[str] = None
        self.control_url: Optional[str] = None
        self.external_ip: Optional[str] = None
        self.mapped_ports: List[Tuple[int, str]] = []
        
    async def discover_gateway(self, timeout: int = 5) -> bool:
        try:
            ssdp_request = (
                "M-SEARCH * HTTP/1.1\r\n"
                f"HOST: {SSDP_ADDR}:{SSDP_PORT}\r\n"
                "MAN: \"ssdp:discover\"\r\n"
                f"ST: {SSDP_TARGET}\r\n"
                f"MX: {timeout}\r\n"
                "\r\n"
            ).encode()
            
            loop = asyncio.get_running_loop()
            transport, protocol = await loop.create_datagram_endpoint(
                lambda: SSDPClientProtocol(),
                remote_addr=(SSDP_ADDR, SSDP_PORT)
            )
            
            transport.sendto(ssdp_request)
            await asyncio.sleep(timeout)
            transport.close()
            
            responses = protocol.get_responses()
            if not responses:
                logger.warning("No UPnP gateway found via SSDP")
                return False
                
            for response in responses:
                location = self._extract_location(response)
                if location:
                    self.gateway_url = location
                    if await self._fetch_control_url():
                        return True
                        
            return False
        except Exception as e:
            logger.error(f"UPnP gateway discovery failed: {e}")
            return False
    
    def _extract_location(self, response: bytes) -> Optional[str]:
        try:
            lines = response.decode().split('\r\n')
            for line in lines:
                if line.lower().startswith('location:'):
                    return line[9:].strip()
        except:
            pass
        return None
    
    async def _fetch_control_url(self) -> bool:
        if not self.gateway_url:
            return False
            
        try:
            parsed = urlparse(self.gateway_url)
            host = parsed.hostname
            port = parsed.port or 80
            
            reader, writer = await asyncio.open_connection(host, port)
            
            request = (
                f"GET {parsed.path} HTTP/1.1\r\n"
                f"Host: {host}:{port}\r\n"
                "Connection: close\r\n"
                "\r\n"
            ).encode()
            
            writer.write(request)
            await writer.drain()
            
            response = await reader.read()
            writer.close()
            await writer.wait_closed()
            
            body = response.split(b'\r\n\r\n', 1)[1] if b'\r\n\r\n' in response else response
            
            root = ET.fromstring(body)
            namespaces = {
                'ns': 'urn:schemas-upnp-org:device-1-0'
            }
            
            for device in root.findall('.//ns:device', namespaces):
                device_type = device.find('ns:deviceType', namespaces)
                if device_type is not None and 'InternetGatewayDevice' in device_type.text:
                    for service in device.findall('.//ns:service', namespaces):
                        service_type = service.find('ns:serviceType', namespaces)
                        if service_type is not None and 'WANIPConnection' in service_type.text:
                            control = service.find('ns:controlURL', namespaces)
                            if control is not None:
                                base_url = f"{parsed.scheme}://{parsed.netloc}"
                                self.control_url = base_url + control.text
                                return True
                                
        except Exception as e:
            logger.error(f"Failed to fetch control URL: {e}")
        return False
    
    async def add_port_mapping(self, external_port: int, internal_port: int, 
                               protocol: str = "UDP", description: str = "DHT Crawler") -> bool:
        if not self.control_url:
            logger.error("No UPnP control URL available")
            return False
            
        try:
            internal_ip = self._get_local_ip()
            if not internal_ip:
                logger.error("Could not determine local IP")
                return False
                
            soap_body = f"""<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<s:Body>
<u:AddPortMapping xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1">
<NewRemoteHost></NewRemoteHost>
<NewExternalPort>{external_port}</NewExternalPort>
<NewProtocol>{protocol}</NewProtocol>
<NewInternalPort>{internal_port}</NewInternalPort>
<NewInternalClient>{internal_ip}</NewInternalClient>
<NewEnabled>1</NewEnabled>
<NewPortMappingDescription>{description}</NewPortMappingDescription>
<NewLeaseDuration>0</NewLeaseDuration>
</u:AddPortMapping>
</s:Body>
</s:Envelope>"""

            parsed = urlparse(self.control_url)
            host = parsed.hostname
            port = parsed.port or 80
            
            reader, writer = await asyncio.open_connection(host, port)
            
            content_length = len(soap_body.encode())
            
            request = (
                f"POST {parsed.path} HTTP/1.1\r\n"
                f"Host: {host}:{port}\r\n"
                "Content-Type: text/xml; charset=\"utf-8\"\r\n"
                f"Content-Length: {content_length}\r\n"
                "SOAPAction: \"urn:schemas-upnp-org:service:WANIPConnection:1#AddPortMapping\"\r\n"
                "Connection: close\r\n"
                "\r\n"
                f"{soap_body}"
            ).encode()
            
            writer.write(request)
            await writer.drain()
            
            response = await reader.read()
            writer.close()
            await writer.wait_closed()
            
            if b"AddPortMappingResponse" in response:
                logger.info(f"UPnP port mapping added: {external_port} -> {internal_ip}:{internal_port} ({protocol})")
                self.mapped_ports.append((external_port, protocol))
                return True
            else:
                logger.warning(f"UPnP port mapping failed for port {external_port}")
                return False
                
        except Exception as e:
            logger.error(f"UPnP port mapping error: {e}")
            return False
    
    async def delete_port_mapping(self, external_port: int, protocol: str = "UDP") -> bool:
        if not self.control_url:
            return False
            
        try:
            soap_body = f"""<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<s:Body>
<u:DeletePortMapping xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1">
<NewRemoteHost></NewRemoteHost>
<NewExternalPort>{external_port}</NewExternalPort>
<NewProtocol>{protocol}</NewProtocol>
</u:DeletePortMapping>
</s:Body>
</s:Envelope>"""

            parsed = urlparse(self.control_url)
            host = parsed.hostname
            port = parsed.port or 80
            
            reader, writer = await asyncio.open_connection(host, port)
            
            content_length = len(soap_body.encode())
            
            request = (
                f"POST {parsed.path} HTTP/1.1\r\n"
                f"Host: {host}:{port}\r\n"
                "Content-Type: text/xml; charset=\"utf-8\"\r\n"
                f"Content-Length: {content_length}\r\n"
                "SOAPAction: \"urn:schemas-upnp-org:service:WANIPConnection:1#DeletePortMapping\"\r\n"
                "Connection: close\r\n"
                "\r\n"
                f"{soap_body}"
            ).encode()
            
            writer.write(request)
            await writer.drain()
            
            response = await reader.read()
            writer.close()
            await writer.wait_closed()
            
            if b"DeletePortMappingResponse" in response:
                logger.info(f"UPnP port mapping deleted: {external_port} ({protocol})")
                return True
                
        except Exception as e:
            logger.error(f"UPnP delete port mapping error: {e}")
        return False
    
    async def get_external_ip_address(self) -> Optional[str]:
        if not self.control_url:
            return None
            
        try:
            soap_body = """<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<s:Body>
<u:GetExternalIPAddress xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1">
</u:GetExternalIPAddress>
</s:Body>
</s:Envelope>"""

            parsed = urlparse(self.control_url)
            host = parsed.hostname
            port = parsed.port or 80
            
            reader, writer = await asyncio.open_connection(host, port)
            
            content_length = len(soap_body.encode())
            
            request = (
                f"POST {parsed.path} HTTP/1.1\r\n"
                f"Host: {host}:{port}\r\n"
                "Content-Type: text/xml; charset=\"utf-8\"\r\n"
                f"Content-Length: {content_length}\r\n"
                "SOAPAction: \"urn:schemas-upnp-org:service:WANIPConnection:1#GetExternalIPAddress\"\r\n"
                "Connection: close\r\n"
                "\r\n"
                f"{soap_body}"
            ).encode()
            
            writer.write(request)
            await writer.drain()
            
            response = await reader.read()
            writer.close()
            await writer.wait_closed()
            
            body = response.split(b'\r\n\r\n', 1)[1] if b'\r\n\r\n' in response else response
            root = ET.fromstring(body)
            
            for elem in root.iter():
                if elem.tag.endswith('NewExternalIPAddress') and elem.text:
                    self.external_ip = elem.text
                    return elem.text
                    
        except Exception as e:
            logger.error(f"Failed to get external IP: {e}")
        return None
    
    def _get_local_ip(self) -> Optional[str]:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
            return local_ip
        except:
            return None
    
    async def cleanup(self):
        for port, protocol in self.mapped_ports:
            await self.delete_port_mapping(port, protocol)
        self.mapped_ports.clear()

class SSDPClientProtocol(asyncio.DatagramProtocol):
    def __init__(self):
        self.responses = []
        
    def datagram_received(self, data, addr):
        self.responses.append(data)
        
    def get_responses(self):
        return self.responses
