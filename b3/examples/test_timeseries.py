import json
import time

import numpy as np
import requests

BASE_URL = "http://localhost:8000"


def create_test_timeseries_tif():
    import os
    import uuid

    import rasterio
    from rasterio.crs import CRS
    from rasterio.transform import from_bounds

    test_dir = "./test_data"
    os.makedirs(test_dir, exist_ok=True)

    height, width = 100, 100
    num_time_steps = 10

    base_data = np.random.rand(height, width).astype(np.float32) * 50 + 20

    data = []
    for t in range(num_time_steps):
        trend = t * 2
        noise = np.random.randn(height, width).astype(np.float32) * 5
        frame = base_data + trend + noise

        anomalies = np.random.rand(height, width) < 0.02
        frame[anomalies] += np.random.randn(np.sum(anomalies)).astype(np.float32) * 20

        data.append(frame)

    data = np.stack(data, axis=0)

    file_path = f"{test_dir}/timeseries_{uuid.uuid4().hex[:8]}.tif"
    transform = from_bounds(-180, -90, 180, 90, width, height)

    with rasterio.open(
        file_path,
        "w",
        driver="GTiff",
        height=height,
        width=width,
        count=num_time_steps,
        dtype=data.dtype,
        crs=CRS.from_epsg(4326),
        transform=transform,
    ) as dst:
        for i in range(num_time_steps):
            dst.write(data[i], i + 1)

    print(f"Created test time series: {file_path}")
    print(f"  Shape: {data.shape}")
    print(f"  Time steps: {num_time_steps}")

    return file_path


def create_test_multiband_tif():
    import os
    import uuid

    import rasterio
    from rasterio.crs import CRS
    from rasterio.transform import from_bounds

    test_dir = "./test_data"
    os.makedirs(test_dir, exist_ok=True)

    height, width = 200, 200

    red = np.random.rand(height, width).astype(np.float32) * 0.5 + 0.1
    nir = np.random.rand(height, width).astype(np.float32) * 0.6 + 0.3

    data = np.stack([red, nir], axis=0)

    file_path = f"{test_dir}/multiband_{uuid.uuid4().hex[:8]}.tif"
    transform = from_bounds(-180, -90, 180, 90, width, height)

    with rasterio.open(
        file_path,
        "w",
        driver="GTiff",
        height=height,
        width=width,
        count=2,
        dtype=data.dtype,
        crs=CRS.from_epsg(4326),
        transform=transform,
    ) as dst:
        dst.write(red, 1)
        dst.write(nir, 2)

    print(f"Created test multiband (Red+NIR): {file_path}")

    return file_path


def upload_file(file_path: str):
    print("\n" + "=" * 60)
    print("Uploading file...")

    with open(file_path, "rb") as f:
        files = {"file": f}
        response = requests.post(f"{BASE_URL}/upload", files=files)

    print(f"Status: {response.status_code}")
    result = response.json()
    print(f"Response: {json.dumps(result, indent=2)}")

    return result.get("raster_file", {}).get("id")


def submit_ndvi(raster_id: int):
    print("\n" + "=" * 60)
    print("Submitting NDVI task...")

    payload = {
        "raster_file_id": raster_id,
        "nir_band": 2,
        "red_band": 1,
    }

    response = requests.post(f"{BASE_URL}/timeseries/ndvi", json=payload)

    print(f"Status: {response.status_code}")
    result = response.json()
    print(f"Response: {json.dumps(result, indent=2)}")

    return result.get("celery_task_id")


def submit_anomaly_detection(raster_id: int):
    print("\n" + "=" * 60)
    print("Submitting anomaly detection task...")

    payload = {
        "raster_file_id": raster_id,
        "method": "rolling",
        "window_size": 5,
        "sigma_threshold": 2.0,
    }

    response = requests.post(f"{BASE_URL}/timeseries/anomaly_detection", json=payload)

    print(f"Status: {response.status_code}")
    result = response.json()
    print(f"Response: {json.dumps(result, indent=2)}")

    return result.get("celery_task_id")


def poll_task_status(task_id: str, max_retries: int = 15, delay: float = 2.0):
    print("\n" + "=" * 60)
    print(f"Polling task: {task_id[:12]}...")

    for i in range(max_retries):
        response = requests.get(f"{BASE_URL}/task/{task_id}")
        result = response.json()

        status = result.get("status")
        print(f"  Attempt {i+1}/{max_retries}: {status}")

        if status in ("SUCCESS", "FAILURE"):
            print(f"\nTask completed!")
            print(f"Status: {status}")

            download_url = result.get("result_download_url")
            if download_url:
                print(f"Download URL: {download_url}")

            thumbnail = result.get("thumbnail")
            if thumbnail:
                print(f"Has thumbnail: Yes (Base64 encoded)")

            return result

        time.sleep(delay)

    print("Task timeout")
    return None


def list_tasks():
    print("\n" + "=" * 60)
    print("Recent tasks:")

    response = requests.get(f"{BASE_URL}/tasks?limit=10")
    tasks = response.json()

    for task in tasks:
        print(f"  - {task['task_type']:20s} | {task['status']:10s} | {task['celery_task_id'][:12]}...")


if __name__ == "__main__":
    try:
        print("=" * 60)
        print("Testing Time Series Analysis (NDVI + Anomaly Detection)")
        print("=" * 60)

        multiband_path = create_test_multiband_tif()
        multiband_id = upload_file(multiband_path)

        timeseries_path = create_test_timeseries_tif()
        timeseries_id = upload_file(timeseries_path)

        if multiband_id:
            ndvi_task_id = submit_ndvi(multiband_id)
            poll_task_status(ndvi_task_id)

        if timeseries_id:
            anomaly_task_id = submit_anomaly_detection(timeseries_id)
            poll_task_status(anomaly_task_id)

        list_tasks()

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        print("\nPlease make sure:")
        print("  1. FastAPI server is running")
        print("  2. Redis is running on localhost:6379")
        print("  3. Celery worker is running: celery -A app.celery_app worker --loglevel=info")
