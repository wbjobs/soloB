#!/usr/bin/env python3
"""
API 测试脚本 - 演示如何使用卫星去云服务
"""
import requests
import time
import os
from pathlib import Path

BASE_URL = "http://localhost:8000"

def test_health_check():
    """测试健康检查接口"""
    print("1. Testing health check...")
    try:
        response = requests.get(f"{BASE_URL}/health")
        print(f"   Status: {response.status_code}")
        print(f"   Response: {response.json()}")
        return response.status_code == 200
    except Exception as e:
        print(f"   Error: {e}")
        return False

def test_create_task():
    """测试创建任务 - 需要先准备测试图像"""
    print("\n2. Testing create task...")

    test_dir = Path("./test_images")
    test_dir.mkdir(exist_ok=True)

    print(f"   请将测试图像放入 {test_dir} 目录后继续...")
    print("   至少需要2张图像 (.tif, .tiff, .png, .jpg)")

    image_files = list(test_dir.glob("*.tif")) + list(test_dir.glob("*.tiff")) + \
                  list(test_dir.glob("*.png")) + list(test_dir.glob("*.jpg"))

    if len(image_files) < 2:
        print(f"   警告: 找到 {len(image_files)} 张图像，需要至少2张")
        print("   跳过任务创建测试，使用模拟响应...")
        return "example-task-id"

    print(f"   找到 {len(image_files)} 张测试图像")

    try:
        files = []
        for img_file in image_files[:4]:
            files.append(("files", (img_file.name, open(img_file, "rb"))))

        response = requests.post(
            f"{BASE_URL}/api/v1/tasks",
            files=files,
            data={"cloud_threshold": 0.6}
        )

        for _, (_, fobj) in files:
            fobj.close()

        print(f"   Status: {response.status_code}")
        result = response.json()
        print(f"   Task ID: {result.get('task_id')}")
        print(f"   Status: {result.get('status')}")
        return result.get('task_id')
    except Exception as e:
        print(f"   Error: {e}")
        return None

def test_task_status(task_id):
    """测试任务状态查询"""
    print(f"\n3. Testing task status for {task_id}...")
    try:
        response = requests.get(f"{BASE_URL}/api/v1/tasks/{task_id}")
        print(f"   Status: {response.status_code}")
        result = response.json()
        print(f"   Task status: {result.get('status')}")
        print(f"   Result exists: {result.get('result_exists')}")
        return result
    except Exception as e:
        print(f"   Error: {e}")
        return None

def test_list_tasks():
    """测试任务列表"""
    print("\n4. Testing list tasks...")
    try:
        response = requests.get(f"{BASE_URL}/api/v1/tasks")
        print(f"   Status: {response.status_code}")
        result = response.json()
        print(f"   Total tasks: {result.get('total')}")
        tasks = result.get('tasks', [])
        for task in tasks[:3]:
            print(f"     - {task['task_id']}: {task['status']}")
        return result
    except Exception as e:
        print(f"   Error: {e}")
        return None

def wait_for_completion(task_id, timeout=300, interval=10):
    """等待任务完成"""
    print(f"\n5. Waiting for task {task_id} to complete (timeout: {timeout}s)...")
    start = time.time()

    while time.time() - start < timeout:
        result = test_task_status(task_id)
        if result and result.get('status') == 'completed':
            print(f"   Task completed in {int(time.time() - start)}s!")
            return True
        elif result and result.get('status') == 'failed':
            print(f"   Task failed!")
            return False
        print(f"   Waiting {interval}s...")
        time.sleep(interval)

    print("   Timeout!")
    return False

def generate_test_images():
    """生成模拟测试图像（便于测试）"""
    print("\nGenerating test images...")
    import numpy as np
    import cv2

    test_dir = Path("./test_images")
    test_dir.mkdir(exist_ok=True)

    for i in range(3):
        img = np.random.randint(0, 255, (512, 512, 3), dtype=np.uint8)

        if i > 0:
            cloud_area = 100 + i * 50
            img[100:cloud_area, 100:cloud_area] = 250

        output_path = test_dir / f"test_image_{i}.png"
        cv2.imwrite(str(output_path), img)
        print(f"   Created: {output_path}")

    print("Test images generated!")

if __name__ == "__main__":
    print("=" * 50)
    print("Satellite Cloud Removal API Test")
    print("=" * 50)

    if not test_health_check():
        print("\n请确保服务已启动!")
        print("启动命令:")
        print("  docker-compose up -d")
        print("  或")
        print("  uvicorn main:app --reload")
        exit(1)

    generate_test_images()

    task_id = test_create_task()

    if task_id:
        test_task_status(task_id)
        test_list_tasks()

    print("\n" + "=" * 50)
    print("测试完成!")
    print(f"API 文档: {BASE_URL}/docs")
    print(f"管理界面: {BASE_URL}/redoc")
    print("=" * 50)
