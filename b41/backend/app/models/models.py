from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.sql import func
from ..db.database import Base


class AlignmentTask(Base):
    __tablename__ = "alignment_tasks"

    id = Column(String, primary_key=True, index=True)
    task_id = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    sequence_a_length = Column(Integer, nullable=False)
    sequence_b_length = Column(Integer, nullable=False)
    final_score = Column(Integer, nullable=False)
    file_name_a = Column(String, nullable=False)
    file_name_b = Column(String, nullable=False)
    aligned_a = Column(String, nullable=False)
    aligned_b = Column(String, nullable=False)
    alignment_string = Column(String, nullable=False)
