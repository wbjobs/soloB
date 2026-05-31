package service

import (
	"context"
	"math"
	"time"

	"funnelservice/internal/model"
	"funnelservice/internal/storage"
)

type EventService struct {
	store *storage.RedisStore
}

func NewEventService(store *storage.RedisStore) *EventService {
	return &EventService{store: store}
}

func (s *EventService) RecordEvent(ctx context.Context, event *model.Event) error {
	return s.store.AddEvent(ctx, event.UserID, event.EventName, event.Timestamp)
}

func (s *EventService) CalculateFunnel(ctx context.Context, req *model.FunnelRequest) (*model.FunnelResponse, error) {
	events, err := normalizeFunnelEvents(req)
	if err != nil {
		return nil, err
	}

	if len(events) < 2 {
		return &model.FunnelResponse{
			WindowMinutes: req.WindowMinutes,
			Events:        events,
			Steps:         []model.FunnelStep{},
			TotalUsers:    0,
			FinalUsers:    0,
			OverallRate:   0,
		}, nil
	}

	now := time.Now().Unix()
	windowStart := now - req.WindowMinutes*60

	eventMaps, err := s.loadEventTimestamps(ctx, events, windowStart, now)
	if err != nil {
		return nil, err
	}

	steps := make([]model.FunnelStep, 0, len(events)-1)
	var activeUsers map[string]int64
	var totalUsers int64
	var finalUsers int64

	for i := 0; i < len(events)-1; i++ {
		fromEvent := events[i]
		toEvent := events[i+1]
		fromMap := eventMaps[fromEvent]
		toMap := eventMaps[toEvent]

		if activeUsers == nil {
			activeUsers = fromMap
		}

		var fromCount int64
		var toCount int64
		nextActive := make(map[string]int64)

		for userID, fromTs := range activeUsers {
			fromCount++
			if toTs, ok := toMap[userID]; ok && toTs > fromTs {
				toCount++
				nextActive[userID] = toTs
			}
		}

		rate := 0.0
		if fromCount > 0 {
			rate = float64(toCount) / float64(fromCount)
		}

		steps = append(steps, model.FunnelStep{
			FromEvent:      fromEvent,
			ToEvent:        toEvent,
			StepIndex:      i + 1,
			FromUsers:      fromCount,
			ToUsers:        toCount,
			ConversionRate: rate,
		})

		activeUsers = nextActive

		if i == 0 {
			totalUsers = fromCount
		}
		if i == len(events)-2 {
			finalUsers = toCount
		}
	}

	overallRate := 0.0
	if totalUsers > 0 {
		overallRate = float64(finalUsers) / float64(totalUsers)
	}

	return &model.FunnelResponse{
		WindowMinutes: req.WindowMinutes,
		Events:        events,
		Steps:         steps,
		TotalUsers:    totalUsers,
		FinalUsers:    finalUsers,
		OverallRate:   overallRate,
	}, nil
}

func (s *EventService) loadEventTimestamps(ctx context.Context, events []string, startTime, endTime int64) (map[string]map[string]int64, error) {
	eventMaps := make(map[string]map[string]int64)

	for _, eventName := range events {
		records, err := s.store.GetEventUsersInRange(ctx, eventName, startTime, endTime)
		if err != nil {
			return nil, err
		}
		eventMaps[eventName] = buildEarliestTimestampMap(records)
	}

	return eventMaps, nil
}

func normalizeFunnelEvents(req *model.FunnelRequest) ([]string, error) {
	if len(req.Events) > 0 {
		return req.Events, nil
	}

	if req.StartEvent != "" && req.EndEvent != "" {
		return []string{req.StartEvent, req.EndEvent}, nil
	}

	return []string{}, nil
}

func buildEarliestTimestampMap(records []storage.EventRecord) map[string]int64 {
	userMap := make(map[string]int64)
	for _, record := range records {
		if existing, ok := userMap[record.UserID]; !ok || record.Timestamp < existing {
			userMap[record.UserID] = record.Timestamp
		}
	}
	return userMap
}

func checkFunnelPath(events []storage.UserEvent, startEvent, endEvent string) (bool, bool) {
	var foundStart bool
	var foundConvert bool
	var startTs int64 = math.MaxInt64
	var endTs int64 = math.MaxInt64

	for _, evt := range events {
		if evt.EventName == startEvent {
			if evt.Timestamp < startTs {
				startTs = evt.Timestamp
				foundStart = true
			}
			continue
		}
		if evt.EventName == endEvent && evt.Timestamp < endTs {
			endTs = evt.Timestamp
		}
	}

	if foundStart && endTs < math.MaxInt64 && endTs > startTs {
		foundConvert = true
	}

	return foundStart, foundConvert
}
