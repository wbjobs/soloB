from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


class ProgressUpdate(BaseModel):
    step: int
    total: int
    message: str


class AlignmentResult(BaseModel):
    aligned_a: str
    aligned_b: str
    alignment_string: str
    score: int
    progress: List[ProgressUpdate]


class AlignmentTaskBase(BaseModel):
    task_id: str
    sequence_a_length: int
    sequence_b_length: int
    final_score: int
    file_name_a: str
    file_name_b: str


class AlignmentTaskCreate(AlignmentTaskBase):
    aligned_a: str
    aligned_b: str
    alignment_string: str


class AlignmentTaskResponse(AlignmentTaskBase):
    id: str
    created_at: datetime
    aligned_a: str
    aligned_b: str
    alignment_string: str

    class Config:
        from_attributes = True


class UploadResponse(BaseModel):
    task_id: str
    result: AlignmentResult
