from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Form
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
import uuid
import os
import logging
from pathlib import Path
from datetime import datetime
import json

from config import settings
from celery_worker import (
    process_cloud_removal_task,
    analyze_vegetation_health_task,
    full_processing_pipeline_task,
    celery_app
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Satellite Cloud Removal API",
    description="API for removing clouds from satellite imagery using multi-temporal fusion",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "service": "Satellite Cloud Removal API",
        "version": "1.0.0",
        "status": "running",
        "endpoints": {
            "upload": "/api/v1/tasks",
            "status": "/api/v1/tasks/{task_id}",
            "download": "/api/v1/tasks/{task_id}/download",
            "list": "/api/v1/tasks",
            "health": "/health"
        }
    }


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "upload_dir_exists": settings.upload_dir.exists(),
        "result_dir_exists": settings.result_dir.exists()
    }


@app.post("/api/v1/tasks", status_code=202)
async def create_task(
    files: List[UploadFile] = File(...),
    cloud_threshold: Optional[float] = 0.6
):
    if len(files) < 2:
        raise HTTPException(
            status_code=400,
            detail="At least 2 images are required for cloud removal"
        )

    task_id = str(uuid.uuid4())
    task_dir = settings.upload_dir / task_id
    task_dir.mkdir(parents=True, exist_ok=True)

    saved_filenames = []
    for file in files:
        if not file.filename:
            continue

        ext = Path(file.filename).suffix.lower()
        if ext not in ['.tif', '.tiff', '.png', '.jpg', '.jpeg']:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file format: {ext}. Supported: .tif, .tiff, .png, .jpg"
            )

        safe_filename = f"{uuid.uuid4()}{ext}"
        file_path = task_dir / safe_filename

        content = await file.read()
        if len(content) > settings.max_file_size:
            raise HTTPException(
                status_code=400,
                detail=f"File {file.filename} exceeds size limit"
            )

        with open(file_path, "wb") as f:
            f.write(content)

        saved_filenames.append(f"{task_id}/{safe_filename}")
        logger.info(f"Saved file: {safe_filename}")

    if not saved_filenames:
        raise HTTPException(
            status_code=400,
            detail="No valid files were uploaded"
        )

    task = process_cloud_removal_task.delay(
        task_id=task_id,
        image_filenames=saved_filenames,
        cloud_threshold=cloud_threshold
    )

    logger.info(f"Created task {task_id} with Celery ID {task.id}")

    return {
        "task_id": task_id,
        "celery_task_id": task.id,
        "status": "queued",
        "num_images": len(saved_filenames),
        "created_at": datetime.utcnow().isoformat(),
        "_links": {
            "status": f"/api/v1/tasks/{task_id}",
            "download": f"/api/v1/tasks/{task_id}/download"
        }
    }


@app.get("/api/v1/tasks/{task_id}")
async def get_task_status(task_id: str):
    result_path = settings.result_dir / f"{task_id}_result.tif"
    result_exists = result_path.exists()

    active_tasks = celery_app.control.inspect().active() or {}
    reserved_tasks = celery_app.control.inspect().reserved() or {}

    task_found = False
    task_status = "unknown"
    celery_task_id = None

    for worker, tasks in active_tasks.items():
        for task in tasks:
            if task.get("kwargs", {}).get("task_id") == task_id:
                task_status = "processing"
                celery_task_id = task.get("id")
                task_found = True
                break
        if task_found:
            break

    if not task_found:
        for worker, tasks in reserved_tasks.items():
            for task in tasks:
                if task.get("kwargs", {}).get("task_id") == task_id:
                    task_status = "queued"
                    celery_task_id = task.get("id")
                    task_found = True
                    break
            if task_found:
                break

    if result_exists:
        task_status = "completed"

    response = {
        "task_id": task_id,
        "status": task_status,
        "result_exists": result_exists
    }

    if result_exists:
        file_size = result_path.stat().st_size
        response["result_file_size"] = file_size
        response["download_url"] = f"/api/v1/tasks/{task_id}/download"

    return response


@app.get("/api/v1/tasks")
async def list_tasks():
    results = []

    for result_file in settings.result_dir.glob("*_result.tif"):
        task_id = result_file.stem.replace("_result", "")
        file_size = result_file.stat().st_size
        modified_time = datetime.fromtimestamp(result_file.stat().st_mtime)

        results.append({
            "task_id": task_id,
            "status": "completed",
            "result_file_size": file_size,
            "completed_at": modified_time.isoformat(),
            "download_url": f"/api/v1/tasks/{task_id}/download"
        })

    return {
        "total": len(results),
        "tasks": sorted(results, key=lambda x: x["completed_at"], reverse=True)
    }


@app.get("/api/v1/tasks/{task_id}/download")
async def download_result(task_id: str):
    result_path = settings.result_dir / f"{task_id}_result.tif"

    if not result_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Result for task {task_id} not found or not ready yet"
        )

    return FileResponse(
        path=result_path,
        filename=f"cloud_removed_{task_id}.tif",
        media_type="image/tiff"
    )


