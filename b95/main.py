#!/usr/bin/env python3
import asyncio
import argparse
import json
import sys
import os
from datetime import datetime
from typing import Dict, Optional

from dht_crawler.modules.dht_network import DHTNetwork
from dht_crawler.modules.peer_crawler import PeerCrawler
from dht_crawler.modules.file_analyzer import FileAnalyzer
from dht_crawler.modules.health_predictor import HealthPredictor
from dht_crawler.modules.torrent_creator import TorrentCreator, PieceProvider
from dht_crawler.modules.bittorrent_seeder import BitTorrentSeeder
from dht_crawler.modules.diffusion_monitor import DiffusionMonitor

class DHTCrawlerCLI:
    def __init__(self):
        self.dht_network: Optional[DHTNetwork] = None
        self.peer_crawler: Optional[PeerCrawler] = None
        self.file_analyzer: Optional[FileAnalyzer] = None
        self.health_predictor: Optional[HealthPredictor] = None
        
    async def initialize(self, port: int = 6881, enable_traversal: bool = True,
                       enable_upnp: bool = True, enable_relay: bool = True,
                       enable_quic: bool = True, enable_nat_detection: bool = True,
                       force_strategy: Optional[str] = None):
        print(f"Initializing DHT Crawler on port {port}...")
        if enable_traversal:
            print(f"  NAT traversal enabled")
            print(f"  - UPnP: {'enabled' if enable_upnp else 'disabled'}")
            print(f"  - Relay nodes: {'enabled' if enable_relay else 'disabled'}")
            print(f"  - QUIC fallback: {'enabled' if enable_quic else 'disabled'}")
            print(f"  - NAT detection: {'enabled' if enable_nat_detection else 'disabled'}")
            if force_strategy:
                print(f"  - Forced strategy: {force_strategy}")
        else:
            print(f"  NAT traversal disabled")
        
        self.dht_network = DHTNetwork(
            port=port,
            enable_traversal=enable_traversal,
            enable_upnp=enable_upnp,
            enable_relay=enable_relay,
            enable_quic=enable_quic,
            enable_nat_detection=enable_nat_detection
        )
        
        if force_strategy:
            self.dht_network.active_strategy = force_strategy
        
        await self.dht_network.start()
        
        self.peer_crawler = PeerCrawler(self.dht_network)
        self.file_analyzer = FileAnalyzer()
        self.health_predictor = HealthPredictor()
        
        print("\nLoading/Training prediction model...")
        if not self.health_predictor.load_model():
            self.health_predictor.train_model()
            self.health_predictor.save_model()
        
        traversal_stats = self.dht_network.get_traversal_stats()
        print(f"\nCurrent network status:")
        print(f"  NAT type: {traversal_stats['nat_type']}")
        print(f"  Active strategy: {traversal_stats['active_strategy']}")
        print(f"  Routing table size: {traversal_stats['routing_table_size']}")
        print(f"  Relay nodes: {traversal_stats['relay_nodes_count']}")
        
        print("\nInitialization complete!\n")
    
    async def crawl_infohash(self, infohash: str, options: Dict) -> Dict:
        print(f"Starting crawl for infohash: {infohash}")
        print("=" * 60)
        
        if options.get('torrent_file') and os.path.exists(options['torrent_file']):
            print(f"Parsing torrent file: {options['torrent_file']}")
            with open(options['torrent_file'], 'rb') as f:
                torrent_data = f.read()
            torrent_info = self.file_analyzer.parse_torrent(torrent_data)
            print(f"Torrent info: {torrent_info.get('piece_count', 0)} pieces, "
                  f"{torrent_info.get('total_size', 0)} bytes\n")
        else:
            print("Warning: No torrent file provided, skipping integrity analysis\n")
        
        print("Step 1: Crawling peers from DHT network...")
        peers = await self.peer_crawler.crawl_peers(
            infohash,
            timeout=options.get('crawl_timeout', 60)
        )
        print(f"Found {len(peers)} unique peers\n")
        
        print("Step 2: Enriching peer information with geolocation...")
        enriched_peers = await self.peer_crawler.enrich_peer_info()
        print(f"Enriched {len(enriched_peers)} peers with geolocation data\n")
        
        print("Step 3: Analyzing peer distribution...")
        distribution = self.peer_crawler.analyze_distribution(enriched_peers)
        print(f"Total peers: {distribution['total_peers']}")
        print(f"Reachable peers: {distribution['reachable_peers']}")
        print(f"Countries: {len(distribution['country_distribution'])}")
        print(f"ISPs: {len(distribution['isp_distribution'])}\n")
        
        integrity_analysis = {}
        if options.get('analyze_integrity', False) and self.file_analyzer.piece_hashes:
            print("Step 4: Analyzing file integrity...")
            reachable_peers = [(p['ip'], p['port']) for p in enriched_peers if p['reachable']]
            integrity_analysis = await self.file_analyzer.analyze_file_integrity(
                reachable_peers,
                infohash,
                max_pieces_to_check=options.get('max_pieces', 10)
            )
            print(f"Integrity score: {integrity_analysis.get('integrity_score', 0)}")
            print(f"Pieces checked: {integrity_analysis.get('pieces_checked', 0)}")
            print(f"Valid pieces: {integrity_analysis.get('pieces_valid', 0)}\n")
        else:
            integrity_analysis = {
                'integrity_score': 0.8,
                'pieces_checked': 0,
                'pieces_valid': 0
            }
        
        print("Step 5: Predicting 24-hour file health...")
        current_status = {
            'current_peers': len(peers),
            'reachable_ratio': distribution['reachable_peers'] / max(1, len(peers)),
            'avg_peer_age_hours': 24,
            'isp_diversity': min(1.0, len(distribution['isp_distribution']) / max(1, len(peers)) * 5),
            'country_diversity': min(1.0, len(distribution['country_distribution']) / max(1, len(peers)) * 10),
            'region_diversity': min(1.0, len(distribution['region_distribution']) / max(1, len(peers)) * 10),
            'integrity_score': integrity_analysis.get('integrity_score', 0.5),
            'seeder_count': int(len(peers) * 0.5),
            'leecher_count': int(len(peers) * 0.5),
            'hour_of_day': datetime.now().hour,
            'day_of_week': datetime.now().weekday(),
            'time_since_first_seen_hours': 168
        }
        
        health_prediction = self.health_predictor.predict_health(current_status)
        print(f"Predicted peers in 24h: {health_prediction['predicted_peers_24h']}")
        print(f"Peer change: {health_prediction['peer_change_percentage']}%")
        print(f"24h survival probability: {health_prediction['survival_probability_24h'] * 100:.2f}%")
        print(f"Health score: {health_prediction['health_score']} ({health_prediction['health_level']})")
        print(f"Risk factors: {', '.join(health_prediction['risk_factors']) if health_prediction['risk_factors'] else 'None'}")
        print()
        
        traversal_stats = self.dht_network.get_traversal_stats()
        
        report = {
            'metadata': {
                'infohash': infohash,
                'timestamp': datetime.now().isoformat(),
                'version': '2.0.0'
            },
            'traversal': {
                'nat_type': traversal_stats['nat_type'],
                'external_ip': traversal_stats['external_ip'],
                'active_strategy': traversal_stats['active_strategy'],
                'strategies': traversal_stats['strategies'],
                'relay_nodes_count': traversal_stats['relay_nodes_count'],
                'routing_table_size': traversal_stats['routing_table_size'],
                'bootstrap_completed': traversal_stats['bootstrap_completed']
            },
            'peers': {
                'total_found': len(peers),
                'reachable_count': distribution['reachable_peers'],
                'peer_list': enriched_peers[:100],
            },
            'distribution': {
                'isp_distribution': self._get_top_n(distribution['isp_distribution'], 20),
                'country_distribution': self._get_top_n(distribution['country_distribution'], 20),
                'region_distribution': self._get_top_n(distribution['region_distribution'], 20)
            },
            'file_analysis': {
                'torrent_info': self.file_analyzer.get_file_distribution(),
                'integrity_analysis': integrity_analysis
            },
            'health_prediction': health_prediction
        }
        
        return report
    
    def _get_top_n(self, data: Dict, n: int) -> Dict:
        sorted_items = sorted(data.items(), key=lambda x: -x[1])
        return dict(sorted_items[:n])
    
    def save_report(self, report: Dict, output_file: str):
        try:
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(report, f, indent=2, ensure_ascii=False)
            print(f"Report saved to: {output_file}")
        except Exception as e:
            print(f"Error saving report: {e}", file=sys.stderr)
    
    async def seed_file(self, file_path: str, options: Dict) -> Dict:
        """通过DHT网络播种文件"""
        print(f"Starting seeding for: {file_path}")
        print("=" * 60)
        
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")
        
        print("Step 1: Creating torrent metadata...")
        creator = TorrentCreator(piece_size=options.get('piece_size', 262144))
        
        if os.path.isdir(file_path):
            torrent_info = creator.create_from_directory(file_path)
            print(f"  Created torrent for directory: {os.path.basename(file_path)}")
        else:
            torrent_info = creator.create_from_file(file_path)
            print(f"  Created torrent for file: {os.path.basename(file_path)}")
        
        print(f"  Infohash: {creator.infohash_hex}")
        print(f"  Total size: {creator.total_size} bytes")
        print(f"  Number of pieces: {len(creator.piece_hashes)}")
        
        magnet_link = creator.get_magnet_link()
        print(f"  Magnet link: {magnet_link}")
        
        if options.get('save_torrent'):
            torrent_path = options.get('torrent_output', f"{creator.name}.torrent")
            creator.save_torrent(torrent_path)
            print(f"  Torrent saved to: {torrent_path}")
        print()
        
        print("Step 2: Starting BitTorrent seeder...")
        piece_provider = PieceProvider(creator, os.path.dirname(file_path) if os.path.isfile(file_path) else file_path)
        
        seeder = BitTorrentSeeder(creator, piece_provider, port=options.get('port', 6881))
        await seeder.start()
        print(f"  Seeder started on port: {options.get('port', 6881)}")
        print()
        
        print("Step 3: Initializing diffusion monitor...")
        monitor = DiffusionMonitor(creator.infohash_hex, seeder.peer_id)
        print("  Diffusion monitor ready, tracking peer connections")
        print()
        
        print("Step 4: Announcing to DHT network...")
        announce_count = await self.dht_network.announce_peer(
            creator.infohash, 
            options.get('port', 6881)
        )
        print(f"  Announced to {announce_count} DHT nodes")
        
        asyncio.create_task(
            self.dht_network.announce_periodically(
                creator.infohash, 
                options.get('port', 6881),
                interval=300
            )
        )
        print("  Scheduled periodic announcements (every 5 minutes)")
        print()
        
        print("=" * 60)
        print("Seeding active! Press Ctrl+C to stop...")
        print("=" * 60)
        print(f"  Magnet link: {magnet_link}")
        print(f"  Infohash: {creator.infohash_hex}")
        print(f"  File: {creator.name}")
        print(f"  Size: {creator.total_size} bytes ({creator.total_size / 1024 / 1024:.2f} MB)")
        print(f"  Pieces: {len(creator.piece_hashes)}")
        print("=" * 60)
        
        start_time = asyncio.get_event_loop().time()
        last_stats_time = start_time
        stats_interval = options.get('stats_interval', 60)
        topology_path = options.get('topology_output', 'diffusion_topology.json')
        
        try:
            while True:
                await asyncio.sleep(1)
                current_time = asyncio.get_event_loop().time()
                
                if current_time - last_stats_time >= stats_interval:
                    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Seeding status update:")
                    seeder_stats = seeder.get_stats()
                    print(f"  Active peers: {seeder_stats['active_peers']}")
                    print(f"  Peak connections: {seeder_stats['peak_connections']}")
                    print(f"  Total uploaded: {seeder_stats['total_uploaded_bytes'] / 1024 / 1024:.2f} MB")
                    
                    monitor.print_summary()
                    
                    monitor.save_topology_json(topology_path)
                    print(f"  Topology data saved to: {topology_path}")
                    last_stats_time = current_time
                    
        except KeyboardInterrupt:
            print("\n\nStopping seeder...")
        
        finally:
            await seeder.stop()
            monitor.save_topology_json(topology_path)
            print(f"Final diffusion topology saved to: {topology_path}")
            monitor.print_summary()
        
        report = {
            'metadata': {
                'name': creator.name,
                'infohash': creator.infohash_hex,
                'magnet_link': magnet_link,
                'timestamp': datetime.now().isoformat(),
                'version': '1.0.0'
            },
            'seeding': {
                'total_time_seconds': int(asyncio.get_event_loop().time() - start_time),
                'total_uploaded_bytes': seeder.get_stats()['total_uploaded_bytes'],
                'peak_connections': seeder.get_stats()['peak_connections']
            },
            'diffusion': monitor.get_detailed_topology(),
            'statistics': {
                'elapsed_time_seconds': int(asyncio.get_event_loop().time() - start_time),
                'diffusion_speed': monitor.get_diffusion_speed(),
                'coverage': monitor.get_distribution_coverage(),
                'completed_seeders': monitor.completed_seeders,
                'total_pieces_distributed': monitor.total_pieces_distributed
            }
        }
        
        return report
    
    async def close(self):
        if self.dht_network:
            await self.dht_network.close()
        print("\nDHT Crawler stopped.")

