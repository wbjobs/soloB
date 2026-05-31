package prediction

import (
	"context"
	"log"
	"sync"
	"time"

	"iiothub/internal/database"
	"iiothub/internal/websocket"
	"iiothub/pkg/models"
)

type PredictionScheduler struct {
	db           *database.Database
	predictor    *LoadPredictor
	wsServer     *websocket.WebSocketServer
	activeMeters map[string]bool
	mu           sync.RWMutex
	ticker       *time.Ticker
	stopChan     chan struct{}
	predInterval time.Duration
	wg           sync.WaitGroup
}

func NewPredictionScheduler(db *database.Database, predictor *LoadPredictor, wsServer *websocket.WebSocketServer) *PredictionScheduler {
	return &PredictionScheduler{
		db:           db,
		predictor:    predictor,
		wsServer:     wsServer,
		activeMeters: make(map[string]bool),
		stopChan:     make(chan struct{}),
		predInterval: 15 * time.Minute,
	}
}

func (s *PredictionScheduler) Start() {
	s.ticker = time.NewTicker(s.predInterval)

	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.runPredictionLoop()
	}()

	log.Println("Prediction scheduler started")
}

func (s *PredictionScheduler) runPredictionLoop() {
	s.runPrediction()

	for {
		select {
		case <-s.stopChan:
			return
		case <-s.ticker.C:
			s.runPrediction()
		}
	}
}

func (s *PredictionScheduler) runPrediction() {
	meters := s.getActiveMeters()
	log.Printf("Running prediction for %d meters...", len(meters))

	var wg sync.WaitGroup
	semaphore := make(chan struct{}, 10)

	for _, meterID := range meters {
		wg.Add(1)
		semaphore <- struct{}{}

		go func(id string) {
			defer wg.Done()
			defer func() { <-semaphore }()

			s.processMeterPrediction(id)
		}(meterID)
	}

	wg.Wait()
	log.Println("Prediction batch completed")
}

func (s *PredictionScheduler) processMeterPrediction(meterID string) {
	if err := s.loadHistoricalData(meterID); err != nil {
		log.Printf("Failed to load historical data for %s: %v", meterID, err)
		return
	}

	if !s.predictor.HasEnoughData(meterID) {
		log.Printf("Not enough historical data for %s, skipping prediction", meterID)
		return
	}

	s.predictor.TrainModel(meterID)

	result, err := s.predictor.PredictNextHour(meterID)
	if err != nil {
		log.Printf("Prediction failed for %s: %v", meterID, err)
		return
	}

	if result != nil {
		s.wsServer.BroadcastPrediction(meterID, result)
		log.Printf("Prediction completed for %s: %v", meterID, result.LoadValues)
	}
}

func (s *PredictionScheduler) loadHistoricalData(meterID string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	endTime := time.Now()
	startTime := endTime.Add(-7 * 24 * time.Hour)

	aggregatedData, err := s.db.QueryAggregatedData(ctx, meterID, startTime, endTime)
	if err != nil {
		return err
	}

	for _, agg := range aggregatedData {
		historical := HistoricalData{
			Timestamp: agg.WindowStart,
			Load:      agg.VoltageMean * agg.PowerFactorMean / 1000,
			Voltage:   agg.VoltageMean,
			Current:   0,
		}
		s.predictor.AddHistoricalData(meterID, historical)
	}

	return nil
}

func (s *PredictionScheduler) getActiveMeters() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	meters := make([]string, 0, len(s.activeMeters))
	for meterID := range s.activeMeters {
		meters = append(meters, meterID)
	}

	if len(meters) == 0 {
		for i := 1; i <= 10; i++ {
			meters = append(meters, fmt.Sprintf("meter-%04d", i))
		}
	}

	return meters
}

func (s *PredictionScheduler) RegisterMeter(meterID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.activeMeters[meterID] = true
}

func (s *PredictionScheduler) UnregisterMeter(meterID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.activeMeters, meterID)
}

func (s *PredictionScheduler) GetPrediction(meterID string) (*PredictionResult, error) {
	if err := s.loadHistoricalData(meterID); err != nil {
		return nil, err
	}

	s.predictor.TrainModel(meterID)
	return s.predictor.PredictNextHour(meterID)
}

func (s *PredictionScheduler) Stop() {
	if s.ticker != nil {
		s.ticker.Stop()
	}

	close(s.stopChan)
	s.wg.Wait()

	log.Println("Prediction scheduler stopped")
}

func (s *PredictionScheduler) SetPredictionInterval(interval time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.predInterval = interval
	if s.ticker != nil {
		s.ticker.Stop()
	}
	s.ticker = time.NewTicker(interval)
}

func (s *PredictionScheduler) GetRegisteredMeters() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	meters := make([]string, 0, len(s.activeMeters))
	for meterID := range s.activeMeters {
		meters = append(meters, meterID)
	}
	return meters
}

func (s *PredictionScheduler) AddRealTimeReading(reading *models.MeterReading) {
	load := reading.Voltage * reading.PowerFactor / 1000

	historical := HistoricalData{
		Timestamp: reading.Timestamp,
		Load:      load,
		Voltage:   reading.Voltage,
		Current:   reading.Current,
	}

	s.predictor.AddHistoricalData(reading.MeterID, historical)
}
