import sys
sys.path.insert(0, '.')

from fasta_compressor.fasta_parser import FastaParser
from fasta_compressor.compressor import DNACustomCompressor

records = FastaParser.parse("test_data.fasta")

for record in records:
    print(f"\n=== {record.id} ===")
    sequence = record.sequence
    
    compressor = DNACustomCompressor()
    
    encoded = compressor._encode_bases(sequence)
    print(f"编码后: {len(encoded)} 字节")
    
    tokens = compressor._lz77_compress(encoded)
    print(f"LZ77 令牌数: {len(tokens)}")
    
    decoded = compressor._lz77_decompress(tokens)
    print(f"解压缩后: {len(decoded)} 字节")
    
    if encoded == decoded:
        print("✓ LZ77 压缩/解压缩正确")
    else:
        print("✗ LZ77 压缩/解压缩不正确")
        print(f"  原始编码长度: {len(encoded)}")
        print(f"  解压缩长度: {len(decoded)}")
        
        for i, (a, b) in enumerate(zip(encoded, decoded)):
            if a != b:
                print(f"  位置 {i}: 原={a}, 解={b}")
                break
    
    compressed = compressor.compress(sequence, record.header)
    _, decompressed = compressor.decompress(compressed)
    
    print(f"完整压缩后: {len(compressed)} 字节")
    print(f"完整解压缩后: {len(decompressed)} 碱基")
    
    if sequence == decompressed[:len(sequence)]:
        print("✓ 完整压缩/解压缩正确")
    else:
        print("✗ 完整压缩/解压缩不正确")
        for i, (a, b) in enumerate(zip(sequence, decompressed)):
            if a != b:
                print(f"  位置 {i}: 原={a}, 解={b}")
                break
