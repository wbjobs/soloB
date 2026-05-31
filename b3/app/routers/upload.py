import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import RasterFile
from app.schemas import RasterFileResponse, UploadResponse
from app.services.raster_parser import get_parser

router = APIRouter(prefix="/upload", tags=["upload"])


@router.post("", response_model=UploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    variable: Optional[str] = None,
    db: Session = Depends(get_db),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".tif", ".tiff", ".nc", ".nc4"]:
        raise HTTPException(status_code=400, detail=f"Unsupported file format: {ext}")

    storage_dir = settings.storage_path
    os.makedirs(storage_dir, exist_ok=True)

    file_id = str(uuid.uuid4())
    saved_filename = f"{file_id}{ext}"
    file_path = os.path.join(storage_dir, saved_filename)

    with open(file_path, "wb") as buffer:
        content = await file.read()
        buffer.write(content)

    try:
        parser = get_parser(file_path, variable)
        metadata = parser.get_metadata()
        min_x, min_y, max_x, max_y = parser.get_bounds()
        parser.close()
    except Exception as e:
        os.remove(file_path)
        raise HTTPException(status_code=400, detail=f"Failed to parse raster: {str(e)}")

    raster_file = RasterFile(
        filename=file.filename,
        file_path=file_path,
        file_type="geotiff" if ext in [".tif", ".tiff"] else "netcdf",
        variable=metadata.get("variable"),
        min_x=min_x,
        min_y=min_y,
        max_x=max_x,
        max_y=max_y,
        crs=metadata.get("crs"),
        width=metadata.get("width"),
        height=metadata.get("height"),
        num_bands=metadata.get("num_bands"),
        has_time=1 if metadata.get("has_time") else 0,
        time_units=metadata.get("time_units"),
    )

    db.add(raster_file)
    db.commit()
    db.refresh(raster_file)

    return UploadResponse(message="File uploaded successfully", raster_file=RasterFileResponse.from_orm(raster_file))


@router.get("/files", response_model=list[RasterFileResponse])
def list_files(db: Session = Depends(get_db)):
    files = db.query(RasterFile).order_by(RasterFile.created_at.desc()).all()
    return [RasterFileResponse.from_orm(f) for f in files]


@router.get("/files/{file_id}", response_model=RasterFileResponse)
def get_file(file_id: int, db: Session = Depends(get_db)):
    file = db.query(RasterFile).filter(RasterFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    return RasterFileResponse.from_orm(file)
