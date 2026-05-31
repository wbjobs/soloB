#!/bin/bash
echo "Starting Celery Worker..."
celery -A tasks worker --loglevel=info
