import json

from fastapi import APIRouter, Depends, HTTPException
from shapely.wkt import loads as wkt_loads
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import RasterFile, ZonalStats
from app.schemas import AsyncTaskSubmitResponse, ZonalStatsRequest, ZonalStatsResponse
from app.tasks import zonal_stats_task

router = APIRouter(prefix="/zonal_stats", tags=["zonal"])


@router.post("", response_model=AsyncTaskSubmitResponse)
def compute_zonal_stats_async(request: ZonalStatsRequest, db: Session = Depends(get_db)):
    raster_file = db.query(RasterFile).filter(RasterFile.id == request.raster_file_id).first()
    if not raster_file:
        raise HTTPException(status_code=404, detail="Raster file not found")

    try:
        polygon = wkt_loads(request.polygon_wkt)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid WKT: {str(e)}")

    minx, miny, maxx, maxy = polygon.bounds

    if not (raster_file.min_x <= maxx and minx <= raster_file.max_x and
            raster_file.min_y <= maxy and miny <= raster_file.max_y):
        raise HTTPException(status_code=400, detail="Polygon does not intersect raster bounds")

    params = {
        "raster_file_id": request.raster_file_id,
        "polygon_wkt": request.polygon_wkt,
    }

    from app.models import AsyncTask

    task = AsyncTask(
        task_type="zonal_stats",
        status="PENDING",
        raster_file_id=request.raster_file_id,
        params=json.dumps(params),
    )
    db.add(task)
    db.flush()

    celery_task = zonal_stats_task.apply_async(
        args=[request.raster_file_id, request.polygon_wkt, params],
    )

    task.celery_task_id = celery_task.id
    db.commit()

    return AsyncTaskSubmitResponse(
        task_id=str(task.id),
        celery_task_id=celery_task.id,
        task_type="zonal_stats",
        status="PENDING",
        message="Task submitted. Use GET /task/{celery_task_id} to check status.",
        status_url=f"/task/{celery_task.id}",
    )


@router.get("/history", response_model=list[ZonalStatsResponse])
def get_zonal_stats_history(raster_file_id: int, db: Session = Depends(get_db)):
    stats = (
        db.query(ZonalStats)
        .filter(ZonalStats.raster_file_id == raster_file_id)
        .order_by(ZonalStats.created_at.desc())
        .all()
    )

    return [
        ZonalStatsResponse(
            stat_id=s.id,
            raster_file_id=s.raster_file_id,
            polygon_wkt=s.polygon_wkt,
            mean_value=s.mean_value,
            max_value=s.max_value,
            min_value=s.min_value,
            std_value=s.std_value,
            valid_pixels=s.valid_pixels,
            valid=True,
        )
        for s in stats
    ]
