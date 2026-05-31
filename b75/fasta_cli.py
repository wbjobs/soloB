import click
import os
import gzip
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fasta_compressor.fasta_parser import FastaParser, FastaRecord
from fasta_compressor.compressor import DNACustomCompressor, ParallelCompressor
from fasta_compressor.fuzzy_search import SequenceSearcher, ImprovedShiftOr
from fasta_compressor.sequence_db import SequenceDatabase
from fasta_compressor.sequence_alignment import SequenceAlignment


@click.group()
def cli():
    """FASTA 文件压缩和搜索工具"""
    pass


@cli.command()
@click.argument('input_file', type=click.Path(exists=True))
@click.option('--output', '-o', default=None, help='输出压缩文件路径')
@click.option('--db-path', default='fasta_sequences.db', help='数据库路径')
@click.option('--parallel/--no-parallel', default=True, help='是否使用多线程压缩')
@click.option('--chunk-size', default=1048576, help='大文件分块大小（字节）')
def compress(input_file, output, db_path, parallel, chunk_size):
    """压缩 FASTA 文件并存储到数据库"""
    click.echo(f"正在解析文件: {input_file}")
    
    records = FastaParser.parse(input_file)
    click.echo(f"解析完成，共 {len(records)} 条序列")

    if parallel:
        compressor = ParallelCompressor(chunk_size=chunk_size)
    else:
        compressor = DNACustomCompressor()

    db = SequenceDatabase(db_path)

    total_original_size = 0
    total_compressed_size = 0

    with click.progressbar(records, label='压缩进度') as bar:
        for record in bar:
            sequence = record.sequence
            original_size = len(sequence.encode('utf-8'))
            total_original_size += original_size

            if parallel and len(sequence) > chunk_size:
                compressed = compressor.compress_large_sequence(sequence, record.header)
            else:
                compressed = compressor.compressor.compress(sequence, record.header)

            compressed_size = len(compressed)
            total_compressed_size += compressed_size

            compression_ratio = original_size / compressed_size if compressed_size > 0 else 0

            db.add_sequence(record.id, record.header, sequence, compressed, compression_ratio)

    overall_ratio = total_original_size / total_compressed_size if total_compressed_size > 0 else 0

    click.echo(f"\n压缩完成！")
    click.echo(f"原始总大小: {total_original_size / 1024 / 1024:.2f} MB")
    click.echo(f"压缩后总大小: {total_compressed_size / 1024 / 1024:.2f} MB")
    click.echo(f"压缩比: {overall_ratio:.2f}:1")

    if output:
        with open(output, 'wb') as f:
            for record in records:
                seq_info = db.get_sequence(record.id)
                if seq_info:
                    _, compressed_data, _ = seq_info
                    f.write(compressed_data)
        click.echo(f"压缩文件已保存到: {output}")


@cli.command()
@click.argument('seq_id')
@click.option('--output', '-o', default=None, help='输出 FASTA 文件路径')
@click.option('--db-path', default='fasta_sequences.db', help='数据库路径')
def decompress(seq_id, output, db_path):
    """从数据库解压指定序列"""
    db = SequenceDatabase(db_path)
    seq_info = db.get_sequence(seq_id)

    if not seq_info:
        click.echo(f"错误: 未找到序列 ID: {seq_id}")
        return

    header, compressed_data, original_length = seq_info

    try:
        compressor = ParallelCompressor()
        _, sequence = compressor.decompress_large_sequence(compressed_data)
    except:
        compressor = DNACustomCompressor()
        _, sequence = compressor.decompress(compressed_data)
    
    sequence = sequence[:original_length]

    if output:
        with open(output, 'w') as f:
            f.write(f"{header}\n")
            for i in range(0, len(sequence), 80):
                f.write(f"{sequence[i:i+80]}\n")
        click.echo(f"序列已解压到: {output}")
    else:
        click.echo(f">{header}")
        for i in range(0, min(len(sequence), 800), 80):
            click.echo(sequence[i:i+80])
        if len(sequence) > 800:
            click.echo(f"... (共 {len(sequence)} 个碱基)")


