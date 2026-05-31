import boto3
from botocore.exceptions import ClientError
import uuid
import os
from datetime import datetime, timedelta


class UploadHandler:
    def __init__(self, aws_access_key, aws_secret_key, bucket_name, region='us-east-1'):
        self.bucket_name = bucket_name
        self.region = region
        self.s3_client = boto3.client(
            's3',
            aws_access_key_id=aws_access_key,
            aws_secret_access_key=aws_secret_key,
            region_name=region
        )
        self.chunk_size = 5 * 1024 * 1024

    def _generate_unique_key(self, filename):
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        random_id = str(uuid.uuid4())[:8]
        _, ext = os.path.splitext(filename)
        return f"uploads/{timestamp}_{random_id}{ext}"

    def initiate_multipart_upload(self, filename, file_size, mime_type='video/mp4'):
        key = self._generate_unique_key(filename)

        try:
            response = self.s3_client.create_multipart_upload(
                Bucket=self.bucket_name,
                Key=key,
                ContentType=mime_type
            )

            upload_id = response['UploadId']
            total_parts = (file_size + self.chunk_size - 1) // self.chunk_size

            presigned_urls = []
            for part_number in range(1, total_parts + 1):
                url = self.s3_client.generate_presigned_url(
                    ClientMethod='upload_part',
                    Params={
                        'Bucket': self.bucket_name,
                        'Key': key,
                        'UploadId': upload_id,
                        'PartNumber': part_number
                    },
                    ExpiresIn=3600
                )
                presigned_urls.append({
                    'part_number': part_number,
                    'url': url
                })

            return {
                'upload_id': upload_id,
                'key': key,
                'chunk_size': self.chunk_size,
                'total_parts': total_parts,
                'presigned_urls': presigned_urls
            }

        except ClientError as e:
            raise Exception(f"Failed to initiate multipart upload: {str(e)}")

    def upload_part(self, upload_id, key, part_number, chunk_data):
        try:
            response = self.s3_client.upload_part(
                Bucket=self.bucket_name,
                Key=key,
                PartNumber=part_number,
                UploadId=upload_id,
                Body=chunk_data
            )

            return {
                'part_number': part_number,
                'etag': response['ETag'].strip('"')
            }

        except ClientError as e:
            raise Exception(f"Failed to upload part {part_number}: {str(e)}")

    def complete_multipart_upload(self, upload_id, key, parts):
        sorted_parts = sorted(parts, key=lambda x: x['PartNumber'])

        try:
            response = self.s3_client.complete_multipart_upload(
                Bucket=self.bucket_name,
                Key=key,
                UploadId=upload_id,
                MultipartUpload={
                    'Parts': [
                        {
                            'PartNumber': part['PartNumber'],
                            'ETag': f'"{part["ETag"]}"'
                        }
                        for part in sorted_parts
                    ]
                }
            )

            return {
                'success': True,
                'key': key,
                'location': response.get('Location'),
                'etag': response.get('ETag')
            }

        except ClientError as e:
            raise Exception(f"Failed to complete multipart upload: {str(e)}")

    def abort_multipart_upload(self, upload_id, key):
        try:
            self.s3_client.abort_multipart_upload(
                Bucket=self.bucket_name,
                Key=key,
                UploadId=upload_id
            )
            return {'success': True}
        except ClientError as e:
            raise Exception(f"Failed to abort multipart upload: {str(e)}")

    def get_presigned_url(self, key, expires_in=3600):
        try:
            url = self.s3_client.generate_presigned_url(
                ClientMethod='get_object',
                Params={
                    'Bucket': self.bucket_name,
                    'Key': key
                },
                ExpiresIn=expires_in
            )
            return url
        except ClientError as e:
            raise Exception(f"Failed to get presigned URL: {str(e)}")

    def list_uploads(self, prefix='uploads/'):
        try:
            response = self.s3_client.list_multipart_uploads(
                Bucket=self.bucket_name,
                Prefix=prefix
            )
            return response.get('Uploads', [])
        except ClientError as e:
            raise Exception(f"Failed to list multipart uploads: {str(e)}")
