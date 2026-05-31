from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.responses import JSONResponse, FileResponse
from typing import List, Optional, Dict, Any
import os
import tempfile
import gzip

from fasta_compressor.fasta_parser import FastaParser
from fasta_compressor.compressor import DNACustomCompressor, ParallelCompressor
from fasta_compressor.fuzzy_search import SequenceSearcher
from fasta_compressor.sequence_db import SequenceDatabase

app = FastAPI(title="FASTA 压缩与搜索 API", version="1.0.0")

DB_PATH = "fasta_api.db"


def get_db():
    return SequenceDatabase(DB_PATH)


@app.get("/")
async def root():
    return {"message": "FASTA 压缩与搜索 API 服务", "version": "1.0.0"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


@app.post("/upload")
async def upload_fasta(file: UploadFile = File(...), use_parallel: bool = True):
    """上传并压缩 FASTA 文件"""
    try:
        contents = await file.read()

        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.fasta') as temp_file:
            temp_file.write(contents.decode('utf-8'))
            temp_path = temp_file.name

        records = FastaParser.parse(temp_path)
        os.unlink(temp_path)

        db = get_db()
        if use_parallel:
            compressor = ParallelCompressor()
        else:
            compressor = DNACustomCompressor()

        results = []
        total_original = 0
        total_compressed = 0

        for record in records:
            original_size = len(record.sequence.encode('utf-8'))
            total_original += original_size

            if use_parallel and len(record.sequence) > 100000:
                compressed = compressor.compress_large_sequence(record.sequence, record.header)
            else:
                compressed = compressor.compress(record.sequence, record.header)

            compressed_size = len(compressed)
            total_compressed += compressed_size

            ratio = original_size / compressed_size if compressed_size > 0 else 0

            db.add_sequence(record.id, record.header, record.sequence, compressed, ratio)

            results.append({
                "seq_id": record.id,
                "length": len(record.sequence),
                "compression_ratio": round(ratio, 2)
            })

        overall_ratio = total_original / total_compressed if total_compressed > 0 else 0

        return {
            "message": f"成功处理 {len(records)} 条序列",
            "sequences": results,
            "overall_compression_ratio": round(overall_ratio, 2)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/sequences")
async def list_sequences():
    """列出所有已存储的序列"""
    db = get_db()
    seq_ids = db.get_all_sequence_ids()

    sequences = []
    for sid in seq_ids:
        seq_info = db.get_sequence(sid)
        if seq_info:
            header, compressed_data, length = seq_info
            sequences.append({
                "seq_id": sid,
                "header": header[:100],
                "length": length
            })

    return {"count": len(sequences), "sequences": sequences}


@app.get("/sequences/{seq_id}")
async def get_sequence(seq_id: str, decompress: bool = False):
    """获取指定序列信息"""
    db = get_db()
    seq_info = db.get_sequence(seq_id)

    if not seq_info:
        raise HTTPException(status_code=404, detail=f"序列 {seq_id} 未找到")

    header, compressed_data, length = seq_info

    result = {
        "seq_id": seq_id,
        "header": header,
        "length": length
    }

    if decompress:
        try:
            compressor = ParallelCompressor()
            _, sequence = compressor.decompress_large_sequence(compressed_data)
        except:
            compressor = DNACustomCompressor()
            _, sequence = compressor.decompress(compressed_data)
        result["sequence"] = sequence[:length]

    return result


@app.delete("/sequences/{seq_id}")
async def delete_sequence(seq_id: str):
    """删除指定序列"""
    db = get_db()
    if db.delete_sequence(seq_id):
        return {"message": f"序列 {seq_id} 已删除"}
    raise HTTPException(status_code=404, detail=f"序列 {seq_id} 未找到")


@app.get("/search")
async def search_sequences(
    pattern: str,
    max_mismatches: int = Query(3, ge=0, le=10),
    seq_id: Optional[str] = None
):
    """模糊匹配搜索序列"""
    db = get_db()

    if seq_id:
        seq_ids = [seq_id]
    else:
        seq_ids = db.get_all_sequence_ids()

    if not seq_ids:
        return {"message": "数据库中没有序列", "results": {}}

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

    formatted_results = {}
    total_hits = 0

    for sid, hits in results.items():
        total_hits += len(hits)
        formatted_results[sid] = [
            {
                "position": pos,
                "mismatches": mism,
                "matched": match
            }
            for pos, mism, match in hits
        ]

    return {
        "pattern": pattern,
        "max_mismatches": max_mismatches,
        "total_hits": total_hits,
        "results": formatted_results
    }


@app.get("/stats")
async def get_statistics():
    """获取数据库统计信息"""
    db = get_db()
    stats = db.get_statistics()
    return stats


@app.post("/compare")
async def compare_compression(file: UploadFile = File(...)):
    """比较自定义压缩和 gzip 的压缩率"""
    try:
        contents = await file.read()

        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.fasta') as temp_file:
            temp_file.write(contents.decode('utf-8'))
            temp_path = temp_file.name

        records = FastaParser.parse(temp_path)
        os.unlink(temp_path)

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

        better = "custom" if custom_ratio > gzip_ratio else "gzip"
        improvement = abs(custom_ratio - gzip_ratio) / min(custom_ratio, gzip_ratio) * 100

        return {
            "original_size_kb": round(original_size / 1024, 2),
            "custom_compression": {
                "compressed_size_kb": round(custom_size / 1024, 2),
                "ratio": round(custom_ratio, 2)
            },
            "gzip_compression": {
                "compressed_size_kb": round(gzip_size / 1024, 2),
                "ratio": round(gzip_ratio, 2)
            },
            "better_compression": better,
            "improvement_percent": round(improvement, 1)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
