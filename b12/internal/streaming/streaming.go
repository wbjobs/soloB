package streaming

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"dtsplatform/api/proto"
	"dtsplatform/internal/config"

	"github.com/segmentio/kafka-go"
)

type StreamManager struct {
	cfg       *config.Config
	pipelines map[string]*Pipeline
	pipelineMu sync.RWMutex
	running    bool
}

type Pipeline struct {
	ID              string
	Name            string
	SourceTopic     string
	TargetTopic     string
	Transform       *streaming.TransformSpec
	Window          *streaming.WindowSpec
	ExactlyOnce     *streaming.ExactlyOnceSpec
	Status          string
	Consumer        *kafka.Reader
	Producer        *kafka.Writer
	Windows         map[string]*WindowState
	WindowsMu       sync.RWMutex
	Ctx             context.Context
	Cancel          context.CancelFunc
	Stats           *PipelineStats
	useTransactions bool
}

type PipelineStats struct {
	MessagesProcessed int64
	MessagesProduced  int64
	Errors           int64
}

type WindowState struct {
	Type       string
	Key        string
	Start      time.Time
	End        time.Time
	Data       []map[string]any
	LastAccess time.Time
}

type WindowType string

const (
	WindowTypeTumbling WindowType = "tumbling"
	WindowTypeSliding  WindowType = "sliding"
	WindowTypeSession  WindowType = "session"
)

func NewStreamManager(cfg *config.Config) *StreamManager {
	return &StreamManager{
		cfg:       cfg,
		pipelines: make(map[string]*Pipeline),
	}
}

func (sm *StreamManager) Start(ctx context.Context) error {
	sm.running = true
	log.Println("Streaming service started")
	<-ctx.Done()
	sm.Stop()
	return nil
}

func (sm *StreamManager) Stop() {
	sm.running = false
	sm.pipelineMu.Lock()
	defer sm.pipelineMu.Unlock()
	for id, p := range sm.pipelines {
		if p.Status == "running" {
			p.Cancel()
		}
		sm.stopPipeline(id)
	}
}

func (sm *StreamManager) CreatePipeline(ctx context.Context, req *streaming.CreateStreamPipelineRequest) (string, error) {
	sm.pipelineMu.Lock()
	defer sm.pipelineMu.Unlock()

	pipelineID := generatePipelineID()
	p := &Pipeline{
		ID:          pipelineID,
		Name:        req.Name,
		SourceTopic: req.SourceTopic,
		TargetTopic: req.TargetTopic,
		Transform:   req.Transform,
		Window:      req.Window,
		ExactlyOnce: req.ExactlyOnce,
		Status:     "stopped",
		Windows:     make(map[string]*WindowState),
		Stats:       &PipelineStats{},
	}

	sm.pipelines[pipelineID] = p
	log.Printf("Pipeline created: %s (topic: %s -> %s", pipelineID, req.SourceTopic, req.TargetTopic)

	return pipelineID, nil
}

func (sm *StreamManager) StartPipeline(ctx context.Context, pipelineID string) error {
	sm.pipelineMu.Lock()
	defer sm.pipelineMu.Unlock()

	p, exists := sm.pipelines[pipelineID]
	if !exists {
		return fmt.Errorf("pipeline not found")
	}

	if p.Status == "running" {
		return nil
	}

	useExactlyOnce := p.ExactlyOnce != nil && p.ExactlyOnce.Enabled
	p.useTransactions = useExactlyOnce

	consumerConfig := kafka.ReaderConfig{
		Brokers:     sm.cfg.Streaming.KafkaBrokers,
		Topic:        p.SourceTopic,
		GroupID:      sm.cfg.Streaming.ConsumerGroup + "-" + p.ID,
		MinBytes:    10e3,
		MaxBytes:    10e6,
		MaxWait:     1 * time.Second,
		StartOffset: kafka.FirstOffset,
	}

	if useExactlyOnce {
		consumerConfig.IsolationLevel = kafka.ReadCommitted
		consumerConfig.CommitInterval = -1
	}

	p.Consumer = kafka.NewReader(consumerConfig)

	producerConfig := kafka.WriterConfig{
		Brokers: sm.cfg.Streaming.KafkaBrokers,
		Topic:   p.TargetTopic,
	}

	if useExactlyOnce {
		producerConfig.RequiredAcks = kafka.RequireAll
		producerConfig.Async = false
		producerConfig.BatchTimeout = 10 * time.Millisecond
	}

	p.Producer = kafka.NewWriter(producerConfig)

	p.Ctx, p.Cancel = context.WithCancel(context.Background())
	p.Status = "running"

	go sm.runPipeline(p)

	log.Printf("Pipeline started: %s (exactly-once: %v)", pipelineID, useExactlyOnce)
	return nil
}