def add_traversal_arguments(parser):
    traversal_group = parser.add_argument_group('NAT Traversal Options')
    traversal_group.add_argument('--no-traversal', action='store_true', help='Disable all NAT traversal strategies')
    traversal_group.add_argument('--no-upnp', action='store_true', help='Disable UPnP port mapping')
    traversal_group.add_argument('--no-relay', action='store_true', help='Disable relay nodes')
    traversal_group.add_argument('--no-quic', action='store_true', help='Disable QUIC fallback')
    traversal_group.add_argument('--no-nat-detection', action='store_true', help='Disable NAT type detection')
    traversal_group.add_argument('--force-strategy', type=str, 
                            choices=['direct_udp', 'upnp', 'relay', 'tcp_fallback', 'quic_fallback'],
                            help='Force specific traversal strategy')

async def main():
    parser = argparse.ArgumentParser(
        description='DHT Network Crawler - Peer discovery and file health prediction with NAT traversal',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic crawl for an infohash
  python main.py crawl --infohash 0123456789abcdef0123456789abcdef01234567
  
  # Crawl with torrent file for integrity analysis
  python main.py crawl --infohash 0123456789abcdef0123456789abcdef01234567 --torrent file.torrent --analyze-integrity
  
  # Force use of relay nodes for restrictive NAT
  python main.py crawl --infohash 0123456789abcdef0123456789abcdef01234567 --force-strategy relay
  
  # Seed a file via DHT (generate magnet link and start seeding)
  python main.py seed /path/to/your/file --save-torrent
  
  # Seed a directory with custom piece size and relay strategy
  python main.py seed /path/to/your/directory --piece-size 524288 --force-strategy relay
  
  # Train the prediction model with custom data
  python main.py train --data historical_data.csv
  
  # Batch mode - crawl multiple infohashes
  python main.py batch --infohashes infohash1 infohash2 infohash3
  
  # Run NAT traversal diagnostic test
  python main.py test-traversal
        """
    )
    
    subparsers = parser.add_subparsers(dest='command', help='Available commands')
    
    crawl_parser = subparsers.add_parser('crawl', help='Crawl DHT for a specific infohash')
    crawl_parser.add_argument('--infohash', required=True, help='Target infohash (40 hex chars)')
    crawl_parser.add_argument('--port', type=int, default=6881, help='DHT listening port (default: 6881)')
    crawl_parser.add_argument('--crawl-timeout', type=int, default=60, help='Peer crawl timeout in seconds (default: 60)')
    crawl_parser.add_argument('--torrent', dest='torrent_file', help='Path to torrent file for metadata')
    crawl_parser.add_argument('--analyze-integrity', action='store_true', help='Download and verify file pieces')
    crawl_parser.add_argument('--max-pieces', type=int, default=10, help='Max pieces to check for integrity (default: 10)')
    crawl_parser.add_argument('--output', '-o', default='report.json', help='Output report file (default: report.json)')
    add_traversal_arguments(crawl_parser)
    
    train_parser = subparsers.add_parser('train', help='Train or retrain the health prediction model')
    train_parser.add_argument('--data', help='Path to historical training data (CSV)')
    train_parser.add_argument('--samples', type=int, default=1000, help='Number of synthetic samples if no data provided')
    train_parser.add_argument('--output', '-o', default='models/health_model.pkl', help='Output model path')
    
    batch_parser = subparsers.add_parser('batch', help='Batch crawl multiple infohashes')
    batch_parser.add_argument('--infohashes', nargs='+', required=True, help='List of infohashes to crawl')
    batch_parser.add_argument('--port', type=int, default=6881, help='DHT listening port')
    batch_parser.add_argument('--output-dir', default='reports', help='Output directory for reports')
    add_traversal_arguments(batch_parser)
    
    test_parser = subparsers.add_parser('test-traversal', help='Test NAT traversal capabilities')
    
    seed_parser = subparsers.add_parser('seed', help='Seed a file or directory via DHT network')
    seed_parser.add_argument('file_path', help='Path to the file or directory to seed')
    seed_parser.add_argument('--port', type=int, default=6881, help='DHT and seeding port (default: 6881)')
    seed_parser.add_argument('--piece-size', type=int, default=262144, help='Torrent piece size in bytes (default: 262144 = 256KB)')
    seed_parser.add_argument('--save-torrent', action='store_true', help='Save the generated .torrent file')
    seed_parser.add_argument('--torrent-output', help='Path to save the torrent file (if --save-torrent)')
    seed_parser.add_argument('--topology-output', default='diffusion_topology.json', help='Path to save diffusion topology JSON')
    seed_parser.add_argument('--stats-interval', type=int, default=60, help='Seconds between status updates (default: 60)')
    seed_parser.add_argument('--output', '-o', default='seeding_report.json', help='Final seeding report output')
    add_traversal_arguments(seed_parser)
    
    args = parser.parse_args()
    
    if args.command == 'crawl':
        cli = DHTCrawlerCLI()
        try:
            await cli.initialize(
                port=args.port,
                enable_traversal=not args.no_traversal,
                enable_upnp=not args.no_upnp,
                enable_relay=not args.no_relay,
                enable_quic=not args.no_quic,
                enable_nat_detection=not args.no_nat_detection,
                force_strategy=getattr(args, 'force_strategy', None)
            )
            
            options = {
                'crawl_timeout': args.crawl_timeout,
                'torrent_file': args.torrent_file,
                'analyze_integrity': args.analyze_integrity,
                'max_pieces': args.max_pieces
            }
            
            report = await cli.crawl_infohash(args.infohash, options)
            cli.save_report(report, args.output)
            
        finally:
            await cli.close()
    
    elif args.command == 'train':
        print("Training health prediction model...")
        predictor = HealthPredictor()
        
        if args.data and os.path.exists(args.data):
            import pandas as pd
            training_data = pd.read_csv(args.data)
            metrics = predictor.train_model(training_data)
        else:
            print(f"No data file provided, generating {args.samples} synthetic samples...")
            metrics = predictor.train_model()
        
        print("\nTraining complete!")
        print(f"\nPeers Prediction Metrics:")
        print(f"  R2 Score: {metrics['peers_prediction_metrics']['r2']:.4f}")
        print(f"  RMSE: {metrics['peers_prediction_metrics']['rmse']:.4f}")
        print(f"\nSurvival Prediction Metrics:")
        print(f"  R2 Score: {metrics['survival_prediction_metrics']['r2']:.4f}")
        print(f"  RMSE: {metrics['survival_prediction_metrics']['rmse']:.4f}")
        print(f"\nTop 5 Feature Importance:")
        for i, (feature, importance) in enumerate(list(metrics['feature_importance'].items())[:5]):
            print(f"  {i+1}. {feature}: {importance}")
        
        os.makedirs(os.path.dirname(args.output), exist_ok=True)
        predictor.save_model(os.path.basename(args.output))
    
    elif args.command == 'batch':
        os.makedirs(args.output_dir, exist_ok=True)
        cli = DHTCrawlerCLI()
        
        try:
            await cli.initialize(
                port=args.port,
                enable_traversal=not args.no_traversal,
                enable_upnp=not args.no_upnp,
                enable_relay=not args.no_relay,
                enable_quic=not args.no_quic,
                enable_nat_detection=not args.no_nat_detection,
                force_strategy=getattr(args, 'force_strategy', None)
            )
            
            for i, infohash in enumerate(args.infohashes):
                print(f"\n{'='*60}")
                print(f"Processing {i+1}/{len(args.infohashes)}: {infohash}")
                print(f"{'='*60}\n")
                
                options = {
                    'crawl_timeout': 60,
                    'torrent_file': None,
                    'analyze_integrity': False,
                    'max_pieces': 5
                }
                
                report = await cli.crawl_infohash(infohash, options)
                output_file = os.path.join(args.output_dir, f"{infohash[:8]}_report.json")
                cli.save_report(report, output_file)
                
                if i < len(args.infohashes) - 1:
                    await asyncio.sleep(5)
        
        finally:
            await cli.close()
    
    elif args.command == 'test-traversal':
        print("Running NAT traversal diagnostic tests...")
        print("=" * 60)
        
        import subprocess
        result = subprocess.run(
            [sys.executable, 'test_traversal.py'],
            capture_output=False,
            cwd=os.path.dirname(os.path.abspath(__file__))
        )
        sys.exit(result.returncode)
    
    elif args.command == 'seed':
        cli = DHTCrawlerCLI()
        try:
            await cli.initialize(
                port=args.port,
                enable_traversal=not args.no_traversal,
                enable_upnp=not args.no_upnp,
                enable_relay=not args.no_relay,
                enable_quic=not args.no_quic,
                enable_nat_detection=not args.no_nat_detection,
                force_strategy=getattr(args, 'force_strategy', None)
            )
            
            options = {
                'port': args.port,
                'piece_size': args.piece_size,
                'save_torrent': args.save_torrent,
                'torrent_output': args.torrent_output,
                'topology_output': args.topology_output,
                'stats_interval': args.stats_interval
            }
            
            report = await cli.seed_file(args.file_path, options)
            cli.save_report(report, args.output)
            
        finally:
            await cli.close()
    
    else:
        parser.print_help()

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nOperation cancelled by user.")
        sys.exit(0)
    except Exception as e:
        print(f"\nError: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
