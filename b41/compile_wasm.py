#!/usr/bin/env python3
import subprocess
import os
import sys
import shutil


def check_rust():
    try:
        subprocess.run(["rustc", "--version"], check=True, capture_output=True)
        return True
    except Exception:
        print("Error: Rust is not installed. Please install Rust from https://rustup.rs/")
        return False


def check_wasm_target():
    try:
        result = subprocess.run(
            ["rustup", "target", "list", "--installed"],
            check=True,
            capture_output=True,
            text=True
        )
        return "wasm32-wasi" in result.stdout
    except Exception:
        return False


def add_wasm_target():
    print("Adding wasm32-wasi target...")
    try:
        subprocess.run(
            ["rustup", "target", "add", "wasm32-wasi"],
            check=True
        )
        return True
    except Exception as e:
        print(f"Error adding wasm target: {e}")
        return False


def compile_wasm():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    rust_service_dir = os.path.join(script_dir, "..", "rust-service")
    rust_service_dir = os.path.abspath(rust_service_dir)

    if not os.path.exists(rust_service_dir):
        print(f"Error: Rust service directory not found at {rust_service_dir}")
        return False

    print(f"Compiling Wasm module in {rust_service_dir}...")
    
    try:
        subprocess.run(
            ["cargo", "build", "--release", "--target", "wasm32-wasi"],
            cwd=rust_service_dir,
            check=True
        )
        
        wasm_src = os.path.join(
            rust_service_dir,
            "target",
            "wasm32-wasi",
            "release",
            "alignment_service.wasm"
        )
        
        if not os.path.exists(wasm_src):
            print(f"Error: Compiled Wasm module not found at {wasm_src}")
            return False

        backend_wasm_dir = os.path.join(
            script_dir,
            "backend",
            "app",
            "wasm"
        )
        os.makedirs(backend_wasm_dir, exist_ok=True)
        
        wasm_dst = os.path.join(backend_wasm_dir, "alignment_service.wasm")
        
        shutil.copy2(wasm_src, wasm_dst)
        print(f"\n✓ Wasm module compiled and copied to:")
        print(f"  {wasm_dst}")
        print(f"\n✓ Original location:")
        print(f"  {wasm_src}")
        
        return True

    except subprocess.CalledProcessError as e:
        print(f"Error compiling Wasm module: {e}")
        return False
    except Exception as e:
        print(f"Unexpected error: {e}")
        return False


def main():
    print("=" * 60)
    print("DNA Alignment Service - Wasm Compiler")
    print("=" * 60)

    if not check_rust():
        sys.exit(1)

    if not check_wasm_target():
        print("Wasm target not found, adding it...")
        if not add_wasm_target():
            sys.exit(1)

    if compile_wasm():
        print("\n✓ Wasm module ready for use!")
        sys.exit(0)
    else:
        print("\n✗ Failed to compile Wasm module")
        sys.exit(1)


if __name__ == "__main__":
    main()
