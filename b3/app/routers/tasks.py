import json
import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.celery_app import celery_app
from app.config import settings
from app.database import get_db
from app.models import AsyncTask
from app.schemas import AsyncTaskStatusResponse
from app.services.storage import result_storage

router = APIRouter(tags=["tasks"])


def _get_task_from_db_or_celery(task_id: str, db: Session):
    task = db.query(AsyncTask).filter(AsyncTask.celery_task_id == task_id).first()
    if not task:
        celery_task = celery_app.AsyncResult(task_id)
        return {
            "id": 0,
            "celery_task_id": task_id,
            "task_type": "unknown",
            "status": celery_task.state,
            "raster_file_id": 0,
            "params": None,
            "result_file_path": None,
            "result_download_url": None,
            "error_message": str(celery_task.info) if celery_task.failed() else None,
            "created_at": None,
            "started_at": None,
            "completed_at": None,
        }
    return task


@router.get("/task/{task_id}", response_model=AsyncTaskStatusResponse)
def get_task_status(task_id: str, db: Session = Depends(get_db)):
    task = _get_task_from_db_or_celery(task_id, db)

    if isinstance(task, dict):
        return AsyncTaskStatusResponse(**task)

    params = None
    if task.params:
        try:
            params = json.loads(task.params)
        except Exception:
            params = None

    return AsyncTaskStatusResponse(
        id=task.id,
        celery_task_id=task.celery_task_id,
        task_type=task.task_type,
        status=task.status,
        raster_file_id=task.raster_file_id,
        params=params,
        result_file_path=task.result_file_path,
        result_download_url=task.result_download_url,
        error_message=task.error_message,
        created_at=task.created_at,
        started_at=task.started_at,
        completed_at=task.completed_at,
    )


@router.get("/download/{filename}")
def download_result(filename: str):
    file_path = result_storage.get_result_path(filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Result file not found")

    return FileResponse(
        file_path,
        media_type="application/json",
        filename=filename,
    )


@router.get("/tasks", response_model=list[AsyncTaskStatusResponse])
def list_tasks(raster_file_id: int = None, limit: int = 50, db: Session = Depends(get_db)):
    query = db.query(AsyncTask)
    if raster_file_id:
        query = query.filter(AsyncTask.raster_file_id == raster_file_id)
    tasks = query.order_by(AsyncTask.created_at.desc()).limit(limit).all()

    result = []
    for task in tasks:
        params = None
        if task.params:
            try:
                params = json.loads(task.params)
            except Exception:
                params = None
        result.append(
            AsyncTaskStatusResponse(
                id=task.id,
                celery_task_id=task.celery_task_id,
                task_type=task.task_type,
                status=task.status,
                raster_file_id=task.raster_file_id,
                params=params,
                result_file_path=task.result_file_path,
                result_download_url=task.result_download_url,
                error_message=task.error_message,
                created_at=task.created_at,
                started_at=task.started_at,
                completed_at=task.completed_at,
            )
        )
    return result