func (sm *StreamManager) runPipeline(p *Pipeline) {
	maxRetries := 3
	retryDelay := 500 * time.Millisecond

	for {
		select {
		case <-p.Ctx.Done():
			return
		default:
			msg, err := p.Consumer.FetchMessage(p.Ctx)
			if err != nil {
				if p.Ctx.Err() != nil {
					return
				}
				log.Printf("Pipeline %s fetch error: %v", p.ID, err)
				p.Stats.Errors++
				time.Sleep(1 * time.Second)
				continue
			}

			processed := false
			for attempt := 0; attempt < maxRetries && !processed; attempt++ {
				if attempt > 0 {
					time.Sleep(retryDelay * time.Duration(attempt))
				}

				transformed, err := sm.transformMessage(p, msg.Value)
				if err != nil {
					log.Printf("Pipeline %s transform error: %v", p.ID, err)
					p.Stats.Errors++
					continue
				}

				shouldSend := true
				if p.Window != nil && p.Window.Type != "" {
					transformed, err = sm.applyWindow(p, msg, transformed)
					if err != nil {
						log.Printf("Pipeline %s window error: %v", p.ID, err)
						p.Stats.Errors++
						continue
					}
					if transformed == nil {
						shouldSend = false
					}
				}

				if shouldSend {
					err = p.Producer.WriteMessages(p.Ctx, kafka.Message{
						Key:   msg.Key,
						Value: transformed,
					})
					if err != nil {
						log.Printf("Pipeline %s write error (attempt %d/%d): %v",
							p.ID, attempt+1, maxRetries, err)
						p.Stats.Errors++
						continue
					}
					p.Stats.MessagesProduced++
				}

				if p.useTransactions {
					if commitErr := p.Consumer.CommitMessages(p.Ctx, msg); commitErr != nil {
						log.Printf("Pipeline %s commit error: %v", p.ID, commitErr)
						continue
					}
				}

				p.Stats.MessagesProcessed++
				processed = true
			}

			if !processed && !p.useTransactions {
				log.Printf("Pipeline %s message processing failed after %d retries, continuing", p.ID, maxRetries)
			}
		}
	}
}

func (sm *StreamManager) transformMessage(p *Pipeline, data []byte) ([]byte, error) {
	if p.Transform == nil || p.Transform.Type == "" {
		return data, nil
	}

	switch p.Transform.Type {
	case "passthrough":
		return data, nil
	case "json_filter":
		var msg map[string]any
		if err := json.Unmarshal(data, &msg); err != nil {
			return nil, err
		}
		return json.Marshal(msg)
	case "json_map":
		var msg map[string]any
		if err := json.Unmarshal(data, &msg); err != nil {
			return nil, err
		}
		msg["_processed_at"] = time.Now().Unix()
		msg["_pipeline_id"] = p.ID
		return json.Marshal(msg)
	default:
		return data, nil
	}
}

func (sm *StreamManager) applyWindow(p *Pipeline, msg kafka.Message, data []byte) ([]byte, error) {
	windowSize := time.Duration(p.Window.SizeMs) * time.Millisecond
	windowSlide := time.Duration(p.Window.SlideMs) * time.Millisecond
	windowGap := time.Duration(p.Window.GapMs) * time.Millisecond

	key := string(msg.Key)
	if key == "" {
		key = "default"
	}

	p.WindowsMu.Lock()
	defer p.WindowsMu.Unlock()

	switch WindowType(p.Window.Type) {
	case WindowTypeTumbling:
		return sm.processTumblingWindow(p, key, data, windowSize)
	case WindowTypeSliding:
		return sm.processSlidingWindow(p, key, data, windowSize, windowSlide)
	case WindowTypeSession:
		return sm.processSessionWindow(p, key, data, windowGap)
	default:
		return data, nil
	}
}

func (sm *StreamManager) processTumblingWindow(p *Pipeline, key string, data []byte, size time.Duration) ([]byte, error) {
	now := time.Now()
	windowStart := now.Truncate(size)
	windowKey := key + ":" + windowStart.String()

	if ws, exists := p.Windows[windowKey]; exists {
		ws.LastAccess = now
		var item map[string]any
		json.Unmarshal(data, &item)
		ws.Data = append(ws.Data, item)

		if now.Sub(windowStart) >= size {
			aggregated := aggregateWindow(ws.Data)
			delete(p.Windows, windowKey)
			return json.Marshal(aggregated)
		}
	} else {
		var item map[string]any
		json.Unmarshal(data, &item)
		p.Windows[windowKey] = &WindowState{
			Type:       "tumbling",
			Key:        key,
			Start:      windowStart,
			End:        windowStart.Add(size),
			Data:       []map[string]any{item},
			LastAccess: now,
		}
	}

	return nil, nil
}

func (sm *StreamManager) processSlidingWindow(p *Pipeline, key string, data []byte, size, slide time.Duration) ([]byte, error) {
	now := time.Now()
	var emitTime := now.Truncate(slide)

	for k, ws := range p.Windows {
		if now.Sub(ws.End) > 0 {
			aggregated := aggregateWindow(ws.Data)
			delete(p.Windows, k)
			return json.Marshal(aggregated)
		}
	}

	windowKey := key + ":" + emitTime.String()
	if ws, exists := p.Windows[windowKey]; exists {
		ws.LastAccess = now
		var item map[string]any
		json.Unmarshal(data, &item)
		ws.Data = append(ws.Data, item)
	} else {
		var item map[string]any
		json.Unmarshal(data, &item)
		p.Windows[windowKey] = &WindowState{
			Type:       "sliding",
			Key:        key,
			Start:      now,
			End:        now.Add(size),
			Data:       []map[string]any{item},
			LastAccess: now,
		}
	}

	return nil, nil
}