@app.delete("/api/v1/tasks/{task_id}")
async def delete_task(task_id: str):
    result_path = settings.result_dir / f"{task_id}_result.tif"
    task_dir = settings.upload_dir / task_id
    veg_dir = settings.result_dir / task_id

    deleted_count = 0

    if result_path.exists():
        result_path.unlink()
        deleted_count += 1
        logger.info(f"Deleted result: {result_path}")

    if task_dir.exists():
        import shutil
        shutil.rmtree(task_dir)
        deleted_count += 1
        logger.info(f"Deleted task directory: {task_dir}")

    if veg_dir.exists():
        import shutil
        shutil.rmtree(veg_dir)
        deleted_count += 1
        logger.info(f"Deleted vegetation analysis directory: {veg_dir}")

    if deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail=f"Task {task_id} not found"
        )

    return {
        "task_id": task_id,
        "status": "deleted",
        "deleted_files": deleted_count
    }


@app.post("/api/v1/vegetation-analysis", status_code=202)
async def create_vegetation_analysis_task(
    files: List[UploadFile] = File(...),
    dates: Optional[str] = Form(None),
    red_band_idx: Optional[int] = Form(2),
    nir_band_idx: Optional[int] = Form(3)
):
    """
    创建植被健康指数时间序列分析任务

    参数:
        files: 多时相卫星图像（至少2张）
        dates: 可选，JSON数组格式的日期列表，如 ["2024-01-01", "2024-02-01"]
        red_band_idx: 红光波段索引（默认2）
        nir_band_idx: 近红外波段索引（默认3）
    """
    if len(files) < 2:
        raise HTTPException(
            status_code=400,
            detail="至少需要2张图像才能进行时间序列分析"
        )

    task_id = str(uuid.uuid4())
    task_dir = settings.upload_dir / task_id
    task_dir.mkdir(parents=True, exist_ok=True)

    saved_filenames = []
    for file in files:
        if not file.filename:
            continue

        ext = Path(file.filename).suffix.lower()
        if ext not in ['.tif', '.tiff', '.png', '.jpg', '.jpeg']:
            raise HTTPException(
                status_code=400,
                detail=f"不支持的文件格式: {ext}。支持格式: .tif, .tiff, .png, .jpg"
            )

        safe_filename = f"{uuid.uuid4()}{ext}"
        file_path = task_dir / safe_filename

        content = await file.read()
        if len(content) > settings.max_file_size:
            raise HTTPException(
                status_code=400,
                detail=f"文件 {file.filename} 超出大小限制"
            )

        with open(file_path, "wb") as f:
            f.write(content)

        saved_filenames.append(f"{task_id}/{safe_filename}")
        logger.info(f"保存文件: {safe_filename}")

    if not saved_filenames:
        raise HTTPException(
            status_code=400,
            detail="没有有效的文件被上传"
        )

    date_list = None
    if dates:
        try:
            date_list = json.loads(dates)
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=400,
                detail="日期格式错误，应为JSON数组格式"
            )

    task = analyze_vegetation_health_task.delay(
        task_id=task_id,
        image_filenames=saved_filenames,
        dates=date_list,
        red_band_idx=red_band_idx,
        nir_band_idx=nir_band_idx
    )

    logger.info(f"创建植被分析任务 {task_id}，Celery ID: {task.id}")

    return {
        "task_id": task_id,
        "celery_task_id": task.id,
        "status": "queued",
        "num_images": len(saved_filenames),
        "created_at": datetime.utcnow().isoformat(),
        "_links": {
            "status": f"/api/v1/vegetation-analysis/{task_id}",
            "trend_chart": f"/api/v1/vegetation-analysis/{task_id}/trend-chart",
            "csv": f"/api/v1/vegetation-analysis/{task_id}/csv"
        }
    }


@app.get("/api/v1/vegetation-analysis/{task_id}")
async def get_vegetation_analysis_status(task_id: str):
    """
    获取植被健康分析任务的状态和结果
    """
    result_dir = settings.result_dir / task_id
    json_path = result_dir / f"{task_id}_vegetation_analysis.json"
    full_json_path = result_dir / f"{task_id}_full_analysis.json"

    result = {
        "task_id": task_id,
        "status": "unknown"
    }

    if full_json_path.exists():
        with open(full_json_path, 'r', encoding='utf-8') as f:
            analysis_result = json.load(f)
        result.update({
            "status": "completed",
            "result": analysis_result,
            "result_type": "full_pipeline"
        })
    elif json_path.exists():
        with open(json_path, 'r', encoding='utf-8') as f:
            analysis_result = json.load(f)
        result.update({
            "status": "completed",
            "result": analysis_result,
            "result_type": "vegetation_only"
        })
    elif result_dir.exists():
        result["status"] = "processing"
    else:
        result["status"] = "not_found"

    return result


