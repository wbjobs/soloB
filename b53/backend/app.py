from flask import Flask, request, jsonify
from flask_cors import CORS
import os
from dotenv import load_dotenv
import uuid

from upload_handler import UploadHandler
from database import (
    create_transcode_job,
    get_transcode_job,
    update_transcode_progress,
    complete_transcode_job,
    fail_transcode_job,
    list_recent_jobs,
    get_job_statistics
)

load_dotenv()

app = Flask(__name__)
CORS(app)

upload_handler = UploadHandler(
    aws_access_key=os.getenv('AWS_ACCESS_KEY_ID'),
    aws_secret_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
    bucket_name=os.getenv('AWS_S3_BUCKET'),
    region=os.getenv('AWS_REGION')
)

@app.route('/api/upload/initiate', methods=['POST'])
def initiate_upload():
    data = request.json
    filename = data.get('filename')
    file_size = data.get('file_size')
    mime_type = data.get('mime_type', 'video/mp4')

    if not filename or not file_size:
        return jsonify({'error': 'Filename and file_size are required'}), 400

    try:
        result = upload_handler.initiate_multipart_upload(filename, file_size, mime_type)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/upload/chunk', methods=['POST'])
def upload_chunk():
    upload_id = request.form.get('upload_id')
    part_number = request.form.get('part_number')
    key = request.form.get('key')
    chunk = request.files.get('chunk')

    if not all([upload_id, part_number, key, chunk]):
        return jsonify({'error': 'Missing required fields'}), 400

    try:
        part_number = int(part_number)
        result = upload_handler.upload_part(
            upload_id=upload_id,
            key=key,
            part_number=part_number,
            chunk_data=chunk.read()
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/upload/complete', methods=['POST'])
def complete_upload():
    data = request.json
    upload_id = data.get('upload_id')
    key = data.get('key')
    parts = data.get('parts')

    if not all([upload_id, key, parts]):
        return jsonify({'error': 'Missing required fields'}), 400

    try:
        result = upload_handler.complete_multipart_upload(
            upload_id=upload_id,
            key=key,
            parts=parts
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/files/<key>', methods=['GET'])
def get_file_url(key):
    try:
        url = upload_handler.get_presigned_url(key)
        return jsonify({'url': url, 'key': key})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/transcode/job/create', methods=['POST'])
def create_job():
    data = request.json
    filename = data.get('filename')
    original_size = data.get('original_size', 0)
    source_key = data.get('source_key')

    if not filename:
        return jsonify({'error': 'filename is required'}), 400

    try:
        job_id = str(uuid.uuid4())
        job = create_transcode_job(
            job_id=job_id,
            filename=filename,
            original_size=original_size,
            source_key=source_key
        )
        return jsonify(job)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/transcode/job/<job_id>', methods=['GET'])
def get_job(job_id):
    try:
        job = get_transcode_job(job_id)
        if not job:
            return jsonify({'error': 'Job not found'}), 404
        return jsonify(job)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/transcode/job/<job_id>/progress', methods=['POST'])
def update_progress(job_id):
    data = request.json
    progress = data.get('progress')
    status = data.get('status', 'processing')
    log = data.get('log')

    if progress is None:
        return jsonify({'error': 'progress is required'}), 400

    try:
        job = update_transcode_progress(
            job_id=job_id,
            progress=progress,
            status=status
        )
        if not job:
            return jsonify({'error': 'Job not found'}), 404

        if log:
            print(f"[Job {job_id}] Progress: {progress}% - {log}")

        return jsonify(job)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/transcode/job/<job_id>/complete', methods=['POST'])
def complete_job(job_id):
    data = request.json
    output_size = data.get('output_size', 0)
    output_key = data.get('output_key')

    try:
        job = complete_transcode_job(
            job_id=job_id,
            output_size=output_size,
            output_key=output_key
        )
        if not job:
            return jsonify({'error': 'Job not found'}), 404
        return jsonify(job)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/transcode/job/<job_id>/fail', methods=['POST'])
def fail_job(job_id):
    data = request.json
    error_message = data.get('error_message', 'Unknown error')

    try:
        job = fail_transcode_job(
            job_id=job_id,
            error_message=error_message
        )
        if not job:
            return jsonify({'error': 'Job not found'}), 404
        return jsonify(job)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/transcode/jobs', methods=['GET'])
def list_jobs():
    limit = request.args.get('limit', 20, type=int)
    try:
        jobs = list_recent_jobs(limit=limit)
        return jsonify({'jobs': jobs, 'count': len(jobs)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/transcode/stats', methods=['GET'])
def get_stats():
    try:
        stats = get_job_statistics()
        return jsonify(stats or {})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'healthy'})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
