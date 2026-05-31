from sqlalchemy.orm import Session
from ..models.models import AlignmentTask
from ..schemas.schemas import AlignmentTaskCreate
import uuid


def create_task(db: Session, task: AlignmentTaskCreate) -> AlignmentTask:
    db_task = AlignmentTask(
        id=str(uuid.uuid4()),
        task_id=task.task_id,
        sequence_a_length=task.sequence_a_length,
        sequence_b_length=task.sequence_b_length,
        final_score=task.final_score,
        file_name_a=task.file_name_a,
        file_name_b=task.file_name_b,
        aligned_a=task.aligned_a,
        aligned_b=task.aligned_b,
        alignment_string=task.alignment_string
    )
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    return db_task


def get_task(db: Session, task_id: str) -> AlignmentTask:
    return db.query(AlignmentTask).filter(AlignmentTask.task_id == task_id).first()


def get_all_tasks(db: Session, skip: int = 0, limit: int = 100) -> list[AlignmentTask]:
    return db.query(AlignmentTask).order_by(AlignmentTask.created_at.desc()).offset(skip).limit(limit).all()
