package storage

import (
	"context"
	"fmt"

	"github.com/go-redis/redis/v9"
)

const (
	eventKeyPrefix     = "user_events:"
	eventTypeKeyPrefix = "events_by_type:"
)

type RedisStore struct {
	client *redis.Client
}

func NewRedisStore(addr, password string, db int) *RedisStore {
	client := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})
	return &RedisStore{client: client}
}

func (s *RedisStore) Close() error {
	return s.client.Close()
}

func (s *RedisStore) Ping(ctx context.Context) error {
	return s.client.Ping(ctx).Err()
}

func (s *RedisStore) AddEvent(ctx context.Context, userID, eventName string, timestamp int64) error {
	pipe := s.client.TxPipeline()

	userKey := fmt.Sprintf("%s%s", eventKeyPrefix, userID)
	userMember := fmt.Sprintf("%d:%s", timestamp, eventName)
	pipe.ZAdd(ctx, userKey, redis.Z{
		Score:  float64(timestamp),
		Member: userMember,
	})

	eventKey := fmt.Sprintf("%s%s", eventTypeKeyPrefix, eventName)
	eventMember := fmt.Sprintf("%s:%d", userID, timestamp)
	pipe.ZAdd(ctx, eventKey, redis.Z{
		Score:  float64(timestamp),
		Member: eventMember,
	})

	_, err := pipe.Exec(ctx)
	return err
}

type EventRecord struct {
	UserID    string
	Timestamp int64
}

func (s *RedisStore) GetEventUsersInRange(ctx context.Context, eventName string, startTime, endTime int64) ([]EventRecord, error) {
	key := fmt.Sprintf("%s%s", eventTypeKeyPrefix, eventName)
	results, err := s.client.ZRangeByScore(ctx, key, &redis.ZRangeBy{
		Min: fmt.Sprintf("%d", startTime),
		Max: fmt.Sprintf("%d", endTime),
	}).Result()
	if err != nil {
		return nil, err
	}

	records := make([]EventRecord, 0, len(results))
	for _, result := range results {
		record, ok := parseEventRecord(result)
		if ok {
			records = append(records, record)
		}
	}
	return records, nil
}

func (s *RedisStore) ScanAllUserIDs(ctx context.Context) ([]string, error) {
	var userIDs []string
	pattern := fmt.Sprintf("%s*", eventKeyPrefix)
	iter := s.client.Scan(ctx, 0, pattern, 0).Iterator()
	for iter.Next(ctx) {
		key := iter.Val()
		if len(key) > len(eventKeyPrefix) {
			userID := key[len(eventKeyPrefix):]
			userIDs = append(userIDs, userID)
		}
	}
	return userIDs, iter.Err()
}

type UserEvent struct {
	Timestamp int64
	EventName string
}

func (s *RedisStore) GetUserEventsInRange(ctx context.Context, userID string, startTime, endTime int64) ([]UserEvent, error) {
	key := fmt.Sprintf("%s%s", eventKeyPrefix, userID)
	results, err := s.client.ZRangeByScore(ctx, key, &redis.ZRangeBy{
		Min: fmt.Sprintf("%d", startTime),
		Max: fmt.Sprintf("%d", endTime),
	}).Result()
	if err != nil {
		return nil, err
	}

	events := make([]UserEvent, 0, len(results))
	for _, result := range results {
		event, ok := parseEvent(result)
		if ok {
			events = append(events, event)
		}
	}
	return events, nil
}

func parseEvent(member string) (UserEvent, bool) {
	var ts int64
	var name string
	_, err := fmt.Sscanf(member, "%d:%s", &ts, &name)
	if err != nil {
		return UserEvent{}, false
	}
	return UserEvent{Timestamp: ts, EventName: name}, true
}

func parseEventRecord(member string) (EventRecord, bool) {
	lastColon := -1
	for i := len(member) - 1; i >= 0; i-- {
		if member[i] == ':' {
			lastColon = i
			break
		}
	}
	if lastColon == -1 || lastColon == len(member)-1 {
		return EventRecord{}, false
	}

	userID := member[:lastColon]
	tsStr := member[lastColon+1:]
	var ts int64
	_, err := fmt.Sscanf(tsStr, "%d", &ts)
	if err != nil {
		return EventRecord{}, false
	}
	return EventRecord{UserID: userID, Timestamp: ts}, true
}
