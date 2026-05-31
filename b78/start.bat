@echo off
echo Starting Satellite Cloud Removal Service...

if not exist "uploads" mkdir uploads
if not exist "results" mkdir results

echo Starting Redis...
start /B redis-server

timeout /t 3 /nobreak > nul

echo Starting Celery Worker...
start /B celery -A celery_worker.celery_app worker --loglevel=info --concurrency=2 --pool=solo -Q image_processing,default

timeout /t 3 /nobreak > nul

echo Starting FastAPI Server...
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

pause