func (sm *StreamManager) processSessionWindow(p *Pipeline, key string, data []byte, gap time.Duration) ([]byte, error) {
	now := time.Now()

	if ws, exists := p.Windows[key]; exists {
		if now.Sub(ws.LastAccess) > gap {
			aggregated := aggregateWindow(ws.Data)
			delete(p.Windows, key)
			var item map[string]any
			json.Unmarshal(data, &item)
			p.Windows[key] = &WindowState{
				Type:       "session",
				Key:        key,
				Start:      now,
				Data:       []map[string]any{item},
				LastAccess: now,
			}
			return json.Marshal(aggregated)
		}

		ws.LastAccess = now
		var item map[string]any
		json.Unmarshal(data, &item)
		ws.Data = append(ws.Data, item)
	} else {
		var item map[string]any
		json.Unmarshal(data, &item)
		p.Windows[key] = &WindowState{
			Type:       "session",
			Key:        key,
			Start:      now,
			Data:       []map[string]any{item},
			LastAccess: now,
		}
	}

	return nil, nil
}

func aggregateWindow(data []map[string]any) map[string]any {
	result := make(map[string]any)
	result["count"] = len(data)

	if len(data) == 0 {
		return result
	}

	sums := make(map[string]float64)
	mins := make(map[string]float64)
	maxs := make(map[string]float64)

	for _, item := range data {
		for k, v := range item {
			if num, ok := v.(float64); ok {
				sums[k] += num
				if _, exists := mins[k]; !exists || num < mins[k] {
					mins[k] = num
				}
				if _, exists := maxs[k]; !exists || num > maxs[k] {
					maxs[k] = num
				}
			}
		}
	}

	for k, sum := range sums {
		result[k+"_sum"] = sum
		result[k+"_avg"] = sum / float64(len(data))
		result[k+"_min"] = mins[k]
		result[k+"_max"] = maxs[k]
	}

	return result
}

func (sm *StreamManager) StopPipeline(ctx context.Context, pipelineID string) error {
	sm.pipelineMu.Lock()
	defer sm.pipelineMu.Unlock()

	if err := sm.stopPipeline(pipelineID); err != nil {
		return err
	}

	log.Printf("Pipeline stopped: %s", pipelineID)
	return nil
}

func (sm *StreamManager) stopPipeline(pipelineID string) error {
	p, exists := sm.pipelines[pipelineID]
	if !exists {
		return fmt.Errorf("pipeline not found")
	}

	if p.Cancel != nil {
		p.Cancel()
	}

	if p.Consumer != nil {
		p.Consumer.Close()
	}
	if p.Producer != nil {
		p.Producer.Close()
	}

	p.Status = "stopped"
	return nil
}

func (sm *StreamManager) GetPipeline(pipelineID string) (*streaming.StreamPipeline, bool) {
	sm.pipelineMu.RLock()
	defer sm.pipelineMu.RUnlock()

	p, exists := sm.pipelines[pipelineID]
	if !exists {
		return nil, false
	}

	return &streaming.StreamPipeline{
		Id:          p.ID,
		Name:        p.Name,
		SourceTopic: p.SourceTopic,
		TargetTopic: p.TargetTopic,
		Transform:   p.Transform,
		Window:      p.Window,
		ExactlyOnce: p.ExactlyOnce,
		Status:      p.Status,
		MessagesProcessed: p.Stats.MessagesProcessed,
	}, true
}

func (sm *StreamManager) ListPipelines() []*streaming.StreamPipeline {
	sm.pipelineMu.RLock()
	defer sm.pipelineMu.RUnlock()

	pipelines := make([]*streaming.StreamPipeline, 0, len(sm.pipelines))
	for _, p := range sm.pipelines {
		pipelines = append(pipelines, &streaming.StreamPipeline{
			Id:          p.ID,
			Name:        p.Name,
			SourceTopic: p.SourceTopic,
			TargetTopic: p.TargetTopic,
			Transform:   p.Transform,
			Window:      p.Window,
			ExactlyOnce: p.ExactlyOnce,
			Status:      p.Status,
			MessagesProcessed: p.Stats.MessagesProcessed,
		})
	}

	return pipelines
}

func (sm *StreamManager) DeletePipeline(ctx context.Context, pipelineID string) error {
	sm.pipelineMu.Lock()
	defer sm.pipelineMu.Unlock()

	sm.stopPipeline(pipelineID)
	delete(sm.pipelines, pipelineID)
	log.Printf("Pipeline deleted: %s", pipelineID)
	return nil
}

func generatePipelineID() string {
	return fmt.Sprintf("pipe-%d", time.Now().UnixNano())
}
