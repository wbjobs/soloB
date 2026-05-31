import uvicorn
import argparse
import sys
import os


def main():
    parser = argparse.ArgumentParser(description='Federated Query Gateway')
    parser.add_argument('--mode', type=str, default='http', 
                       choices=['http', 'grpc', 'both'],
                       help='Run mode: http, grpc, or both')
    parser.add_argument('--http-port', type=int, default=8000,
                       help='HTTP server port')
    parser.add_argument('--grpc-port', type=int, default=50051,
                       help='gRPC server port')
    parser.add_argument('--host', type=str, default='0.0.0.0',
                       help='Server host')
    parser.add_argument('--config', type=str, default='config.yaml',
                       help='Path to config file')
    
    args = parser.parse_args()
    
    if args.mode in ['http', 'both']:
        print(f"Starting HTTP server on {args.host}:{args.http_port}")
        import subprocess
        http_process = subprocess.Popen([
            sys.executable, '-m', 'uvicorn',
            'federated_query_gateway.api.http_api:app',
            '--host', args.host,
            '--port', str(args.http_port),
            '--reload'
        ])
    
    if args.mode in ['grpc', 'both']:
        print(f"Starting gRPC server on {args.host}:{args.grpc_port}")
        from federated_query_gateway.api.grpc_server import serve as grpc_serve
        grpc_serve(port=args.grpc_port, config_path=args.config)
    
    if args.mode == 'http':
        http_process.wait()


if __name__ == '__main__':
    main()
