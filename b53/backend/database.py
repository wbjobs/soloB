import sqlite3
import os
import json
from datetime import datetime
from contextlib import contextmanager

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'video_transcoder.db')


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


@contextmanager
def get_db_cursor():
    conn = get_db()
    try:
        yield conn.cursor()
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with get_db_cursor() as cursor:
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS transcode_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT UNIQUE NOT NULL,
                filename TEXT NOT NULL,
                original_size INTEGER DEFAULT 0,
                output_size INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                progress INTEGER DEFAULT 0,
                source_key TEXT,
                output_key TEXT,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP
            )
        ''')

        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_transcode_jobs_job_id 
            ON transcode_jobs(job_id)
        ''')

        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_transcode_jobs_status 
            ON transcode_jobs(status)
        ''')

        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_transcode_jobs_created_at 
            ON transcode_jobs(created_at)
        ''')


def create_transcode_job(job_id, filename, original_size=0, source_key=None):
    with get_db_cursor() as cursor:
        cursor.execute('''
            INSERT INTO transcode_jobs 
            (job_id, filename, original_size, source_key, status, progress)
            VALUES (?, ?, ?, ?, 'pending', 0)
        ''', (job_id, filename, original_size, source_key))
        return get_transcode_job(job_id)


def get_transcode_job(job_id):
    with get_db_cursor() as cursor:
        cursor.execute('''
            SELECT * FROM transcode_jobs WHERE job_id = ?
        ''', (job_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


def update_transcode_progress(job_id, progress, status='processing'):
    with get_db_cursor() as cursor:
        cursor.execute('''
            UPDATE transcode_jobs 
            SET progress = ?, 
                status = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE job_id = ?
        ''', (int(progress), status, job_id))
        return get_transcode_job(job_id)


def complete_transcode_job(job_id, output_size=0, output_key=None):
    with get_db_cursor() as cursor:
        cursor.execute('''
            UPDATE transcode_jobs 
            SET progress = 100,
                status = 'completed',
                output_size = ?,
                output_key = ?,
                updated_at = CURRENT_TIMESTAMP,
                completed_at = CURRENT_TIMESTAMP
            WHERE job_id = ?
        ''', (output_size, output_key, job_id))
        return get_transcode_job(job_id)


def fail_transcode_job(job_id, error_message):
    with get_db_cursor() as cursor:
        cursor.execute('''
            UPDATE transcode_jobs 
            SET status = 'failed',
                error_message = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE job_id = ?
        ''', (error_message, job_id))
        return get_transcode_job(job_id)


def list_recent_jobs(limit=20):
    with get_db_cursor() as cursor:
        cursor.execute('''
            SELECT * FROM transcode_jobs 
            ORDER BY created_at DESC 
            LIMIT ?
        ''', (limit,))
        rows = cursor.fetchall()
        return [dict(row) for row in rows]


def get_job_statistics():
    with get_db_cursor() as cursor:
        cursor.execute('''
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                AVG(original_size) as avg_original_size,
                AVG(output_size) as avg_output_size
            FROM transcode_jobs
        ''')
        row = cursor.fetchone()
        return dict(row) if row else None


init_db()
