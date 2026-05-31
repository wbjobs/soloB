@echo off
echo Starting Celery Worker...
celery -A tasks worker --loglevel=info --pool=solo
pause
