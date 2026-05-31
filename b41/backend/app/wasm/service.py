import os
import json
from typing import Optional
from wasmtime import Store, Module, Instance, Engine, Config

from ..schemas.schemas import AlignmentResult, ProgressUpdate


class WasmAlignmentService:
    _instance: Optional['WasmAlignmentService'] = None
    _initialized = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if WasmAlignmentService._initialized:
            return
        self.engine = None
        self.module = None
        self.instance = None
        self.store = None
        self._load_wasm()
        WasmAlignmentService._initialized = True

    def _load_wasm(self):
        try:
            config = Config()
            self.engine = Engine(config)
            self.store = Store(self.engine)

            wasm_path = os.environ.get(
                "WASM_MODULE_PATH",
                os.path.join(
                    os.path.dirname(__file__),
                    "alignment_service.wasm"
                )
            )
            wasm_path = os.path.abspath(wasm_path)

            if not os.path.exists(wasm_path):
                alt_path = os.path.join(
                    os.path.dirname(__file__),
                    "..",
                    "..",
                    "..",
                    "rust-service",
                    "target",
                    "wasm32-wasi",
                    "release",
                    "alignment_service.wasm"
                )
                alt_path = os.path.abspath(alt_path)
                if os.path.exists(alt_path):
                    wasm_path = alt_path

            if not os.path.exists(wasm_path):
                raise FileNotFoundError(
                    f"Wasm module not found at {wasm_path}. "
                    "Please compile the Rust module first using: "
                    "python compile_wasm.py"
                )

            print(f"Loading Wasm module from: {wasm_path}")
            self.module = Module.from_file(self.engine, wasm_path)
            self.instance = Instance(self.store, self.module, [])

            print("Wasm module loaded successfully!")

        except Exception as e:
            print(f"Failed to load Wasm module: {e}")
            raise

    def _read_memory(self, ptr: int, length: int) -> bytes:
        memory = self.instance.exports(self.store).get("memory")
        if not memory:
            raise RuntimeError("Memory not found in Wasm module")
        
        data = memory.read(self.store, ptr, ptr + length)
        return bytes(data)

    def _write_memory(self, ptr: int, data: bytes):
        memory = self.instance.exports(self.store).get("memory")
        if not memory:
            raise RuntimeError("Memory not found in Wasm module")
        
        memory.write(self.store, ptr, data)

    def _get_func(self, name: str):
        if not self.instance:
            raise RuntimeError("Wasm instance not initialized")
        func = self.instance.exports(self.store).get(name)
        if not func:
            raise RuntimeError(f"Function '{name}' not found in Wasm module")
        return func

    def align(
        self,
        sequence_a: str,
        sequence_b: str,
        match_score: int = 1,
        mismatch_score: int = -1,
        gap_score: int = -2
    ) -> AlignmentResult:
        if not self.instance or not self.store:
            raise RuntimeError("Wasm service not initialized")

        try:
            malloc = self._get_func("malloc")
            free = self._get_func("free")
            align_fn = self._get_func("align_sequences_json")

            input_data = {
                "seq_a": sequence_a,
                "seq_b": sequence_b,
                "match_score": match_score,
                "mismatch_score": mismatch_score,
                "gap_score": gap_score
            }
            input_json = json.dumps(input_data, ensure_ascii=False)
            input_bytes = input_json.encode('utf-8')
            input_len = len(input_bytes)

            input_ptr = malloc(self.store, input_len)
            if input_ptr == 0:
                raise RuntimeError("Failed to allocate memory in Wasm module")

            try:
                self._write_memory(input_ptr, input_bytes)

                output_len_ptr = malloc(self.store, 8)
                if output_len_ptr == 0:
                    raise RuntimeError("Failed to allocate output length memory")

                try:
                    output_ptr = align_fn(
                        self.store, 
                        input_ptr, 
                        input_len, 
                        output_len_ptr
                    )
                    
                    if output_ptr == 0:
                        raise RuntimeError("Alignment function returned null pointer")

                    output_len_data = self._read_memory(output_len_ptr, 8)
                    output_len = int.from_bytes(output_len_data, byteorder='little')

                    if output_len == 0:
                        raise RuntimeError("Alignment function returned zero length")

                    result_bytes = self._read_memory(output_ptr, output_len)
                    result_json = result_bytes.decode('utf-8')
                    result_dict = json.loads(result_json)

                    progress_list = []
                    for p in result_dict.get("progress", []):
                        progress_list.append(ProgressUpdate(
                            step=p.get("step", 0),
                            total=p.get("total", 4),
                            message=p.get("message", "")
                        ))

                    free(self.store, output_ptr, output_len)

                    return AlignmentResult(
                        aligned_a=result_dict.get("aligned_a", ""),
                        aligned_b=result_dict.get("aligned_b", ""),
                        alignment_string=result_dict.get("alignment_string", ""),
                        score=result_dict.get("score", 0),
                        progress=progress_list
                    )

                finally:
                    free(self.store, output_len_ptr, 8)

            finally:
                free(self.store, input_ptr, input_len)

        except Exception as e:
            print(f"Wasm alignment error: {e}")
            import traceback
            traceback.print_exc()
            raise


def get_wasm_service() -> WasmAlignmentService:
    return WasmAlignmentService()
