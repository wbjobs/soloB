import json
from datetime import datetime

import numpy as np
from app.celery_app import celery_app
from app.config import settings
from app.database import SessionLocal
from app.models import AsyncTask, PointExtraction, ZonalStats
from app.services.output import raster_output
from app.services.raster_parser import get_parser
from app.services.storage import result_storage
from app.services.timeseries import TimeSeriesAnalyzer
from geoalchemy2.shape import from_shape
from shapely.geometry import Point, Polygon
from shapely.wkt import loads as wkt_loads


def _update_task_status(celery_task_id: str, status: str, **kwargs):
    db = SessionLocal()
    try:
        task = db.query(AsyncTask).filter(AsyncTask.celery_task_id == celery_task_id).first()
        if task:
            task.status = status
            if status == "STARTED":
                task.started_at = datetime.utcnow()
            elif status in ("SUCCESS", "FAILURE"):
                task.completed_at = datetime.utcnow()
            for key, value in kwargs.items():
                setattr(task, key, value)
            db.commit()
    finally:
        db.close()


@celery_app.task(bind=True, name="extract_point_task")
def extract_point_task(self, raster_file_id: int, longitude: float, latitude: float, params: dict):
    celery_task_id = self.request.id
    _update_task_status(celery_task_id, "STARTED")

    db = SessionLocal()
    try:
        from app.models import RasterFile

        raster_file = db.query(RasterFile).filter(RasterFile.id == raster_file_id).first()
        if not raster_file:
            raise ValueError("Raster file not found")

        parser = get_parser(raster_file.file_path, raster_file.variable)
        result = parser.extract_point(longitude, latitude)
        parser.close()

        if not result.get("valid"):
            raise ValueError("Point extraction failed")

        point_geom = from_shape(Point(longitude, latitude), srid=4326)
        extraction = PointExtraction(
            raster_file_id=raster_file_id,
            longitude=longitude,
            latitude=latitude,
            point_geom=point_geom,
            values=json.dumps(result.get("values", [])),
            time_steps=json.dumps(result.get("time_steps", [])),
        )
        db.add(extraction)
        db.commit()
        db.refresh(extraction)

        output = {
            "task_type": "extract_point",
            "raster_file_id": raster_file_id,
            "longitude": longitude,
            "latitude": latitude,
            "values": result.get("values", []),
            "time_steps": result.get("time_steps", []),
            "extraction_id": extraction.id,
            "valid": True,
        }

        file_path, download_url = result_storage.save_result_json(output, "extract")

        _update_task_status(
            celery_task_id,
            "SUCCESS",
            result_file_path=file_path,
            result_download_url=download_url,
        )

        return {"status": "SUCCESS", "result_url": download_url, "data": output}

    except Exception as e:
        _update_task_status(celery_task_id, "FAILURE", error_message=str(e))
        return {"status": "FAILURE", "error": str(e)}
    finally:
        db.close()


@celery_app.task(bind=True, name="zonal_stats_task")
def zonal_stats_task(self, raster_file_id: int, polygon_wkt: str, params: dict):
    celery_task_id = self.request.id
    _update_task_status(celery_task_id, "STARTED")

    db = SessionLocal()
    try:
        from app.models import RasterFile

        raster_file = db.query(RasterFile).filter(RasterFile.id == raster_file_id).first()
        if not raster_file:
            raise ValueError("Raster file not found")

        polygon = wkt_loads(polygon_wkt)
        if not isinstance(polygon, Polygon):
            raise ValueError("Geometry must be a Polygon")

        polygon_coords = list(polygon.exterior.coords)

        parser = get_parser(raster_file.file_path, raster_file.variable)
        result = parser.compute_zonal_stats(polygon_coords)
        parser.close()

        if not result.get("valid"):
            raise ValueError("Zonal stats computation failed")

        polygon_geom = from_shape(polygon, srid=4326)
        stat = ZonalStats(
            raster_file_id=raster_file_id,
            polygon_wkt=polygon_wkt,
            polygon_geom=polygon_geom,
            mean_value=result.get("mean"),
            max_value=result.get("max"),
            min_value=result.get("min"),
            std_value=result.get("std"),
            valid_pixels=result.get("count"),
        )
        db.add(stat)
        db.commit()
        db.refresh(stat)

        output = {
            "task_type": "zonal_stats",
            "raster_file_id": raster_file_id,
            "polygon_wkt": polygon_wkt,
            "mean_value": result.get("mean"),
            "max_value": result.get("max"),
            "min_value": result.get("min"),
            "std_value": result.get("std"),
            "valid_pixels": result.get("count"),
            "stat_id": stat.id,
            "valid": True,
        }

        file_path, download_url = result_storage.save_result_json(output, "zonal")

        _update_task_status(
            celery_task_id,
            "SUCCESS",
            result_file_path=file_path,
            result_download_url=download_url,
        )

        return {"status": "SUCCESS", "result_url": download_url, "data": output}

    except Exception as e:
        _update_task_status(celery_task_id, "FAILURE", error_message=str(e))
        return {"status": "FAILURE", "error": str(e)}
    finally:
        db.close()


