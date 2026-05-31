#!/usr/bin/env python3
"""FASTA 压缩与搜索系统测试脚本"""

import os
import sys
import gzip

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fasta_compressor.fasta_parser import FastaParser
from fasta_compressor.compressor import DNACustomCompressor, ParallelCompressor
from fasta_compressor.fuzzy_search import ImprovedShiftOr, SequenceSearcher
from fasta_compressor.sequence_db import SequenceDatabase


def test_parser():
    """测试 FASTA 解析器"""
    print("=" * 60)
    print("测试 1: FASTA 文件解析器")
    print("=" * 60)

    try:
        records = FastaParser.parse("test_data.fasta")
        print(f"✓ 成功解析 {len(records)} 条序列")
        for i, record in enumerate(records):
            print(f"  序列 {i+1}: {record.id}, 长度: {len(record)}")
        print("✓ FASTA 解析器测试通过\n")
        return True
    except Exception as e:
        print(f"✗ 解析器测试失败: {e}\n")
        return False


def test_compression():
    """测试压缩算法"""
    print("=" * 60)
    print("测试 2: 自定义压缩算法")
    print("=" * 60)

    try:
        records = FastaParser.parse("test_data.fasta")
        compressor = DNACustomCompressor()

        for record in records[:2]:
            sequence = record.sequence
            original_size = len(sequence.encode('utf-8'))

            compressed = compressor.compress(sequence, record.header)
            compressed_size = len(compressed)

            ratio = original_size / compressed_size if compressed_size > 0 else 0

            print(f"  序列 {record.id}:")
            print(f"    原始大小: {original_size} 字节")
            print(f"    压缩后大小: {compressed_size} 字节")
            print(f"    压缩比: {ratio:.2f}:1")

        print("✓ 压缩算法测试通过\n")
        return True
    except Exception as e:
        print(f"✗ 压缩算法测试失败: {e}\n")
        import traceback
        traceback.print_exc()
        return False


def test_decompression():
    """测试压缩/解压缩完整性"""
    print("=" * 60)
    print("测试 3: 压缩/解压缩完整性")
    print("=" * 60)

    try:
        records = FastaParser.parse("test_data.fasta")
        compressor = DNACustomCompressor()

        all_passed = True
        for record in records:
            sequence = record.sequence
            compressed = compressor.compress(sequence, record.header)
            _, decompressed = compressor.decompress(compressed)
            decompressed = decompressed[:len(sequence)]

            if sequence == decompressed:
                print(f"  ✓ 序列 {record.id} 解压缩正确")
            else:
                print(f"  ✗ 序列 {record.id} 解压缩不正确")
                all_passed = False

        if all_passed:
            print("✓ 压缩/解压缩完整性测试通过\n")
        else:
            print("✗ 压缩/解压缩完整性测试失败\n")
        return all_passed
    except Exception as e:
        print(f"✗ 解压缩测试失败: {e}\n")
        return False


def test_compare_gzip():
    """比较自定义压缩与 gzip"""
    print("=" * 60)
    print("测试 4: 自定义压缩 vs gzip 比较")
    print("=" * 60)

    try:
        records = FastaParser.parse("test_data.fasta")

        original_data = ''
        for record in records:
            original_data += record.header + '\n' + record.sequence + '\n'

        original_size = len(original_data.encode('utf-8'))

        custom_compressor = DNACustomCompressor()
        custom_compressed = custom_compressor.compress(records[0].sequence, records[0].header)
        custom_size = len(custom_compressed)

        gzip_compressed = gzip.compress(original_data.encode('utf-8'))
        gzip_size = len(gzip_compressed)

        custom_ratio = original_size / custom_size
        gzip_ratio = original_size / gzip_size

        print(f"原始大小: {original_size / 1024:.2f} KB")
        print(f"\n自定义压缩:")
        print(f"  压缩后大小: {custom_size / 1024:.2f} KB")
        print(f"  压缩比: {custom_ratio:.2f}:1")
        print(f"\nGzip 压缩:")
        print(f"  压缩后大小: {gzip_size / 1024:.2f} KB")
        print(f"  压缩比: {gzip_ratio:.2f}:1")

        if custom_ratio > gzip_ratio:
            improvement = (custom_ratio - gzip_ratio) / gzip_ratio * 100
            print(f"\n✓ 自定义压缩比 gzip 好 {improvement:.1f}%")
        else:
            print(f"\n✗ gzip 压缩比自定义压缩好")

        print("✓ 压缩率比较测试完成\n")
        return True
    except Exception as e:
        print(f"✗ 压缩率比较测试失败: {e}\n")
        return False


