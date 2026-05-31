from celery import Celery
from kombu import Queue
import logging
from pathlib import Path
import uuid
import json
from datetime import datetime

from config import settings
from image_processing import CloudRemovalPipeline
from vegetation_analysis import VegetationHealthPipeline

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

celery_app = Celery(
    "satellite_cloud_removal",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=3600,
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=100,
    task_queues=(
        Queue("default", routing_key="task.#"),
        Queue("image_processing", routing_key="image_processing.#"),
    ),
    task_routes={
        "process_cloud_removal": {
            "queue": "image_processing",
            "routing_key": "image_processing.cloud_removal",
        },
        "health_check": {
            "queue": "default",
            "routing_key": "task.health_check",
        },
    },
    task_default_queue="default",
    task_default_exchange="tasks",
    task_default_exchange_type="direct",
    task_default_routing_key="task.default",
)


@celery_app.task(bind=True, name="process_cloud_removal", queue="image_processing")
def process_cloud_removal_task(
    self,
    task_id: str,
    image_filenames: list,
    cloud_threshold: float = 0.6
):
    try:
        logger.info(f"Starting task {task_id} with {len(image_filenames)} images")

        image_paths = [
            str(settings.upload_dir / filename)
            for filename in image_filenames
        ]

        output_filename = f"{task_id}_result.tif"
        output_path = str(settings.result_dir / output_filename)

        pipeline = CloudRemovalPipeline()
        stats = pipeline.process(
            image_paths=image_paths,
            output_path=output_path,
            cloud_threshold=cloud_threshold
        )

        result = {
            "task_id": task_id,
            "status": "completed",
            "result_filename": output_filename,
            "stats": stats
        }

        logger.info(f"Task {task_id} completed successfully")
        return result

    except Exception as e:
        logger.error(f"Task {task_id} failed: {str(e)}", exc_info=True)
        self.update_state(
            state="FAILURE",
            meta={
                "task_id": task_id,
                "status": "failed",
                "error": str(e)
            }
        )
        raise


@celery_app.task(name="health_check", queue="default")
def health_check():
    return {"status": "healthy", "worker": "active"}


@celery_app.task(bind=True, name="analyze_vegetation_health", queue="image_processing")
def analyze_vegetation_health_task(
    self,
    task_id: str,
    image_filenames: list,
    dates: list = None,
    red_band_idx: int = 2,
    nir_band_idx: int = 3
):
    """
    植被健康指数时间序列分析任务

    参数:
        task_id: 任务ID
        image_filenames: 图像文件路径列表
        dates: 可选的日期列表 (ISO format strings)
        red_band_idx: 红光波段索引 (默认: 2)
        nir_band_idx: 近红外波段索引 (默认: 3)
    """
    try:
        logger.info(f"开始植被健康分析任务 {task_id}，共 {len(image_filenames)} 张图像")

        from image_processing import GeoTIFFProcessor

        images = []
        for filename in image_filenames:
            image_path = settings.upload_dir / filename
            if image_path.exists():
                img, _ = GeoTIFFProcessor.read_geotiff_gdal(str(image_path))
                from skimage import img_as_float
                img = img_as_float(img)
                images.append(img)

        if len(images) < 2:
            raise ValueError(f"植被分析至少需要2张图像，实际载入 {len(images)} 张")

        if dates:
            dates = [datetime.fromisoformat(d) for d in dates]

        output_dir = settings.result_dir / task_id
        output_dir.mkdir(parents=True, exist_ok=True)

        pipeline = VegetationHealthPipeline()
        result = pipeline.process_images(
            images=images,
            output_dir=str(output_dir),
            task_id=task_id,
            dates=dates,
            red_band_idx=red_band_idx,
            nir_band_idx=nir_band_idx
        )

        result_json_path = output_dir / f"{task_id}_vegetation_analysis.json"
        with open(result_json_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

        logger.info(f"植被健康分析任务 {task_id} 完成，趋势: {result['trend_analysis'].get('trend')}")
        return result

    except Exception as e:
        logger.error(f"植被健康分析任务 {task_id} 失败: {str(e)}", exc_info=True)
        self.update_state(
            state="FAILURE",
            meta={
                "task_id": task_id,
                "status": "failed",
                "error": str(e)
            }
        )
        raise


@celery_app.task(bind=True, name="full_processing_pipeline", queue="image_processing")
def full_processing_pipeline_task(
    self,
    task_id: str,
    image_filenames: list,
    cloud_threshold: float = 0.6,
    enable_vegetation_analysis: bool = True,
    dates: list = None,
    red_band_idx: int = 2,
    nir_band_idx: int = 3
):
    """
    完整处理流程：去云修复 + 植被健康分析

    参数:
        task_id: 任务ID
        image_filenames: 图像文件路径列表
        cloud_threshold: 云检测阈值
        enable_vegetation_analysis: 是否启用植被分析
        dates: 可选的日期列表
        red_band_idx: 红光波段索引
        nir_band_idx: 近红外波段索引
    """
    try:
        logger.info(f"开始完整处理流程任务 {task_id}")

        result = {
            "task_id": task_id,
            "cloud_removal": None,
            "vegetation_analysis": None,
            "status": "completed"
        }

        image_paths = [
            str(settings.upload_dir / filename)
            for filename in image_filenames
        ]

        output_filename = f"{task_id}_result.tif"
        output_path = str(settings.result_dir / output_filename)

        cloud_pipeline = CloudRemovalPipeline()
        cloud_result = cloud_pipeline.process(
            image_paths=image_paths,
            output_path=output_path,
            cloud_threshold=cloud_threshold
        )
        result["cloud_removal"] = cloud_result

        if enable_vegetation_analysis:
            from image_processing import GeoTIFFProcessor

            images = []
            for filename in image_filenames:
                image_path = settings.upload_dir / filename
                if image_path.exists():
                    img, _ = GeoTIFFProcessor.read_geotiff_gdal(str(image_path))
                    from skimage import img_as_float
                    img = img_as_float(img)
                    images.append(img)

            if len(images) >= 2:
                veg_output_dir = settings.result_dir / task_id
                veg_output_dir.mkdir(parents=True, exist_ok=True)

                veg_pipeline = VegetationHealthPipeline()
                veg_result = veg_pipeline.process_images(
                    images=images,
                    output_dir=str(veg_output_dir),
                    task_id=task_id,
                    dates=dates,
                    red_band_idx=red_band_idx,
                    nir_band_idx=nir_band_idx
                )
                result["vegetation_analysis"] = veg_result

                result_json_path = veg_output_dir / f"{task_id}_full_analysis.json"
                with open(result_json_path, 'w', encoding='utf-8') as f:
                    json.dump(result, f, ensure_ascii=False, indent=2)

        logger.info(f"完整处理流程任务 {task_id} 完成")
        return result

    except Exception as e:
        logger.error(f"完整处理流程任务 {task_id} 失败: {str(e)}", exc_info=True)
        self.update_state(
            state="FAILURE",
            meta={
                "task_id": task_id,
                "status": "failed",
                "error": str(e)
            }
        )
        raise
