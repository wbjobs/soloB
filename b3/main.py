from fastapi import FastAPI

from app.routers import extract, tasks, timeseries, upload, zonal

app = FastAPI(title="Raster Science Backend (Async + TimeSeries)", version="3.0.0")

app.include_router(upload.router)
app.include_router(extract.router)
app.include_router(zonal.router)
app.include_router(tasks.router)
app.include_router(timeseries.router)


@app.get("/")
def root():
    return {
        "service": "Raster Science Backend (Async + TimeSeries)",
        "version": "3.0.0",
        "architecture": "FastAPI + Celery + Redis",
        "endpoints": [
            "POST /upload - Upload NetCDF or GeoTIFF file",
            "GET  /upload/files - List all uploaded files",
            "POST /extract_point - Submit async point extraction task",
            "GET  /extract_point/history - Get extraction history",
            "POST /zonal_stats - Submit async zonal stats task",
            "GET  /zonal_stats/history - Get zonal stats history",
            "POST /timeseries/ndvi - Submit NDVI computation task",
            "POST /timeseries/anomaly_detection - Submit anomaly detection task",
            "GET  /task/{task_id} - Query task status",
            "GET  /tasks - List all tasks",
            "GET  /download/{filename} - Download result file",
        ],
    }
