from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class RasterFile(Base):
    __tablename__ = "raster_files"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    file_type = Column(String, nullable=False)
    variable = Column(String)
    min_x = Column(Float)
    min_y = Column(Float)
    max_x = Column(Float)
    max_y = Column(Float)
    crs = Column(String)
    width = Column(Integer)
    height = Column(Integer)
    num_bands = Column(Integer)
    has_time = Column(Integer, default=0)
    time_units = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

    extractions = relationship("PointExtraction", back_populates="raster_file")
    zonal_stats = relationship("ZonalStats", back_populates="raster_file")


class PointExtraction(Base):
    __tablename__ = "point_extractions"

    id = Column(Integer, primary_key=True, index=True)
    raster_file_id = Column(Integer, ForeignKey("raster_files.id"), nullable=False)
    longitude = Column(Float, nullable=False)
    latitude = Column(Float, nullable=False)
    point_geom = Column(Geometry("POINT", srid=4326))
    values = Column(String)
    time_steps = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

    raster_file = relationship("RasterFile", back_populates="extractions")


class ZonalStats(Base):
    __tablename__ = "zonal_stats"

    id = Column(Integer, primary_key=True, index=True)
    raster_file_id = Column(Integer, ForeignKey("raster_files.id"), nullable=False)
    polygon_wkt = Column(String, nullable=False)
    polygon_geom = Column(Geometry("POLYGON", srid=4326))
    mean_value = Column(Float)
    max_value = Column(Float)
    min_value = Column(Float)
    std_value = Column(Float)
    valid_pixels = Column(Integer)
    created_at = Column(DateTime, default=datetime.utcnow)

    raster_file = relationship("RasterFile", back_populates="zonal_stats")


class AsyncTask(Base):
    __tablename__ = "async_tasks"

    id = Column(Integer, primary_key=True, index=True)
    celery_task_id = Column(String, unique=True, index=True)
    task_type = Column(String, nullable=False)
    status = Column(String, default="PENDING")
    raster_file_id = Column(Integer, nullable=False)
    params = Column(Text)
    result_file_path = Column(String)
    result_download_url = Column(String)
    error_message = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    started_at = Column(DateTime)
    completed_at = Column(DateTime)

