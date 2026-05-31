package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"gopkg.in/yaml.v3"
	"iiothub/internal/aggregation"
	"iiothub/internal/anomaly"
	"iiothub/internal/api"
	"iiothub/internal/database"
	"iiothub/internal/mqtt"
	"iiothub/internal/prediction"
	"iiothub/internal/websocket"
	"iiothub/pkg/models"
)

func main() {
	cfg, err := loadConfig("configs/config.yaml")
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	db, err := database.NewDatabase(cfg)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	aggregator := aggregation.NewAggregator(db, cfg)
	aggregator.Start()
	defer aggregator.Stop()

	detector := anomaly.NewAnomalyDetector(db, cfg)
	detector.Start()
	defer detector.Stop()

	windowSize := 96
	if cfg.Prediction.WindowSize > 0 {
		windowSize = cfg.Prediction.WindowSize
	}

	predSteps := 4
	if cfg.Prediction.PredictionSteps > 0 {
		predSteps = cfg.Prediction.PredictionSteps
	}

	loadPredictor := prediction.NewLoadPredictor(windowSize, predSteps)

	wsServer := websocket.NewWebSocketServer(loadPredictor)
	go wsServer.Start()

	predSched := prediction.NewPredictionScheduler(db, loadPredictor, wsServer)

	if cfg.Prediction.IntervalMinutes > 0 {
		predSched.SetPredictionInterval(time.Duration(cfg.Prediction.IntervalMinutes) * time.Minute)
	}

	if cfg.Prediction.Enabled {
		predSched.Start()
		defer predSched.Stop()
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	batchWriter := NewBatchWriter(db, 1000, 5)
	batchWriter.Start(ctx)

	consumer := mqtt.NewConsumer(cfg, 200)
	consumer.AddHandler(func(reading *models.MeterReading) {
		batchWriter.Add(reading)
		aggregator.AddReading(reading)
		detector.ProcessReading(reading)

		if cfg.Prediction.Enabled {
			predSched.AddRealTimeReading(reading)
			predSched.RegisterMeter(reading.MeterID)
		}
	})

	if err := consumer.Connect(); err != nil {
		log.Fatalf("Failed to connect to MQTT: %v", err)
	}
	defer consumer.Disconnect()

	consumer.StartStatsReporter(ctx)

	apiServer := api.NewServer(db, cfg, wsServer, predSched)
	if err := apiServer.Start(); err != nil {
		log.Fatalf("Failed to start API server: %v", err)
	}
	defer apiServer.Stop()

	log.Println("Industrial IoT Hub started successfully")
	log.Printf("Prediction enabled: %v, interval: %d minutes",
		cfg.Prediction.Enabled, cfg.Prediction.IntervalMinutes)

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Println("Shutting down...")
}

func loadConfig(path string) (*models.Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg models.Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

type BatchWriter struct {
	db        *database.Database
	batchSize int
	interval  int
	batch     []*models.MeterReading
	inChan    chan *models.MeterReading
	mu        chan struct{}
}

func NewBatchWriter(db *database.Database, batchSize, intervalSeconds int) *BatchWriter {
	return &BatchWriter{
		db:        db,
		batchSize: batchSize,
		interval:  intervalSeconds,
		batch:     make([]*models.MeterReading, 0, batchSize),
		inChan:    make(chan *models.MeterReading, batchSize*2),
		mu:        make(chan struct{}, 1),
	}
}

func (w *BatchWriter) Add(reading *models.MeterReading) {
	select {
	case w.inChan <- reading:
	default:
	}
}

func (w *BatchWriter) Start(ctx context.Context) {
	go func() {
		for {
			select {
			case <-ctx.Done():
				w.flush()
				return
			case reading := <-w.inChan:
				w.batch = append(w.batch, reading)
				if len(w.batch) >= w.batchSize {
					w.flush()
				}
			}
		}
	}()
}

func (w *BatchWriter) flush() {
	w.mu <- struct{}{}
	defer func() { <-w.mu }()

	if len(w.batch) == 0 {
		return
	}

	if err := w.db.BatchInsertMeterReadings(context.Background(), w.batch); err != nil {
		log.Printf("Batch insert failed: %v", err)
	}

	w.batch = w.batch[:0]
}