@cli.command()
@click.argument('pattern')
@click.option('--max-mismatches', '-m', default=3, help='最大错配数')
@click.option('--seq-id', default=None, help='指定序列ID搜索')
@click.option('--db-path', default='fasta_sequences.db', help='数据库路径')
@click.option('--output', '-o', default=None, help='输出结果文件')
def search(pattern, max_mismatches, seq_id, db_path, output):
    """在数据库中进行模糊匹配搜索"""
    click.echo(f"正在搜索模式: {pattern} (最大错配: {max_mismatches})")

    db = SequenceDatabase(db_path)

    if seq_id:
        seq_ids = [seq_id]
    else:
        seq_ids = db.get_all_sequence_ids()

    if not seq_ids:
        click.echo("数据库中没有序列")
        return

    searcher = SequenceSearcher()

    for sid in seq_ids:
        seq_info = db.get_sequence(sid)
        if seq_info:
            header, compressed_data, original_length = seq_info
            try:
                compressor = ParallelCompressor()
                _, sequence = compressor.decompress_large_sequence(compressed_data)
            except:
                compressor = DNACustomCompressor()
                _, sequence = compressor.decompress(compressed_data)
            sequence = sequence[:original_length]
            searcher.add_sequence(sid, sequence)

    results = searcher.search_all(pattern, max_mismatches)

    if not results:
        click.echo("未找到匹配")
        return

    output_lines = []
    total_hits = 0

    for sid, hits in results.items():
        total_hits += len(hits)
        line = f"\n序列: {sid}"
        output_lines.append(line)
        click.echo(line)

        for pos, mism, match in hits:
            line = f"  位置: {pos}, 错配: {mism}, 匹配: {match}"
            output_lines.append(line)
            click.echo(line)

    summary = f"\n总计: {total_hits} 个匹配"
    output_lines.append(summary)
    click.echo(summary)

    if output:
        with open(output, 'w') as f:
            f.write('\n'.join(output_lines))
        click.echo(f"结果已保存到: {output}")


@cli.command()
@click.option('--db-path', default='fasta_sequences.db', help='数据库路径')
def list(db_path):
    """列出数据库中的所有序列"""
    db = SequenceDatabase(db_path)
    seq_ids = db.get_all_sequence_ids()

    if not seq_ids:
        click.echo("数据库中没有序列")
        return

    click.echo(f"数据库中的序列 ({len(seq_ids)} 条):")
    for sid in seq_ids:
        seq_info = db.get_sequence(sid)
        if seq_info:
            header, _, length = seq_info
            click.echo(f"  {sid}: {length} 碱基")


@cli.command()
@click.argument('input_file', type=click.Path(exists=True))
@click.option('--db-path', default='fasta_sequences.db', help='数据库路径')
def compare(input_file, db_path):
    """比较自定义压缩与 gzip 的压缩率"""
    click.echo(f"正在比较压缩率...")

    records = FastaParser.parse(input_file)

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

    click.echo(f"\n原始大小: {original_size / 1024:.2f} KB")
    click.echo(f"\n自定义压缩:")
    click.echo(f"  压缩后大小: {custom_size / 1024:.2f} KB")
    click.echo(f"  压缩比: {custom_ratio:.2f}:1")
    click.echo(f"\nGzip 压缩:")
    click.echo(f"  压缩后大小: {gzip_size / 1024:.2f} KB")
    click.echo(f"  压缩比: {gzip_ratio:.2f}:1")

    if custom_ratio > gzip_ratio:
        click.echo(f"\n✓ 自定义压缩比 gzip 好 {(custom_ratio - gzip_ratio) / gzip_ratio * 100:.1f}%")
    else:
        click.echo(f"\n✗ gzip 压缩比自定义压缩好 {(gzip_ratio - custom_ratio) / custom_ratio * 100:.1f}%")


@cli.command()
@click.option('--db-path', default='fasta_sequences.db', help='数据库路径')
def stats(db_path):
    """显示数据库统计信息"""
    db = SequenceDatabase(db_path)
    stats = db.get_statistics()

    click.echo("数据库统计:")
    click.echo(f"  序列总数: {stats['total_sequences']}")
    click.echo(f"  碱基总数: {stats['total_bases']:,}")
    click.echo(f"  平均压缩比: {stats['avg_compression_ratio']:.2f}:1")


