package store

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"path"
	"time"

	"dtsplatform/internal/config"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type MinioStore struct {
	client *minio.Client
	bucket string
}

func NewMinioStore(cfg *config.Config) (*MinioStore, error) {
	client, err := minio.New(cfg.Minio.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.Minio.AccessKey, cfg.Minio.SecretKey, ""),
		Secure: cfg.Minio.SSL,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create minio client: %w", err)
	}

	store := &MinioStore{
		client: client,
		bucket: cfg.Minio.Bucket,
	}

	if err := store.ensureBucket(context.Background()); err != nil {
		return nil, err
	}

	return store, nil
}

func (s *MinioStore) ensureBucket(ctx context.Context) error {
	exists, err := s.client.BucketExists(ctx, s.bucket)
	if err != nil {
		return err
	}
	if !exists {
		err = s.client.MakeBucket(ctx, s.bucket, minio.MakeBucketOptions{})
		if err != nil {
			return fmt.Errorf("failed to create bucket: %w", err)
		}
	}
	return nil
}

func (s *MinioStore) SaveTaskLog(ctx context.Context, taskID, execID, executorID string, shardIndex int, data []byte) (string, error) {
	timestamp := time.Now().UnixNano()
	var filename string
	if shardIndex >= 0 {
		filename = fmt.Sprintf("%s-shard-%d-executor-%s-%d.log", taskID, shardIndex, executorID, timestamp)
	} else {
		filename = fmt.Sprintf("%s-executor-%s-%d.log", taskID, executorID, timestamp)
	}

	objectKey := path.Join("logs", execID, filename)

	_, err := s.client.PutObject(ctx, s.bucket, objectKey,
		bytes.NewReader(data), int64(len(data)),
		minio.PutObjectOptions{ContentType: "text/plain"})

	if err != nil {
		return "", err
	}

	return objectKey, nil
}

func (s *MinioStore) GetTaskLog(ctx context.Context, objectKey string) ([]byte, error) {
	obj, err := s.client.GetObject(ctx, s.bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	defer obj.Close()

	return io.ReadAll(obj)
}

func (s *MinioStore) SaveArtifact(ctx context.Context, taskID, execID, artifactName string, data []byte) (string, error) {
	objectKey := path.Join("artifacts", execID, taskID, artifactName)

	_, err := s.client.PutObject(ctx, s.bucket, objectKey,
		bytes.NewReader(data), int64(len(data)),
		minio.PutObjectOptions{})

	if err != nil {
		return "", err
	}

	return objectKey, nil
}

func (s *MinioStore) GetArtifact(ctx context.Context, objectKey string) ([]byte, error) {
	obj, err := s.client.GetObject(ctx, s.bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	defer obj.Close()

	return io.ReadAll(obj)
}

func (s *MinioStore) ListArtifacts(ctx context.Context, execID, taskID string) ([]string, error) {
	prefix := path.Join("artifacts", execID, taskID)
	objects := s.client.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	})

	var keys []string
	for obj := range objects {
		if obj.Err != nil {
			return nil, obj.Err
		}
		keys = append(keys, obj.Key)
	}

	return keys, nil
}

func (s *MinioStore) GetPresignedURL(ctx context.Context, objectKey string, expires time.Duration) (string, error) {
	reqParams := make(map[string]string)
	presignedURL, err := s.client.PresignedGetObject(ctx, s.bucket, objectKey, expires, reqParams)
	if err != nil {
		return "", err
	}
	return presignedURL.String(), nil
}

func (s *MinioStore) DeleteObject(ctx context.Context, objectKey string) error {
	return s.client.RemoveObject(ctx, s.bucket, objectKey, minio.RemoveObjectOptions{})
}
