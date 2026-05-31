import subprocess
import os
import sys

def generate_grpc():
    proto_path = os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "..",
        "rust-service",
        "proto",
        "alignment.proto"
    )
    proto_path = os.path.abspath(proto_path)
    output_dir = os.path.dirname(__file__)

    if not os.path.exists(proto_path):
        print(f"Proto file not found: {proto_path}")
        sys.exit(1)

    command = [
        sys.executable,
        "-m",
        "grpc_tools.protoc",
        f"-I{os.path.dirname(proto_path)}",
        f"--python_out={output_dir}",
        f"--grpc_python_out={output_dir}",
        "alignment.proto"
    ]

    print(f"Running: {' '.join(command)}")
    result = subprocess.run(command)
    
    if result.returncode == 0:
        print("gRPC code generation successful!")
    else:
        print(f"gRPC code generation failed with code: {result.returncode}")
        sys.exit(1)


if __name__ == "__main__":
    generate_grpc()
