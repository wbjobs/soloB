import sys
sys.path.insert(0, '.')

from fasta_compressor.fasta_parser import FastaParser
from fasta_compressor.compressor import DNACustomCompressor

records = FastaParser.parse("test_data.fasta")

for record in records:
    print(f"\n=== {record.id} ===")
    print(f"序列长度: {len(record.sequence)}")
    print(f"前50个碱基: {record.sequence[:50]}")
    
    compressor = DNACustomCompressor()
    encoded = compressor._encode_bases(record.sequence)
    print(f"编码后长度: {len(encoded)} 字节")
    
    decoded = compressor._decode_bases(encoded, len(record.sequence))
    print(f"解码后长度: {len(decoded)}")
    print(f"解码后前50个碱基: {decoded[:50]}")
    
    if record.sequence == decoded:
        print("✓ 编码/解码正确")
    else:
        print("✗ 编码/解码不正确")
        for i, (a, b) in enumerate(zip(record.sequence, decoded)):
            if a != b:
                print(f"  位置 {i}: 原={a}, 解={b}")
                break