@cli.command()
@click.argument('input_file', type=click.Path(exists=True))
@click.option('--seq1', default=None, help='第一条序列的ID（默认使用第一条）')
@click.option('--seq2', default=None, help='第二条序列的ID（默认使用第二条）')
@click.option('--output', '-o', default=None, help='输出 JSON 文件路径')
@click.option('--window-size', '-w', default=10, help='突变密度窗口大小')
@click.option('--no-color', is_flag=True, help='禁用彩色输出')
@click.option('--no-heatmap', is_flag=True, help='不显示 ASCII 热力图')
def align(input_file, seq1, seq2, output, window_size, no_color, no_heatmap):
    """比对两个 DNA 序列，生成突变热力图和差异 JSON"""
    records = FastaParser.parse(input_file)

    if len(records) < 2:
        click.echo("错误: FASTA 文件至少需要两条序列")
        return

    if seq1 is None:
        seq1_record = records[0]
    else:
        seq1_record = next((r for r in records if r.id == seq1), None)
        if seq1_record is None:
            click.echo(f"错误: 未找到序列 ID: {seq1}")
            return

    if seq2 is None:
        seq2_record = records[1]
    else:
        seq2_record = next((r for r in records if r.id == seq2), None)
        if seq2_record is None:
            click.echo(f"错误: 未找到序列 ID: {seq2}")
            return

    click.echo(f"比对序列:")
    click.echo(f"  序列 1: {seq1_record.id} ({len(seq1_record)} 碱基)")
    click.echo(f"  序列 2: {seq2_record.id} ({len(seq2_record)} 碱基)")
    click.echo("")

    alignment = SequenceAlignment()
    result = alignment.align_and_analyze(
        seq1_record.sequence,
        seq2_record.sequence,
        window_size=window_size,
        show_colors=not no_color
    )

    stats = result['statistics']
    click.echo("=" * 60)
    click.echo("比对统计")
    click.echo("=" * 60)
    click.echo(f"比对长度: {stats['alignment_length']} 碱基")
    click.echo(f"匹配: {stats['matches']} ({stats['identity_percentage']:.2f}%)")
    click.echo(f"错配: {stats['mismatches']}")
    click.echo(f"总缺口: {stats['total_gaps']}")
    click.echo(f"  序列 1 缺口: {stats['gaps_in_sequence1']}")
    click.echo(f"  序列 2 缺口: {stats['gaps_in_sequence2']}")
    click.echo(f"比对得分: {stats['match_score']}")
    click.echo("")

    diffs = result['differences']
    if diffs:
        click.echo(f"发现 {len(diffs)} 个差异:")
        click.echo("")
        for diff in diffs[:20]:
            pos1 = diff['sequence1_position'] or 'N/A'
            pos2 = diff['sequence2_position'] or 'N/A'
            click.echo(f"  位置 {diff['alignment_position']}: {diff['base1']} -> {diff['base2']} ({diff['type']})")
        if len(diffs) > 20:
            click.echo(f"  ... 还有 {len(diffs) - 20} 个差异")
    else:
        click.echo("未发现差异")
    click.echo("")

    if not no_heatmap:
        click.echo(result['ascii_heatmap'])

    if output:
        json_data = alignment.export_json(result, include_heatmap=True)
        with open(output, 'w', encoding='utf-8') as f:
            f.write(json_data)
        click.echo(f"JSON 数据已保存到: {output}")


@cli.command()
@click.argument('input_file', type=click.Path(exists=True))
@click.option('--output', '-o', default=None, help='输出文件路径')
@click.option('--window-size', '-w', default=10, help='突变密度窗口大小')
@click.option('--no-color', is_flag=True, help='禁用彩色输出')
def heatmap(input_file, output, window_size, no_color):
    """仅生成 ASCII 热力图"""
    records = FastaParser.parse(input_file)

    if len(records) < 2:
        click.echo("错误: FASTA 文件至少需要两条序列")
        return

    alignment = SequenceAlignment()
    result = alignment.align_and_analyze(
        records[0].sequence,
        records[1].sequence,
        window_size=window_size,
        show_colors=not no_color
    )

    heatmap_text = result['ascii_heatmap']
    click.echo(heatmap_text)

    if output:
        with open(output, 'w', encoding='utf-8') as f:
            f.write(heatmap_text)
        click.echo(f"热力图已保存到: {output}")


@cli.command()
@click.argument('input_file', type=click.Path(exists=True))
@click.option('--output', '-o', required=True, help='输出 JSON 文件路径')
@click.option('--window-size', '-w', default=10, help='突变密度窗口大小')
@click.option('--include-heatmap', is_flag=True, help='在 JSON 中包含 ASCII 热力图')
def export_json(input_file, output, window_size, include_heatmap):
    """导出序列比对差异 JSON 数据"""
    records = FastaParser.parse(input_file)

    if len(records) < 2:
        click.echo("错误: FASTA 文件至少需要两条序列")
        return

    alignment = SequenceAlignment()
    result = alignment.align_and_analyze(
        records[0].sequence,
        records[1].sequence,
        window_size=window_size,
        show_colors=False
    )

    json_data = alignment.export_json(result, include_heatmap=include_heatmap)

    with open(output, 'w', encoding='utf-8') as f:
        f.write(json_data)

    click.echo(f"JSON 数据已保存到: {output}")
    click.echo(f"  包含 {len(result['differences'])} 个差异记录")


if __name__ == '__main__':
    cli()