@app.get("/api/v1/vegetation-analysis/{task_id}/trend-chart")
async def download_vegetation_trend_chart(task_id: str):
    """
    下载 NDVI 变化趋势折线图
    """
    result_dir = settings.result_dir / task_id
    chart_path = result_dir / f"{task_id}_ndvi_trend.png"

    if not chart_path.exists():
        raise HTTPException(
            status_code=404,
            detail="趋势图表尚未生成或任务不存在"
        )

    return FileResponse(
        path=chart_path,
        filename=f"ndvi_trend_{task_id}.png",
        media_type="image/png"
    )


@app.get("/api/v1/vegetation-analysis/{task_id}/distribution-chart/{index}")
async def download_ndvi_distribution_chart(task_id: str, index: int):
    """
    下载指定时相的 NDVI 分布图

    参数:
        task_id: 任务ID
        index: 时相索引 (0, 1, 2, ...)
    """
    result_dir = settings.result_dir / task_id
    chart_path = result_dir / f"{task_id}_ndvi_distribution_{index}.png"

    if not chart_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"分布图不存在: 时相 {index}"
        )

    return FileResponse(
        path=chart_path,
        filename=f"ndvi_distribution_{task_id}_{index}.png",
        media_type="image/png"
    )


@app.get("/api/v1/vegetation-analysis/{task_id}/csv")
async def download_vegetation_csv(task_id: str):
    """
    下载植被健康分析的时间序列 CSV 数据
    """
    result_dir = settings.result_dir / task_id
    csv_path = result_dir / f"{task_id}_ndvi_timeseries.csv"

    if not csv_path.exists():
        raise HTTPException(
            status_code=404,
            detail="CSV数据文件尚未生成或任务不存在"
        )

    return FileResponse(
        path=csv_path,
        filename=f"vegetation_timeseries_{task_id}.csv",
        media_type="text/csv"
    )


@app.post("/api/v1/full-pipeline", status_code=202)
async def create_full_pipeline_task(
    files: List[UploadFile] = File(...),
    cloud_threshold: Optional[float] = Form(0.6),
    enable_vegetation_analysis: Optional[bool] = Form(True),
    dates: Optional[str] = Form(None),
    red_band_idx: Optional[int] = Form(2),
    nir_band_idx: Optional[int] = Form(3)
):
    """
    创建完整处理流程任务：去云修复 + 植被健康分析

    参数:
        files: 多时相卫星图像（至少2张）
        cloud_threshold: 云检测阈值（默认0.6）
        enable_vegetation_analysis: 是否启用植被分析（默认True）
        dates: 可选，JSON数组格式的日期列表
        red_band_idx: 红光波段索引（默认2）
        nir_band_idx: 近红外波段索引（默认3）
    """
    if len(files) < 2:
        raise HTTPException(
            status_code=400,
            detail="至少需要2张图像进行处理"
        )

    task_id = str(uuid.uuid4())
    task_dir = settings.upload_dir / task_id
    task_dir.mkdir(parents=True, exist_ok=True)

    saved_filenames = []
    for file in files:
        if not file.filename:
            continue

        ext = Path(file.filename).suffix.lower()
        if ext not in ['.tif', '.tiff', '.png', '.jpg', '.jpeg']:
            raise HTTPException(
                status_code=400,
                detail=f"不支持的文件格式: {ext}"
            )

        safe_filename = f"{uuid.uuid4()}{ext}"
        file_path = task_dir / safe_filename

        content = await file.read()
        if len(content) > settings.max_file_size:
            raise HTTPException(
                status_code=400,
                detail=f"文件 {file.filename} 超出大小限制"
            )

        with open(file_path, "wb") as f:
            f.write(content)

        saved_filenames.append(f"{task_id}/{safe_filename}")

    if not saved_filenames:
        raise HTTPException(
            status_code=400,
            detail="没有有效的文件被上传"
        )

    date_list = None
    if dates:
        try:
            date_list = json.loads(dates)
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=400,
                detail="日期格式错误，应为JSON数组格式"
            )

    task = full_processing_pipeline_task.delay(
        task_id=task_id,
        image_filenames=saved_filenames,
        cloud_threshold=cloud_threshold,
        enable_vegetation_analysis=enable_vegetation_analysis,
        dates=date_list,
        red_band_idx=red_band_idx,
        nir_band_idx=nir_band_idx
    )

    logger.info(f"创建完整流程任务 {task_id}，Celery ID: {task.id}")

    return {
        "task_id": task_id,
        "celery_task_id": task.id,
        "status": "queued",
        "num_images": len(saved_filenames),
        "created_at": datetime.utcnow().isoformat(),
        "_links": {
            "status": f"/api/v1/vegetation-analysis/{task_id}",
            "cloud_removal_result": f"/api/v1/tasks/{task_id}/download",
            "trend_chart": f"/api/v1/vegetation-analysis/{task_id}/trend-chart"
        }
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=settings.port)
