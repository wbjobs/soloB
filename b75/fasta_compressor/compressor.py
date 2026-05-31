from typing import List, Tuple, Dict
import struct
import os


class DNACustomCompressor:
    BASE_ENCODING = {'A': 0, 'T': 1, 'G': 2, 'C': 3}
    BASE_DECODING = {0: 'A', 1: 'T', 2: 'G', 3: 'C'}

    def __init__(self, window_size: int = 32768, min_match: int = 8, max_match: int = 255):
        self.window_size = window_size
        self.min_match = min_match
        self.max_match = max_match

    def _encode_bases(self, sequence: str) -> bytes:
        encoded = bytearray()
        for i in range(0, len(sequence), 4):
            chunk = sequence[i:i+4]
            byte_val = 0
            for j, base in enumerate(chunk):
                if base in self.BASE_ENCODING:
                    byte_val |= self.BASE_ENCODING[base] << (2 * j)
                else:
                    byte_val |= 0 << (2 * j)
            encoded.append(byte_val & 0xFF)
        return bytes(encoded)

    def _decode_bases(self, encoded: bytes, length: int) -> str:
        decoded = []
        for i, byte_val in enumerate(encoded):
            for j in range(4):
                if len(decoded) >= length:
                    break
                base_code = (byte_val >> (2 * j)) & 0x03
                decoded.append(self.BASE_DECODING[base_code])
        return ''.join(decoded[:length])

    def _find_longest_match(self, data: bytes, current_pos: int) -> Tuple[int, int]:
        end_pos = min(current_pos + self.max_match, len(data))
        best_offset = 0
        best_length = 0

        window_start = max(0, current_pos - self.window_size)

        for match_len in range(self.min_match, end_pos - current_pos + 1):
            current_sub = data[current_pos:current_pos + match_len]
            found_offset = data.rfind(current_sub, window_start, current_pos)
            if found_offset != -1:
                best_offset = current_pos - found_offset
                best_length = match_len
            else:
                break

        return best_offset, best_length

    def _lz77_compress(self, data: bytes) -> List[Tuple[int, int, int]]:
        tokens = []
        pos = 0
        data_len = len(data)

        while pos < data_len:
            offset, length = self._find_longest_match(data, pos)
            if length > 0 and pos + length < data_len:
                next_char = data[pos + length]
                tokens.append((offset, length, next_char))
                pos += length + 1
            elif length > 1 and pos + length == data_len:
                tokens.append((offset, length - 1, data[data_len - 1]))
                pos = data_len
            else:
                tokens.append((0, 0, data[pos]))
                pos += 1

        return tokens

    def _lz77_decompress(self, tokens: List[Tuple[int, int, int]]) -> bytes:
        result = bytearray()
        for offset, length, char in tokens:
            if offset > 0:
                start = len(result) - offset
                if start < 0:
                    start = 0
                for i in range(length):
                    result.append(result[start + i])
            result.append(char)
        return bytes(result)

    def _serialize_tokens(self, tokens: List[Tuple[int, int, int]], header: str) -> bytes:
        header_bytes = header.encode('utf-8')
        header_len = len(header_bytes)

        result = bytearray()
        result.extend(struct.pack('<I', header_len))
        result.extend(header_bytes)
        result.extend(struct.pack('<I', len(tokens)))

        for offset, length, char in tokens:
            result.extend(struct.pack('<H', offset))
            result.extend(struct.pack('<B', length))
            result.extend(struct.pack('<B', char))

        return bytes(result)

    def _deserialize_tokens(self, data: bytes) -> Tuple[str, List[Tuple[int, int, int]]]:
        ptr = 0

        header_len = struct.unpack('<I', data[ptr:ptr+4])[0]
        ptr += 4

        header = data[ptr:ptr+header_len].decode('utf-8')
        ptr += header_len

        num_tokens = struct.unpack('<I', data[ptr:ptr+4])[0]
        ptr += 4

        tokens = []
        for _ in range(num_tokens):
            offset = struct.unpack('<H', data[ptr:ptr+2])[0]
            ptr += 2
            length = struct.unpack('<B', data[ptr:ptr+1])[0]
            ptr += 1
            char = struct.unpack('<B', data[ptr:ptr+1])[0]
            ptr += 1
            tokens.append((offset, length, char))

        return header, tokens

    def compress(self, sequence: str, header: str) -> bytes:
        encoded_bases = self._encode_bases(sequence)
        tokens = self._lz77_compress(encoded_bases)
        return self._serialize_tokens(tokens, header)

    def decompress(self, compressed_data: bytes) -> Tuple[str, str]:
        header, tokens = self._deserialize_tokens(compressed_data)
        encoded_bases = self._lz77_decompress(tokens)
        sequence = self._decode_bases(encoded_bases, len(encoded_bases) * 4)
        return header, sequence