@celery_app.task(bind=True, name="ndvi_task")
def ndvi_task(self, raster_file_id: int, nir_band: int, red_band: int, params: dict):
    celery_task_id = self.request.id
    _update_task_status(celery_task_id, "STARTED")

    db = SessionLocal()
    try:
        from app.models import RasterFile

        raster_file = db.query(RasterFile).filter(RasterFile.id == raster_file_id).first()
        if not raster_file:
            raise ValueError("Raster file not found")

        analyzer = TimeSeriesAnalyzer(raster_file.file_path, raster_file.variable)
        analyzer.load_data()

        ndvi_data = analyzer.compute_ndvi(nir_band=nir_band, red_band=red_band)
        geo_info = analyzer.get_geo_info()
        analyzer.close()

        transform = None
        if geo_info.get("transform"):
            import rasterio
            t = geo_info["transform"]
            if isinstance(t, tuple) and len(t) >= 6:
                transform = rasterio.transform.Affine(t[1], t[2], t[0], t[4], t[5], t[3])

        output = raster_output.save_geotiff(
            ndvi_data,
            transform=transform,
            crs=geo_info.get("crs", "EPSG:4326"),
            prefix="ndvi",
        )

        thumbnail = raster_output.generate_thumbnail_base64(ndvi_data, cmap="RdYlGn")

        result_summary = {
            "task_type": "ndvi",
            "raster_file_id": raster_file_id,
            "nir_band": nir_band,
            "red_band": red_band,
            "output_file": output["filename"],
            "download_url": output["download_url"],
            "min_ndvi": float(np.nanmin(ndvi_data)),
            "max_ndvi": float(np.nanmax(ndvi_data)),
            "mean_ndvi": float(np.nanmean(ndvi_data)),
            "has_thumbnail": thumbnail is not None,
        }

        json_result = raster_output.save_result_json(result_summary, "ndvi")

        _update_task_status(
            celery_task_id,
            "SUCCESS",
            result_file_path=output["file_path"],
            result_download_url=output["download_url"],
        )

        return {
            "status": "SUCCESS",
            "result_url": output["download_url"],
            "json_url": json_result["download_url"],
            "thumbnail": thumbnail,
            "data": result_summary,
        }

    except Exception as e:
        _update_task_status(celery_task_id, "FAILURE", error_message=str(e))
        return {"status": "FAILURE", "error": str(e)}
    finally:
        db.close()


@celery_app.task(bind=True, name="anomaly_detection_task")
def anomaly_detection_task(
    self,
    raster_file_id: int,
    method: str,
    window_size: int,
    sigma_threshold: float,
    params: dict,
):
    celery_task_id = self.request.id
    _update_task_status(celery_task_id, "STARTED")

    db = SessionLocal()
    try:
        from app.models import RasterFile

        raster_file = db.query(RasterFile).filter(RasterFile.id == raster_file_id).first()
        if not raster_file:
            raise ValueError("Raster file not found")

        analyzer = TimeSeriesAnalyzer(raster_file.file_path, raster_file.variable)
        analyzer.load_data()

        result = analyzer.detect_anomalies(
            window_size=window_size,
            sigma_threshold=sigma_threshold,
            method=method,
        )
        geo_info = analyzer.get_geo_info()
        analyzer.close()

        transform = None
        if geo_info.get("transform"):
            import rasterio
            t = geo_info["transform"]
            if isinstance(t, tuple) and len(t) >= 6:
                transform = rasterio.transform.Affine(t[1], t[2], t[0], t[4], t[5], t[3])

        anomaly_maps = result["anomaly_maps"]
        anomaly_count = result["anomaly_count"]

        count_output = raster_output.save_geotiff(
            anomaly_count,
            transform=transform,
            crs=geo_info.get("crs", "EPSG:4326"),
            prefix="anomaly_count",
        )

        first_anomaly = anomaly_maps[0] if len(anomaly_maps.shape) == 3 else anomaly_maps
        thumbnail = raster_output.generate_thumbnail_base64(first_anomaly, cmap="hot")

        total_pixels = int(anomaly_count.size)
        anomalous_pixels = int(np.sum(anomaly_count > 0))

        result_summary = {
            "task_type": "anomaly_detection",
            "raster_file_id": raster_file_id,
            "method": method,
            "window_size": window_size,
            "sigma_threshold": sigma_threshold,
            "count_output_file": count_output["filename"],
            "count_download_url": count_output["download_url"],
            "num_time_steps": int(anomaly_maps.shape[0]) if len(anomaly_maps.shape) == 3 else 1,
            "total_pixels": total_pixels,
            "anomalous_pixels": anomalous_pixels,
            "max_anomaly_count": int(np.max(anomaly_count)),
            "has_thumbnail": thumbnail is not None,
        }

        json_result = raster_output.save_result_json(result_summary, "anomaly")

        _update_task_status(
            celery_task_id,
            "SUCCESS",
            result_file_path=count_output["file_path"],
            result_download_url=count_output["download_url"],
        )

        return {
            "status": "SUCCESS",
            "result_url": count_output["download_url"],
            "json_url": json_result["download_url"],
            "thumbnail": thumbnail,
            "data": result_summary,
        }

    except Exception as e:
        _update_task_status(celery_task_id, "FAILURE", error_message=str(e))
        return {"status": "FAILURE", "error": str(e)}
    finally:
        db.close()
