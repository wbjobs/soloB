package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"dtsplatform/internal/config"

	"github.com/redis/go-redis/v9"
)

type RedisStore struct {
	client *redis.Client
}

func NewRedisStore(cfg *config.Config) (*RedisStore, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     cfg.Redis.Addr,
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
	})

	if err := client.Ping(context.Background()).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to redis: %w", err)
	}

	return &RedisStore{client: client}, nil
}

func (s *RedisStore) Close() error {
	if s.client != nil {
		return s.client.Close()
	}
	return nil
}

func (s *RedisStore) SetTaskStatus(ctx context.Context, taskID string, status any, ttl time.Duration) error {
	data, err := json.Marshal(status)
	if err != nil {
		return err
	}
	return s.client.Set(ctx, fmt.Sprintf("task:%s:status", taskID), data, ttl).Err()
}

func (s *RedisStore) GetTaskStatus(ctx context.Context, taskID string, dest any) error {
	data, err := s.client.Get(ctx, fmt.Sprintf("task:%s:status", taskID)).Bytes()
	if err != nil {
		return err
	}
	return json.Unmarshal(data, dest)
}

func (s *RedisStore) DeleteTaskStatus(ctx context.Context, taskID string) error {
	return s.client.Del(ctx, fmt.Sprintf("task:%s:status", taskID)).Err()
}

func (s *RedisStore) AcquireLock(ctx context.Context, key string, value string, ttl time.Duration) (bool, error) {
	return s.client.SetNX(ctx, fmt.Sprintf("lock:%s", key), value, ttl).Result()
}

func (s *RedisStore) ReleaseLock(ctx context.Context, key string) error {
	return s.client.Del(ctx, fmt.Sprintf("lock:%s", key)).Err()
}

func (s *RedisStore) RateLimit(ctx context.Context, key string, limit int, window time.Duration) (bool, int, error) {
	pipe := s.client.TxPipeline()
	counterKey := fmt.Sprintf("rate:%s", key)

	incr := pipe.Incr(ctx, counterKey)
	pipe.Expire(ctx, counterKey, window)

	_, err := pipe.Exec(ctx)
	if err != nil {
		return false, 0, err
	}

	count := incr.Val()
	allowed := count <= int64(limit)

	return allowed, int(count), nil
}

func (s *RedisStore) CacheJob(ctx context.Context, jobID string, data any, ttl time.Duration) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return s.client.Set(ctx, fmt.Sprintf("job:%s", jobID), jsonData, ttl).Err()
}

func (s *RedisStore) GetCachedJob(ctx context.Context, jobID string, dest any) error {
	data, err := s.client.Get(ctx, fmt.Sprintf("job:%s", jobID)).Bytes()
	if err != nil {
		return err
	}
	return json.Unmarshal(data, dest)
}

func (s *RedisStore) InvalidateJobCache(ctx context.Context, jobID string) error {
	return s.client.Del(ctx, fmt.Sprintf("job:%s", jobID)).Err()
}

func (s *RedisStore) Publish(ctx context.Context, channel string, message any) error {
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}
	return s.client.Publish(ctx, channel, data).Err()
}

func (s *RedisStore) Subscribe(ctx context.Context, channels ...string) *redis.PubSub {
	return s.client.Subscribe(ctx, channels...)
}
