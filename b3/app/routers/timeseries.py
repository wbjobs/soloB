import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AsyncTask, RasterFile
from app.schemas import (
    AnomalyDetectionRequest,
    AsyncTaskSubmitResponse,
    NDVIRequest,
)
from app.tasks import anomaly_detection_task, ndvi_task

router = APIRouter(prefix="/timeseries", tags=["timeseries"])


@router.post("/ndvi", response_model=AsyncTaskSubmitResponse)
def compute_ndvi(request: NDVIRequest, db: Session = Depends(get_db)):
    raster_file = db.query(RasterFile).filter(RasterFile.id == request.raster_file_id).first()
    if not raster_file:
        raise HTTPException(status_code=404, detail="Raster file not found")

    if request.nir_band == request.red_band:
        raise HTTPException(status_code=400, detail="NIR and Red bands must be different")

    params = {
        "raster_file_id": request.raster_file_id,
        "nir_band": request.nir_band,
        "red_band": request.red_band,
    }

    task = AsyncTask(
        task_type="ndvi",
        status="PENDING",
        raster_file_id=request.raster_file_id,
        params=json.dumps(params),
    )
    db.add(task)
    db.flush()

    celery_task = ndvi_task.apply_async(
        args=[request.raster_file_id, request.nir_band, request.red_band, params],
    )

    task.celery_task_id = celery_task.id
    db.commit()

    return AsyncTaskSubmitResponse(
        task_id=str(task.id),
        celery_task_id=celery_task.id,
        task_type="ndvi",
        status="PENDING",
        message="NDVI task submitted. Use GET /task/{celery_task_id} to check status.",
        status_url=f"/task/{celery_task.id}",
    )


@router.post("/anomaly_detection", response_model=AsyncTaskSubmitResponse)
def detect_anomalies(request: AnomalyDetectionRequest, db: Session = Depends(get_db)):
    raster_file = db.query(RasterFile).filter(RasterFile.id == request.raster_file_id).first()
    if not raster_file:
        raise HTTPException(status_code=404, detail="Raster file not found")

    if request.method not in ["rolling", "global"]:
        raise HTTPException(status_code=400, detail="Method must be 'rolling' or 'global'")

    if request.method == "rolling" and request.window_size < 3:
        raise HTTPException(status_code=400, detail="Window size must be >= 3 for rolling method")

    if request.sigma_threshold <= 0:
        raise HTTPException(status_code=400, detail="Sigma threshold must be > 0")

    params = {
        "raster_file_id": request.raster_file_id,
        "method": request.method,
        "window_size": request.window_size,
        "sigma_threshold": request.sigma_threshold,
    }

    task = AsyncTask(
        task_type="anomaly_detection",
        status="PENDING",
        raster_file_id=request.raster_file_id,
        params=json.dumps(params),
    )
    db.add(task)
    db.flush()

    celery_task = anomaly_detection_task.apply_async(
        args=[
            request.raster_file_id,
            request.method,
            request.window_size,
            request.sigma_threshold,
            params,
        ],
    )

    task.celery_task_id = celery_task.id
    db.commit()

    return AsyncTaskSubmitResponse(
        task_id=str(task.id),
        celery_task_id=celery_task.id,
        task_type="anomaly_detection",
        status="PENDING",
        message="Anomaly detection task submitted. Use GET /task/{celery_task_id} to check status.",
        status_url=f"/task/{celery_task.id}",
    )
