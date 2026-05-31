import sys
sys.path.insert(0, '.')

from fasta_compressor.fasta_parser import FastaParser
from fasta_compressor.compressor import DNACustomCompressor

records = FastaParser.parse("test_data.fasta")
record = records[2]  # test_sequence_3

print(f"=== {record.id} ===")
sequence = record.sequence
print(f"序列长度: {len(sequence)}")

compressor = DNACustomCompressor()

encoded = compressor._encode_bases(sequence)
print(f"编码后长度: {len(encoded)} 字节")

tokens = compressor._lz77_compress(encoded)
print(f"令牌数: {len(tokens)}")

print("\n前10个令牌:")
for i, (offset, length, char) in enumerate(tokens[:10]):
    print(f"  {i}: offset={offset}, length={length}, char={char}")

print("\n最后5个令牌:")
for i, (offset, length, char) in enumerate(tokens[-5:]):
    print(f"  {len(tokens)-5+i}: offset={offset}, length={length}, char={char}")

print("\n手动解压缩:")
result = bytearray()
for idx, (offset, length, char) in enumerate(tokens):
    print(f"令牌 {idx}: offset={offset}, length={length}, char={char}, result_len={len(result)}", end='')
    if offset > 0:
        start = len(result) - offset
        print(f", start={start}", end='')
        for i in range(length):
            result.append(result[start + i])
    if length == 0 or (offset > 0 and char != 0):
        result.append(char)
        print(f", 添加char")
    else:
        print(f", 不添加char")

print(f"\n最终解压缩长度: {len(result)}")
print(f"原始编码长度: {len(encoded)}")

if len(result) != len(encoded):
    print(f"✗ 长度不匹配!")
