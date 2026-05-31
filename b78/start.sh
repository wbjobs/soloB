#!/bin/bash

echo "Starting Satellite Cloud Removal Service..."

mkdir -p uploads results

if [ -f .env ]; then
    export $(cat .env | xargs)
fi

echo "Starting Redis..."
redis-server --daemonize yes

sleep 2

echo Starting Celery Worker...
celery -A celery_worker.celery_app worker --loglevel=info --concurrency=2 -Q image_processing,default &

CELERY_PID=$!

sleep 3

echo "Starting FastAPI Server..."
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

wait $CELERY_PID
