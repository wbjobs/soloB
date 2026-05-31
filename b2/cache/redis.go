package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"k8s-metrics-recommender/config"
	"k8s-metrics-recommender/models"

	"github.com/redis/go-redis/v9"
)

var RDB *redis.Client
var TTL time.Duration

func Connect(cfg *config.RedisConfig) error {
	RDB = redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:%d", cfg.Host, cfg.Port),
		Password: cfg.Password,
		DB:       cfg.DB,
	})

	TTL = time.Duration(cfg.TTLSeconds) * time.Second

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := RDB.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("failed to connect to redis: %w", err)
	}

	return nil
}

func buildCacheKey(namespace, workloadName string, workloadType models.WorkloadType) string {
	return fmt.Sprintf("recommend:%s:%s:%s", workloadType, namespace, workloadName)
}

func GetRecommendation(ctx context.Context, namespace, workloadName string, workloadType models.WorkloadType) (*models.RecommendationResponse, bool, error) {
	key := buildCacheKey(namespace, workloadName, workloadType)

	data, err := RDB.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("failed to get from cache: %w", err)
	}

	var resp models.RecommendationResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, false, fmt.Errorf("failed to unmarshal cache data: %w", err)
	}

	return &resp, true, nil
}

func SetRecommendation(ctx context.Context, namespace, workloadName string, workloadType models.WorkloadType, resp *models.RecommendationResponse) error {
	key := buildCacheKey(namespace, workloadName, workloadType)

	data, err := json.Marshal(resp)
	if err != nil {
		return fmt.Errorf("failed to marshal cache data: %w", err)
	}

	if err := RDB.Set(ctx, key, data, TTL).Err(); err != nil {
		return fmt.Errorf("failed to set cache: %w", err)
	}

	return nil
}

func InvalidateRecommendation(ctx context.Context, namespace, workloadName string, workloadType models.WorkloadType) error {
	key := buildCacheKey(namespace, workloadName, workloadType)
	if err := RDB.Del(ctx, key).Err(); err != nil {
		return fmt.Errorf("failed to invalidate cache: %w", err)
	}
	return nil
}

func InvalidateNamespace(ctx context.Context, namespace string) error {
	pattern := fmt.Sprintf("recommend:*:%s:*", namespace)
	return invalidateByPattern(ctx, pattern)
}

func InvalidateAll(ctx context.Context) error {
	pattern := "recommend:*"
	return invalidateByPattern(ctx, pattern)
}

func invalidateByPattern(ctx context.Context, pattern string) error {
	var cursor uint64
	for {
		keys, newCursor, err := RDB.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			return fmt.Errorf("failed to scan keys: %w", err)
		}

		if len(keys) > 0 {
			if err := RDB.Del(ctx, keys...).Err(); err != nil {
				return fmt.Errorf("failed to delete keys: %w", err)
			}
		}

		cursor = newCursor
		if cursor == 0 {
			break
		}
	}
	return nil
}
