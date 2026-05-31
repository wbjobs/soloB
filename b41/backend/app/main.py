from fastapi import FastAPI, UploadFile, File, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from .db.database import engine, Base, get_db
from .schemas.schemas import (
    AlignmentResult,
    AlignmentTaskCreate,
    AlignmentTaskResponse,
    UploadResponse
)
from .crud import crud
from .alignment.service import get_alignment_service
import uuid

Base.metadata.create_all(bind=engine)

app = FastAPI(title="DNA Sequence Alignment Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def parse_fasta(content: bytes) -> str:
    text = content.decode('utf-8')
    lines = text.split('\n')
    sequence = []
    for line in lines:
        line = line.strip()
        if line and not line.startswith('>'):
            sequence.append(line.upper())
    return ''.join(sequence)


@app.post("/upload", response_model=UploadResponse)
async def upload_files(
    file1: UploadFile = File(...),
    file2: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    if not file1.filename or not file2.filename:
        raise HTTPException(status_code=400, detail="File names are required")

    content1 = await file1.read()
    content2 = await file2.read()

    seq_a = parse_fasta(content1)
    seq_b = parse_fasta(content2)

    if not seq_a or not seq_b:
        raise HTTPException(status_code=400, detail="Invalid FASTA files")

    try:
        alignment_service = get_alignment_service()
        result = alignment_service.align(seq_a, seq_b)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Alignment service error: {str(e)}")

    task_id = str(uuid.uuid4())

    task_create = AlignmentTaskCreate(
        task_id=task_id,
        sequence_a_length=len(seq_a),
        sequence_b_length=len(seq_b),
        final_score=result.score,
        file_name_a=file1.filename,
        file_name_b=file2.filename,
        aligned_a=result.aligned_a,
        aligned_b=result.aligned_b,
        alignment_string=result.alignment_string
    )

    try:
        crud.create_task(db, task_create)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    return UploadResponse(
        task_id=task_id,
        result=result
    )


@app.get("/tasks/{task_id}", response_model=AlignmentTaskResponse)
def get_task(task_id: str, db: Session = Depends(get_db)):
    task = crud.get_task(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.get("/tasks", response_model=list[AlignmentTaskResponse])
def list_tasks(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return crud.get_all_tasks(db, skip=skip, limit=limit)


@app.get("/health")
def health_check():
    return {"status": "healthy"}
