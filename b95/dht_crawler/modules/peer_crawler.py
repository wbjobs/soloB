import asyncio
import socket
import struct
import hashlib
import re
from typing import Set, Tuple, Dict, List, Optional
from collections import defaultdict
import geoip2.database
import geoip2.errors
import requests

def parse_infohash(infohash_str: str) -> bytes:
    infohash_str = infohash_str.strip().lower()
    if len(infohash_str) == 40 and all(c in '0123456789abcdef' for c in infohash_str):
        return bytes.fromhex(infohash_str)
    elif len(infohash_str) == 32:
        return infohash_str.encode('utf-8')
    else:
        raise ValueError(f"Invalid infohash format: {infohash_str}")

class PeerCrawler:
    def __init__(self, dht_network):
        self.dht_network = dht_network
        self.peers: Set[Tuple[str, int]] = set()
        self.peer_info: Dict[Tuple[str, int], dict] = {}
        
    async def crawl_peers(self, infohash: str, timeout: int = 60) -> Set[Tuple[str, int]]:
        infohash_bytes = parse_infohash(infohash)
        print(f"Starting peer crawl for infohash: {infohash}")
        
        peers = await self.dht_network.get_peers(infohash_bytes, timeout=timeout)
        self.peers.update(peers)
        
        print(f"Found {len(peers)} initial peers from DHT")
        
        additional_peers = await self.crawl_from_peers(infohash_bytes, peers)
        self.peers.update(additional_peers)
        
        print(f"Total peers found: {len(self.peers)}")
        return self.peers
    
    async def crawl_from_peers(self, infohash: bytes, initial_peers: Set[Tuple[str, int]], 
                                max_concurrent: int = 20) -> Set[Tuple[str, int]]:
        new_peers = set()
        semaphore = asyncio.Semaphore(max_concurrent)
        
        async def peer_worker(peer_addr: Tuple[str, int]):
            async with semaphore:
                try:
                    found = await self.announce_peer_request(infohash, peer_addr)
                    new_peers.update(found)
                except:
                    pass
        
        tasks = [peer_worker(addr) for addr in list(initial_peers)[:50]]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        
        return new_peers
    
    async def announce_peer_request(self, infohash: bytes, peer_addr: Tuple[str, int]) -> Set[Tuple[str, int]]:
        found_peers = set()
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(peer_addr[0], peer_addr[1]),
                timeout=5
            )
            
            handshake = self.build_handshake(infohash)
            writer.write(handshake)
            await asyncio.wait_for(writer.drain(), timeout=5)
            
            response = await asyncio.wait_for(reader.read(68), timeout=5)
            
            if len(response) >= 68 and response[1:20] == b'BitTorrent protocol':
                found_peers.add(peer_addr)
                self.peer_info[peer_addr] = {
                    'ip': peer_addr[0],
                    'port': peer_addr[1],
                    'reachable': True,
                    'handshake_ok': True
                }
            
            writer.close()
            await writer.wait_closed()
        except:
            if peer_addr in self.peer_info:
                self.peer_info[peer_addr]['reachable'] = False
        
        return found_peers
    
    def build_handshake(self, infohash: bytes) -> bytes:
        pstr = b"BitTorrent protocol"
        pstrlen = len(pstr)
        reserved = b"\x00" * 8
        peer_id = hashlib.sha1(b"-PC0001-" + bytes([0] * 12)).digest()
        
        handshake = struct.pack("!B", pstrlen) + pstr + reserved + infohash + peer_id
        return handshake
    
    def get_peer_geolocation(self, ip: str) -> dict:
        try:
            response = requests.get(f"http://ip-api.com/json/{ip}", timeout=3)
            if response.status_code == 200:
                data = response.json()
                if data.get('status') == 'success':
                    return {
                        'country': data.get('country', 'Unknown'),
                        'country_code': data.get('countryCode', 'Unknown'),
                        'region': data.get('regionName', 'Unknown'),
                        'city': data.get('city', 'Unknown'),
                        'isp': data.get('isp', 'Unknown'),
                        'org': data.get('org', 'Unknown'),
                        'as': data.get('as', 'Unknown'),
                        'lat': data.get('lat', 0),
                        'lon': data.get('lon', 0)
                    }
        except:
            pass
        return {
            'country': 'Unknown',
            'country_code': 'Unknown',
            'region': 'Unknown',
            'city': 'Unknown',
            'isp': 'Unknown',
            'org': 'Unknown',
            'as': 'Unknown',
            'lat': 0,
            'lon': 0
        }
    
    async def enrich_peer_info(self) -> List[dict]:
        enriched_peers = []
        for (ip, port) in self.peers:
            geo_info = self.get_peer_geolocation(ip)
            peer_data = {
                'ip': ip,
                'port': port,
                **geo_info,
                'reachable': self.peer_info.get((ip, port), {}).get('reachable', False),
                'handshake_ok': self.peer_info.get((ip, port), {}).get('handshake_ok', False)
            }
            enriched_peers.append(peer_data)
        
        return enriched_peers
    
    def analyze_distribution(self, enriched_peers: List[dict]) -> dict:
        isp_distribution = defaultdict(int)
        country_distribution = defaultdict(int)
        region_distribution = defaultdict(int)
        
        for peer in enriched_peers:
            isp_distribution[peer['isp']] += 1
            country_distribution[peer['country']] += 1
            region_distribution[peer['region']] += 1
        
        return {
            'total_peers': len(enriched_peers),
            'reachable_peers': sum(1 for p in enriched_peers if p['reachable']),
            'isp_distribution': dict(isp_distribution),
            'country_distribution': dict(country_distribution),
            'region_distribution': dict(region_distribution)
        }
