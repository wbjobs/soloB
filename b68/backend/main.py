import os
import shutil
from fastapi import FastAPI, File, UploadFile, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pathlib import Path
from typing import List, Optional
import json

from config import settings
from rag_pipeline import RAGPipeline
from schemas import (
    QueryRequest,
    QueryResponse,
    DocumentUploadResponse,
    CollectionStatsResponse,
)

app = FastAPI(
    title="企业内部知识问答机器人 API",
    description="基于 RAG 架构的企业知识问答系统",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

rag_pipeline: Optional[RAGPipeline] = None
UPLOAD_DIR = Path("./uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

def get_rag_pipeline() -> RAGPipeline:
    global rag_pipeline
    if rag_pipeline is None:
        rag_pipeline = RAGPipeline()
    return rag_pipeline

@app.get("/")
async def root():
    return {"message": "企业内部知识问答机器人 API 正在运行", "version": "1.0.0"}

@app.get(f"{settings.API_PREFIX}/health")
async def health_check():
    return {"status": "healthy"}

@app.post(f"{settings.API_PREFIX}/chat", response_model=QueryResponse)
async def chat(
    request: QueryRequest,
    rag: RAGPipeline = Depends(get_rag_pipeline),
):
    result = rag.answer(request.question)
    return QueryResponse(**result)

async def stream_response_generator(
    query: str,
    rag: RAGPipeline,
    include_citations: bool = True,
):
    retrieved_docs, debug_info = rag.retrieve_enhanced(query)
    
    if not retrieved_docs:
        yield json.dumps({
            "type": "content",
            "content": "抱歉，我在知识库中没有找到与您的问题相关的信息。"
        }) + "\n"
        yield json.dumps({
            "type": "done",
            "citations": [],
            "answer_with_citations": "抱歉，我在知识库中没有找到与您的问题相关的信息。"
        }) + "\n"
        return
    
    context = rag._format_docs_with_labels(retrieved_docs)
    
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_core.output_parsers import StrOutputParser
    from rag_pipeline import RAG_PROMPT_TEMPLATE
    
    prompt = ChatPromptTemplate.from_template(RAG_PROMPT_TEMPLATE)
    chain = prompt | rag.llm | StrOutputParser()
    
    answer_with_citations = ""
    
    yield json.dumps({"type": "start", "content": ""}) + "\n"
    
    async for chunk in chain.astream({
        "context": context,
        "question": query,
    }):
        answer_with_citations += chunk
        answer = rag._remove_citation_markers(chunk)
        if answer:
            yield json.dumps({"type": "content", "content": answer}) + "\n"
    
    citations = rag._build_citation_sources(retrieved_docs, answer_with_citations) if include_citations else []
    
    yield json.dumps({
        "type": "done",
        "content": "",
        "citations": citations,
        "answer_with_citations": answer_with_citations,
        "context": context,
        "debug_info": debug_info,
    }) + "\n"

@app.post(f"{settings.API_PREFIX}/chat/stream")
async def chat_stream(
    request: QueryRequest,
    rag: RAGPipeline = Depends(get_rag_pipeline),
):
    return StreamingResponse(
        stream_response_generator(request.question, rag, request.include_citations),
        media_type="text/event-stream",
    )

@app.post(f"{settings.API_PREFIX}/documents/upload", response_model=DocumentUploadResponse)
async def upload_documents(
    files: List[UploadFile] = File(...),
    rag: RAGPipeline = Depends(get_rag_pipeline),
):
    total_count = 0
    saved_files = []

    try:
        for file in files:
            file_path = UPLOAD_DIR / file.filename
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            saved_files.append(file_path)

        for file_path in saved_files:
            try:
                count = rag.add_from_file(str(file_path))
                total_count += count
            except Exception as e:
                print(f"Error processing file {file_path}: {e}")
                continue

        return DocumentUploadResponse(
            success=True,
            message=f"成功上传并索引 {len(saved_files)} 个文件，共 {total_count} 个文档块",
            document_count=total_count,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"文件上传失败: {str(e)}")

@app.post(f"{settings.API_PREFIX}/documents/upload/directory")
async def upload_from_directory(
    directory_path: str,
    rag: RAGPipeline = Depends(get_rag_pipeline),
):
    try:
        path = Path(directory_path)
        if not path.exists() or not path.is_dir():
            raise HTTPException(status_code=400, detail=f"目录不存在: {directory_path}")
        
        count = rag.add_from_directory(str(path))
        return DocumentUploadResponse(
            success=True,
            message=f"成功从目录加载并索引文档，共 {count} 个文档块",
            document_count=count,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"目录加载失败: {str(e)}")

@app.get(f"{settings.API_PREFIX}/stats", response_model=CollectionStatsResponse)
async def get_stats(
    rag: RAGPipeline = Depends(get_rag_pipeline),
):
    stats = rag.get_collection_stats()
    return CollectionStatsResponse(**stats)

@app.delete(f"{settings.API_PREFIX}/collection")
async def clear_collection(
    rag: RAGPipeline = Depends(get_rag_pipeline),
):
    try:
        rag.clear_collection()
        return {"success": True, "message": "知识库已清空"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"清空知识库失败: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
