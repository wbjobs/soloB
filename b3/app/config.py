from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://postgres:postgres@localhost:5432/raster_db"
    storage_path: str = "./storage"
    results_path: str = "./results"
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/0"
    result_url_prefix: str = "http://localhost:8000"
    result_expire_hours: int = 24

    class Config:
        env_file = ".env"


settings = Settings()
