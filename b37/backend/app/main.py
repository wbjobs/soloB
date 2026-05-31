import logging
from datetime import datetime

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.config import Settings, get_settings
from app.schemas import (
    DeleteDocumentResponse,
    DocumentInfo,
    DocumentListResponse,
    HealthResponse,
    QueryRequest,
    QueryResponse,
    RetrievedDocument,
    UploadResponse
)
from app.services import DocumentProcessor, DocumentRegistry, LLMService, VectorStoreService
from app.services.document_processor import PDFPLUMBER_AVAILABLE

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def create_app(settings: Settings = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=settings.version,
        description="A PDF document Q&A system powered by LangChain and Vector Databases"
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    document_processor = DocumentProcessor(settings)
    vector_store = VectorStoreService(settings)
    document_registry = DocumentRegistry(settings)
    llm_service = LLMService(settings)

    @app.get("/health", response_model=HealthResponse)
    async def health():
        return HealthResponse(
            status="healthy",
            version=settings.version,
            document_count=vector_store.get_document_count(),
            embedding_model=settings.embedding_model_name,
            pdfplumber_available=PDFPLUMBER_AVAILABLE,
            total_documents=document_registry.get_document_count()
        )

    @app.get("/documents", response_model=DocumentListResponse)
    async def list_documents():
        logger.info("Listing all documents")
        records = document_registry.list_documents()
        
        documents = [
            DocumentInfo(
                document_id=record.document_id,
                filename=record.filename,
                total_chunks=record.total_chunks,
                total_pages=record.total_pages,
                total_tables=record.total_tables,
                uploaded_at=datetime.fromisoformat(record.uploaded_at),
                file_size_kb=record.file_size_kb
            )
            for record in records
        ]
        
        return DocumentListResponse(
            documents=documents,
            total=len(documents)
        )

    @app.post("/upload", response_model=UploadResponse)
    async def upload_document(file: UploadFile = File(...)):
        logger.info(f"Received upload request for file: {file.filename}")

        if not file.filename.lower().endswith('.pdf'):
            raise HTTPException(
                status_code=400,
                detail="Only PDF files are allowed"
            )

        file_bytes = await file.read()
        file_size_mb = len(file_bytes) / (1024 * 1024)
        
        if file_size_mb > settings.max_file_size_mb:
            raise HTTPException(
                status_code=400,
                detail=f"File too large. Maximum allowed: {settings.max_file_size_mb}MB"
            )

        try:
            documents = document_processor.process_pdf(file_bytes, file.filename)
            
            if not documents:
                return UploadResponse(
                    success=False,
                    message="No text could be extracted from the PDF",
                    filename=file.filename,
                    total_chunks=0
                )

            vector_store.add_documents(documents)

            document_id = documents[0].metadata.get("document_id") if documents else None
            total_pages = documents[0].metadata.get("total_pages") if documents else None
            total_tables = documents[0].metadata.get("total_tables") if documents else None
            extractor = documents[0].metadata.get("extractor") if documents else None
            table_chunks = sum(1 for d in documents if d.metadata.get("is_table_chunk", False))

            if document_id:
                document_registry.register_document(
                    document_id=document_id,
                    filename=file.filename,
                    total_chunks=len(documents),
                    total_pages=total_pages,
                    total_tables=total_tables,
                    file_size_bytes=len(file_bytes)
                )

            table_msg = f" ({total_tables} tables detected)" if total_tables and total_tables > 0 else ""
            
            return UploadResponse(
                success=True,
                message=f"Successfully processed {file.filename}{table_msg}",
                filename=file.filename,
                total_chunks=len(documents),
                document_id=document_id,
                total_pages=total_pages,
                total_tables=total_tables,
                table_chunks=table_chunks,
                extractor=extractor
            )

        except Exception as e:
            logger.error(f"Error processing document: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to process document: {str(e)}"
            )

    @app.delete("/documents/{document_id}", response_model=DeleteDocumentResponse)
    async def delete_document(document_id: str):
        logger.info(f"Deleting document: {document_id[:8]}...")
        
        if not document_registry.document_exists(document_id):
            raise HTTPException(
                status_code=404,
                detail=f"Document not found: {document_id}"
            )
        
        try:
            deleted_chunks = vector_store.delete_by_document_id(document_id)
            document_registry.unregister_document(document_id)
            
            return DeleteDocumentResponse(
                success=True,
                message=f"Document deleted successfully",
                deleted_chunks=deleted_chunks
            )
        except Exception as e:
            logger.error(f"Error deleting document: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to delete document: {str(e)}"
            )

    @app.post("/query", response_model=QueryResponse)
    async def query(request: QueryRequest):
        doc_filter_msg = f" in {len(request.document_ids)} document(s)" if request.document_ids else ""
        logger.info(f"Received query{doc_filter_msg}: {request.question}")

        try:
            top_k = request.top_k or settings.top_k_retrieval
            retrieved_docs = vector_store.similarity_search_with_score(
                request.question,
                k=top_k,
                document_ids=request.document_ids
            )

            documents = [doc for doc, _ in retrieved_docs]
            scores = [score for _, score in retrieved_docs]

            answer = llm_service.generate_answer(
                question=request.question,
                retrieved_documents=documents
            )

            retrieved_documents = [
                RetrievedDocument(
                    content=doc.page_content[:500] + "..." if len(doc.page_content) > 500 else doc.page_content,
                    source=doc.metadata.get("source", "Unknown"),
                    chunk_index=doc.metadata.get("chunk_index", i),
                    score=scores[i],
                    is_table_chunk=doc.metadata.get("is_table_chunk", False),
                    document_id=doc.metadata.get("document_id")
                )
                for i, doc in enumerate(documents)
            ]

            return QueryResponse(
                answer=answer,
                retrieved_documents=retrieved_documents,
                selected_document_ids=request.document_ids
            )

        except Exception as e:
            logger.error(f"Error processing query: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to process query: {str(e)}"
            )

    @app.post("/query/stream")
    async def query_stream(request: QueryRequest):
        doc_filter_msg = f" in {len(request.document_ids)} document(s)" if request.document_ids else ""
        logger.info(f"Received streaming query{doc_filter_msg}: {request.question}")

        try:
            top_k = request.top_k or settings.top_k_retrieval
            retrieved_docs = vector_store.similarity_search(
                request.question,
                k=top_k,
                document_ids=request.document_ids
            )

            if not retrieved_docs:
                return StreamingResponse(
                    iter(["I don't have enough information to answer this question."]),
                    media_type="text/plain"
                )

            return StreamingResponse(
                llm_service.generate_answer_stream(
                    question=request.question,
                    retrieved_documents=retrieved_docs
                ),
                media_type="text/plain"
            )

        except Exception as e:
            logger.error(f"Error processing streaming query: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to process query: {str(e)}"
            )

    @app.delete("/documents")
    async def clear_documents():
        logger.info("Clearing all documents from vector store")
        try:
            vector_store.clear_collection()
            document_registry.clear_all()
            return {"message": "All documents have been cleared"}
        except Exception as e:
            logger.error(f"Error clearing documents: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to clear documents: {str(e)}"
            )

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