class ParallelCompressor:
    def __init__(self, chunk_size: int = 1024 * 1024, num_threads: int = None):
        self.chunk_size = chunk_size
        self.num_threads = num_threads or os.cpu_count() or 4
        self.compressor = DNACustomCompressor()

    def _split_sequence(self, sequence: str) -> List[Tuple[int, int, str]]:
        chunks = []
        total_len = len(sequence)
        for i in range(0, total_len, self.chunk_size):
            chunk = sequence[i:i + self.chunk_size]
            chunks.append((i, total_len, chunk))
        return chunks

    def _compress_chunk(self, args: Tuple[int, int, str]) -> Tuple[int, bytes]:
        idx, total_len, chunk = args
        encoded = self.compressor._encode_bases(chunk)
        tokens = self.compressor._lz77_compress(encoded)
        token_data = bytearray()
        for offset, length, char in tokens:
            token_data.extend(struct.pack('<H', offset))
            token_data.extend(struct.pack('<B', length))
            token_data.extend(struct.pack('<B', char))
        return idx, bytes(token_data)

    def compress_large_sequence(self, sequence: str, header: str) -> bytes:
        import concurrent.futures

        chunks = self._split_sequence(sequence)
        compressed_chunks = {}

        with concurrent.futures.ThreadPoolExecutor(max_workers=self.num_threads) as executor:
            future_to_idx = {
                executor.submit(self._compress_chunk, chunk): chunk[0]
                for chunk in chunks
            }
            for future in concurrent.futures.as_completed(future_to_idx):
                idx, chunk_data = future.result()
                compressed_chunks[idx] = chunk_data

        sorted_indices = sorted(compressed_chunks.keys())
        sorted_chunks = [compressed_chunks[idx] for idx in sorted_indices]

        header_bytes = header.encode('utf-8')
        result = bytearray()
        result.extend(struct.pack('<I', len(header_bytes)))
        result.extend(header_bytes)
        result.extend(struct.pack('<I', len(sorted_chunks)))

        for chunk_data in sorted_chunks:
            result.extend(struct.pack('<I', len(chunk_data)))
            result.extend(chunk_data)

        return bytes(result)

    def _decompress_chunk(self, args: Tuple[int, bytes]) -> Tuple[int, str]:
        idx, chunk_data = args
        ptr = 0
        tokens = []
        while ptr < len(chunk_data):
            offset = struct.unpack('<H', chunk_data[ptr:ptr+2])[0]
            ptr += 2
            length = struct.unpack('<B', chunk_data[ptr:ptr+1])[0]
            ptr += 1
            char = struct.unpack('<B', chunk_data[ptr:ptr+1])[0]
            ptr += 1
            tokens.append((offset, length, char))
        encoded = self.compressor._lz77_decompress(tokens)
        sequence_chunk = self.compressor._decode_bases(encoded, len(encoded) * 4)
        return idx, sequence_chunk

    def decompress_large_sequence(self, compressed_data: bytes, parallel: bool = False) -> Tuple[str, str]:
        ptr = 0

        header_len = struct.unpack('<I', compressed_data[ptr:ptr+4])[0]
        ptr += 4
        header = compressed_data[ptr:ptr+header_len].decode('utf-8')
        ptr += header_len

        num_chunks = struct.unpack('<I', compressed_data[ptr:ptr+4])[0]
        ptr += 4

        chunks_data = []
        for _ in range(num_chunks):
            chunk_len = struct.unpack('<I', compressed_data[ptr:ptr+4])[0]
            ptr += 4
            chunk_data = compressed_data[ptr:ptr+chunk_len]
            ptr += chunk_len
            chunks_data.append(chunk_data)

        if parallel and num_chunks > 1:
            import concurrent.futures
            chunks_with_idx = [(i, data) for i, data in enumerate(chunks_data)]
            decompressed_chunks = {}
            with concurrent.futures.ThreadPoolExecutor(max_workers=self.num_threads) as executor:
                future_to_idx = {
                    executor.submit(self._decompress_chunk, chunk): chunk[0]
                    for chunk in chunks_with_idx
                }
                for future in concurrent.futures.as_completed(future_to_idx):
                    idx, sequence_chunk = future.result()
                    decompressed_chunks[idx] = sequence_chunk
            full_sequence = [decompressed_chunks[idx] for idx in sorted(decompressed_chunks.keys())]
        else:
            full_sequence = []
            for chunk_data in chunks_data:
                _, sequence_chunk = self._decompress_chunk((0, chunk_data))
                full_sequence.append(sequence_chunk)

        return header, ''.join(full_sequence)
