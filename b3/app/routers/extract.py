import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import PointExtraction, RasterFile
from app.schemas import (
    AsyncTaskSubmitResponse,
    ExtractPointRequest,
    ExtractPointResponse,
)
from app.tasks import extract_point_task

router = APIRouter(prefix="/extract_point", tags=["extract"])


@router.post("", response_model=AsyncTaskSubmitResponse)
def extract_point_async(request: ExtractPointRequest, db: Session = Depends(get_db)):
    raster_file = db.query(RasterFile).filter(RasterFile.id == request.raster_file_id).first()
    if not raster_file:
        raise HTTPException(status_code=404, detail="Raster file not found")

    if not (raster_file.min_x <= request.longitude <= raster_file.max_x and
            raster_file.min_y <= request.latitude <= raster_file.max_y):
        raise HTTPException(status_code=400, detail="Point outside raster bounds")

    params = {
        "raster_file_id": request.raster_file_id,
        "longitude": request.longitude,
        "latitude": request.latitude,
    }

    from app.models import AsyncTask

    task = AsyncTask(
        task_type="extract_point",
        status="PENDING",
        raster_file_id=request.raster_file_id,
        params=json.dumps(params),
    )
    db.add(task)
    db.flush()

    celery_task = extract_point_task.apply_async(
        args=[request.raster_file_id, request.longitude, request.latitude, params],
    )

    task.celery_task_id = celery_task.id
    db.commit()

    return AsyncTaskSubmitResponse(
        task_id=str(task.id),
        celery_task_id=celery_task.id,
        task_type="extract_point",
        status="PENDING",
        message="Task submitted. Use GET /task/{celery_task_id} to check status.",
        status_url=f"/task/{celery_task.id}",
    )


@router.get("/history", response_model=list[ExtractPointResponse])
def get_extraction_history(raster_file_id: int, db: Session = Depends(get_db)):
    extractions = (
        db.query(PointExtraction)
        .filter(PointExtraction.raster_file_id == raster_file_id)
        .order_by(PointExtraction.created_at.desc())
        .all()
    )

    return [
        ExtractPointResponse(
            extraction_id=e.id,
            raster_file_id=e.raster_file_id,
            longitude=e.longitude,
            latitude=e.latitude,
            values=json.loads(e.values) if e.values else [],
            time_steps=json.loads(e.time_steps) if e.time_steps else None,
            valid=True,
        )
        for e in extractions
    ]
