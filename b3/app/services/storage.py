import json
import os
import uuid
from datetime import datetime, timedelta

from app.config import settings


class ResultStorageService:
    def __init__(self):
        self.results_dir = settings.results_path
        os.makedirs(self.results_dir, exist_ok=True)

    def save_result_json(self, data: dict, task_type: str) -> tuple:
        task_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        filename = f"{task_type}_{timestamp}_{task_id[:8]}.json"
        file_path = os.path.join(self.results_dir, filename)

        with open(file_path, "w") as f:
            json.dump(data, f, indent=2)

        download_url = f"{settings.result_url_prefix}/download/{filename}"
        return file_path, download_url

    def get_result_path(self, filename: str) -> str:
        return os.path.join(self.results_dir, filename)

    def cleanup_expired(self):
        expire_delta = timedelta(hours=settings.result_expire_hours)
        now = datetime.utcnow()

        for filename in os.listdir(self.results_dir):
            file_path = os.path.join(self.results_dir, filename)
            if not os.path.isfile(file_path):
                continue

            mod_time = datetime.fromtimestamp(os.path.getmtime(file_path))
            if now - mod_time > expire_delta:
                os.remove(file_path)


result_storage = ResultStorageService()
