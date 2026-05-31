import json
import time

import requests

BASE_URL = "http://localhost:8000"


def test_upload():
    print("=" * 60)
    print("1. Testing upload endpoint...")

    import os
    import uuid

    import numpy as np
    import rasterio
    from rasterio.crs import CRS
    from rasterio.transform import from_bounds

    test_dir = "./test_data"
    os.makedirs(test_dir, exist_ok=True)

    data = np.random.rand(200, 200).astype(np.float32) * 100

    file_path = f"{test_dir}/sample_{uuid.uuid4().hex[:8]}.tif"
    transform = from_bounds(-180, -90, 180, 90, 200, 200)

    with rasterio.open(
        file_path,
        "w",
        driver="GTiff",
        height=200,
        width=200,
        count=1,
        dtype=data.dtype,
        crs=CRS.from_epsg(4326),
        transform=transform,
    ) as dst:
        dst.write(data, 1)

    print(f"Created test file: {file_path}")

    with open(file_path, "rb") as f:
        files = {"file": f}
        response = requests.post(f"{BASE_URL}/upload", files=files)

    print(f"Status: {response.status_code}")
    result = response.json()
    print(f"Response: {json.dumps(result, indent=2)}")

    return result.get("raster_file", {}).get("id")


def submit_zonal_stats(raster_id: int):
    print("\n" + "=" * 60)
    print("2. Submitting async zonal_stats task...")

    polygon_wkt = "POLYGON((-10 -10, 10 -10, 10 10, -10 10, -10 -10))"
    payload = {"raster_file_id": raster_id, "polygon_wkt": polygon_wkt}

    response = requests.post(f"{BASE_URL}/zonal_stats", json=payload)

    print(f"Status: {response.status_code}")
    result = response.json()
    print(f"Response: {json.dumps(result, indent=2)}")

    return result.get("celery_task_id")


def submit_extract_point(raster_id: int):
    print("\n" + "=" * 60)
    print("3. Submitting async extract_point task...")

    payload = {"raster_file_id": raster_id, "longitude": 0.0, "latitude": 0.0}

    response = requests.post(f"{BASE_URL}/extract_point", json=payload)

    print(f"Status: {response.status_code}")
    result = response.json()
    print(f"Response: {json.dumps(result, indent=2)}")

    return result.get("celery_task_id")


def poll_task_status(task_id: str, max_retries: int = 10, delay: float = 2.0):
    print("\n" + "=" * 60)
    print(f"4. Polling task status for: {task_id}")

    for i in range(max_retries):
        response = requests.get(f"{BASE_URL}/task/{task_id}")
        result = response.json()

        status = result.get("status")
        print(f"Attempt {i+1}/{max_retries}: status={status}")

        if status in ("SUCCESS", "FAILURE"):
            print(f"Task completed!")
            print(f"Final response: {json.dumps(result, indent=2)}")

            download_url = result.get("result_download_url")
            if download_url:
                print(f"\nDownload URL: {download_url}")
            return result

        time.sleep(delay)

    print("Task not completed within timeout")
    return result


def list_all_tasks():
    print("\n" + "=" * 60)
    print("5. Listing all recent tasks...")

    response = requests.get(f"{BASE_URL}/tasks?limit=10")
    result = response.json()

    print(f"Total tasks: {len(result)}")
    for task in result:
        print(f"  - {task['task_type']} | {task['status']} | {task['celery_task_id'][:12]}...")


if __name__ == "__main__":
    try:
        raster_id = test_upload()
        if raster_id:
            zonal_task_id = submit_zonal_stats(raster_id)
            extract_task_id = submit_extract_point(raster_id)

            poll_task_status(zonal_task_id)
            poll_task_status(extract_task_id)

            list_all_tasks()

    except Exception as e:
        print(f"Error: {e}")
        print("Please make sure:")
        print("  1. FastAPI server is running on http://localhost:8000")
        print("  2. Redis is running on localhost:6379")
        print("  3. Celery worker is running: celery -A app.celery_app worker --loglevel=info")
