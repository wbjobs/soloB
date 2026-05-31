from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import pyarrow as pa
import json
from ..core.query_engine import QueryEngine
from ..core.arrow_handler import ArrowHandler


class QueryRequest(BaseModel):
    sql: str
    use_cache: bool = True
    batch_size: Optional[int] = None


class ValidateRequest(BaseModel):
    sql: str


app = FastAPI(title="Federated Query Gateway API", version="1.0.0")

query_engine: Optional[QueryEngine] = None
arrow_handler = ArrowHandler()


@app.on_event("startup")
async def startup_event():
    global query_engine
    query_engine = QueryEngine()


@app.on_event("shutdown")
async def shutdown_event():
    if query_engine:
        query_engine.close()


@app.post("/api/v1/query")
async def execute_query(request: QueryRequest):
    try:
        result = query_engine.execute(request.sql, use_cache=request.use_cache)
        data = arrow_handler.from_arrow_table(result)
        
        return JSONResponse(content={
            "success": True,
            "data": data,
            "row_count": len(data),
            "schema": str(result.schema)
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/query/stream")
async def execute_query_stream(request: QueryRequest):
    try:
        batch_size = request.batch_size or 10000
        
        async def generate():
            for batch in query_engine.execute_streaming(request.sql, batch_size=batch_size):
                batch_data = batch.to_pylist()
                yield json.dumps({
                    "batch_index": 0,
                    "row_count": len(batch_data),
                    "data": batch_data
                }) + "\n"
        
        return StreamingResponse(generate(), media_type="application/jsonl")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/validate")
async def validate_query(request: ValidateRequest):
    try:
        is_valid, errors = query_engine.validate_query(request.sql)
        return JSONResponse(content={
            "valid": is_valid,
            "errors": errors
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/tables")
async def get_tables():
    try:
        tables = query_engine.get_all_tables()
        return JSONResponse(content={
            "tables": tables
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/schema/{table_name}")
async def get_schema(table_name: str):
    try:
        schema = query_engine.get_table_schema(table_name)
        if schema is None:
            raise HTTPException(status_code=404, detail=f"Table {table_name} not found")
        
        return JSONResponse(content={
            "table": table_name,
            "schema": str(schema),
            "fields": [{"name": f.name, "type": str(f.type)} for f in schema]
        })
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/cache/stats")
async def get_cache_stats():
    try:
        stats = query_engine.get_cache_stats()
        return JSONResponse(content={
            "cache_enabled": stats is not None,
            "stats": stats or {}
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/cache/invalidate")
async def invalidate_cache(sql: Optional[str] = Query(None)):
    try:
        query_engine.invalidate_cache(sql)
        return JSONResponse(content={
            "success": True,
            "message": "Cache invalidated successfully"
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/health")
async def health_check():
    return JSONResponse(content={
        "status": "healthy",
        "service": "Federated Query Gateway"
    })
