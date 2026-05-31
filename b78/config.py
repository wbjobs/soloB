from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/0"
    upload_dir: Path = Path("./uploads")
    result_dir: Path = Path("./results")
    max_file_size: int = 1024 * 1024 * 1024
    port: int = 8000

    class Config:
        env_file = ".env"


settings = Settings()

settings.upload_dir.mkdir(parents=True, exist_ok=True)
settings.result_dir.mkdir(parents=True, exist_ok=True)