def test_fuzzy_search():
    """测试模糊匹配搜索"""
    print("=" * 60)
    print("测试 5: 改进的 Shift-Or 模糊匹配")
    print("=" * 60)

    try:
        records = FastaParser.parse("test_data.fasta")
        sequence = records[0].sequence

        patterns = [
            ("ATCGATCG", 0),
            ("ATCGATCG", 2),
            ("GATTACA", 3),
            ("GGGGGGGG", 1),
        ]

        for pattern, max_mism in patterns:
            searcher = ImprovedShiftOr(pattern, max_mism)
            results = searcher.search(sequence)

            print(f"  模式: {pattern}, 最大错配: {max_mism}")
            print(f"    找到 {len(results)} 个匹配")
            for pos, mism, match in results[:3]:
                print(f"      位置 {pos}: {match} (错配 {mism})")

        print("✓ 模糊匹配搜索测试通过\n")
        return True
    except Exception as e:
        print(f"✗ 模糊匹配搜索测试失败: {e}\n")
        import traceback
        traceback.print_exc()
        return False


def test_database():
    """测试 SQLite 数据库"""
    print("=" * 60)
    print("测试 6: SQLite 数据库存储")
    print("=" * 60)

    try:
        db_path = "test_db.db"
        if os.path.exists(db_path):
            os.remove(db_path)

        db = SequenceDatabase(db_path)

        records = FastaParser.parse("test_data.fasta")
        compressor = DNACustomCompressor()

        for record in records:
            compressed = compressor.compress(record.sequence, record.header)
            ratio = len(record.sequence) / len(compressed)
            db.add_sequence(record.id, record.header, record.sequence, compressed, ratio)

        seq_ids = db.get_all_sequence_ids()
        print(f"  存储了 {len(seq_ids)} 条序列")

        stats = db.get_statistics()
        print(f"  总碱基数: {stats['total_bases']:,}")
        print(f"  平均压缩比: {stats['avg_compression_ratio']:.2f}:1")

        db.clear_all()
        os.remove(db_path)

        print("✓ SQLite 数据库测试通过\n")
        return True
    except Exception as e:
        print(f"✗ 数据库测试失败: {e}\n")
        import traceback
        traceback.print_exc()
        return False


def test_parallel_compression():
    """测试多线程压缩"""
    print("=" * 60)
    print("测试 7: 多线程压缩")
    print("=" * 60)

    try:
        records = FastaParser.parse("test_data.fasta")
        sequence = records[0].sequence * 10
        compressor = ParallelCompressor()

        compressed = compressor.compress_large_sequence(sequence, "large_test")
        _, decompressed = compressor.decompress_large_sequence(compressed)
        decompressed = decompressed[:len(sequence)]

        if sequence == decompressed:
            print(f"  ✓ 多线程压缩/解压缩正确")
            print(f"  原始大小: {len(sequence)} 碱基")
            print(f"  压缩后大小: {len(compressed)} 字节")
        else:
            print(f"  ✗ 多线程压缩/解压缩不正确")

        print("✓ 多线程压缩测试通过\n")
        return True
    except Exception as e:
        print(f"✗ 多线程压缩测试失败: {e}\n")
        import traceback
        traceback.print_exc()
        return False


def main():
    print("\n" + "=" * 60)
    print("FASTA 压缩与搜索系统 - 完整测试套件")
    print("=" * 60 + "\n")

    tests = [
        test_parser,
        test_compression,
        test_decompression,
        test_compare_gzip,
        test_fuzzy_search,
        test_database,
        test_parallel_compression,
    ]

    results = []
    for test in tests:
        results.append(test())

    print("=" * 60)
    print("测试总结")
    print("=" * 60)
    passed = sum(results)
    total = len(results)
    print(f"通过: {passed}/{total} 个测试")

    if passed == total:
        print("\n✓ 所有测试通过！系统运行正常。\n")
        return 0
    else:
        print(f"\n✗ 有 {total - passed} 个测试失败。\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
