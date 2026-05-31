from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class RasterFileResponse(BaseModel):
    id: int
    filename: str
    file_path: str
    file_type: str
    variable: Optional[str] = None
    min_x: Optional[float] = None
    min_y: Optional[float] = None
    max_x: Optional[float] = None
    max_y: Optional[float] = None
    crs: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    num_bands: Optional[int] = None
    has_time: int = 0
    time_units: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class UploadResponse(BaseModel):
    message: str
    raster_file: RasterFileResponse


class ExtractPointRequest(BaseModel):
    raster_file_id: int
    longitude: float
    latitude: float


class ExtractPointResponse(BaseModel):
    extraction_id: int
    raster_file_id: int
    longitude: float
    latitude: float
    values: List[float]
    time_steps: Optional[List[float]] = None
    valid: bool


class ZonalStatsRequest(BaseModel):
    raster_file_id: int
    polygon_wkt: str


class ZonalStatsResponse(BaseModel):
    stat_id: int
    raster_file_id: int
    polygon_wkt: str
    mean_value: Optional[float] = None
    max_value: Optional[float] = None
    min_value: Optional[float] = None
    std_value: Optional[float] = None
    valid_pixels: Optional[int] = None
    valid: bool


class AsyncTaskSubmitResponse(BaseModel):
    task_id: str
    celery_task_id: str
    task_type: str
    status: str
    message: str
    status_url: str


class AsyncTaskStatusResponse(BaseModel):
    id: int
    celery_task_id: str
    task_type: str
    status: str
    raster_file_id: int
    params: Optional[Dict[str, Any]] = None
    result_file_path: Optional[str] = None
    result_download_url: Optional[str] = None
    error_message: Optional[str] = None
    created_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class NDVIRequest(BaseModel):
    raster_file_id: int
    nir_band: int = 1
    red_band: int = 0


class AnomalyDetectionRequest(BaseModel):
    raster_file_id: int
    method: str = "rolling"
    window_size: int = 5
    sigma_threshold: float = 2.0
