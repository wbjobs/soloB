import json

import requests

BASE_URL = "http://localhost:8000"


def test_upload():
    print("=" * 60)
    print("Testing upload endpoint...")

    import os
    import uuid

    import numpy as np
    import rasterio
    from rasterio.crs import CRS
    from rasterio.transform import from_bounds

    test_dir = "./test_data"
    os.makedirs(test_dir, exist_ok=True)

    data = np.random.rand(100, 100).astype(np.float32) * 100

    file_path = f"{test_dir}/sample_{uuid.uuid4().hex[:8]}.tif"
    transform = from_bounds(-180, -90, 180, 90, 100, 100)

    with rasterio.open(
        file_path,
        "w",
        driver="GTiff",
        height=100,
        width=100,
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
    print(f"Response: {json.dumps(response.json(), indent=2)}")

    return response.json().get("raster_file", {}).get("id")


def test_extract_point(raster_id: int):
    print("\n" + "=" * 60)
    print("Testing extract_point endpoint...")

    payload = {"raster_file_id": raster_id, "longitude": 0.0, "latitude": 0.0}

    response = requests.post(f"{BASE_URL}/extract_point", json=payload)

    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")


def test_zonal_stats(raster_id: int):
    print("\n" + "=" * 60)
    print("Testing zonal_stats endpoint...")

    polygon_wkt = "POLYGON((-10 -10, 10 -10, 10 10, -10 10, -10 -10))"
    payload = {"raster_file_id": raster_id, "polygon_wkt": polygon_wkt}

    response = requests.post(f"{BASE_URL}/zonal_stats", json=payload)

    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")


if __name__ == "__main__":
    try:
        raster_id = test_upload()
        if raster_id:
            test_extract_point(raster_id)
            test_zonal_stats(raster_id)
    except Exception as e:
        print(f"Error: {e}")
        print("Please make sure the FastAPI server is running on http://localhost:8000")
