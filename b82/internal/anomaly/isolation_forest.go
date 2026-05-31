package anomaly

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/http"
	"sync"
	"time"

	"iiothub/internal/database"
	"iiothub/pkg/models"
)

type IsolationTree struct {
	featureIndex int
	splitValue   float64
	left         *IsolationTree
	right        *IsolationTree
	height       int
}

type IsolationForest struct {
	trees     []*IsolationTree
	numTrees  int
	sampleSize int
	mu        sync.RWMutex
}

type AnomalyDetector struct {
	forest      *IsolationForest
	db          *database.Database
	cfg         *models.Config
	httpClient  *http.Client
	anomalyChan chan *models.AnomalyEvent
	ctx         context.Context
	cancel      context.CancelFunc
	wg          sync.WaitGroup
}

func NewIsolationForest(numTrees, sampleSize int) *IsolationForest {
	return &IsolationForest{
		trees:      make([]*IsolationTree, 0, numTrees),
		numTrees:   numTrees,
		sampleSize: sampleSize,
	}
}

func (f *IsolationForest) Train(data [][]float64) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.trees = make([]*IsolationTree, 0, f.numTrees)
	maxDepth := int(math.Ceil(math.Log2(float64(f.sampleSize))))

	for i := 0; i < f.numTrees; i++ {
		sample := f.bootstrapSample(data)
		tree := f.buildTree(sample, 0, maxDepth)
		f.trees = append(f.trees, tree)
	}
}

func (f *IsolationForest) bootstrapSample(data [][]float64) [][]float64 {
	n := len(data)
	sampleSize := f.sampleSize
	if n < sampleSize {
		sampleSize = n
	}

	sample := make([][]float64, sampleSize)
	for i := 0; i < sampleSize; i++ {
		idx := rand.Intn(n)
		sample[i] = data[idx]
	}
	return sample
}

func (f *IsolationForest) buildTree(data [][]float64, currentDepth, maxDepth int) *IsolationTree {
	if currentDepth >= maxDepth || len(data) <= 1 {
		return &IsolationTree{height: currentDepth}
	}

	numFeatures := len(data[0])
	featureIndex := rand.Intn(numFeatures)

	minVal, maxVal := math.Inf(1), math.Inf(-1)
	for _, row := range data {
		if row[featureIndex] < minVal {
			minVal = row[featureIndex]
		}
		if row[featureIndex] > maxVal {
			maxVal = row[featureIndex]
		}
	}

	if minVal == maxVal {
		return &IsolationTree{height: currentDepth}
	}

	splitValue := minVal + rand.Float64()*(maxVal-minVal)

	var leftData, rightData [][]float64
	for _, row := range data {
		if row[featureIndex] < splitValue {
			leftData = append(leftData, row)
		} else {
			rightData = append(rightData, row)
		}
	}

	return &IsolationTree{
		featureIndex: featureIndex,
		splitValue:   splitValue,
		left:         f.buildTree(leftData, currentDepth+1, maxDepth),
		right:        f.buildTree(rightData, currentDepth+1, maxDepth),
		height:       currentDepth,
	}
}

func (f *IsolationForest) AnomalyScore(instance []float64) float64 {
	f.mu.RLock()
	defer f.mu.RUnlock()

	if len(f.trees) == 0 {
		return 0.5
	}

	var sumPathLength float64
	for _, tree := range f.trees {
		sumPathLength += float64(f.pathLength(instance, tree, 0))
	}

	avgPathLength := sumPathLength / float64(len(f.trees))
	expectedPathLength := c(float64(f.sampleSize))

	score := math.Pow(2, -avgPathLength/expectedPathLength)
	return score
}

func (f *IsolationForest) pathLength(instance []float64, tree *IsolationTree, currentLength int) int {
	if tree.left == nil && tree.right == nil {
		return currentLength
	}

	if instance[tree.featureIndex] < tree.splitValue {
		return f.pathLength(instance, tree.left, currentLength+1)
	}
	return f.pathLength(instance, tree.right, currentLength+1)
}

func c(n float64) float64 {
	if n <= 1 {
		return 0
	}
	return 2*(math.Log(n-1)+0.5772156649) - 2*(n-1)/n
}

func NewAnomalyDetector(db *database.Database, cfg *models.Config) *AnomalyDetector {
	ctx, cancel := context.WithCancel(context.Background())
	return &AnomalyDetector{
		forest:     NewIsolationForest(cfg.AnomalyDetection.NumTrees, cfg.AnomalyDetection.SampleSize),
		db:         db,
		cfg:        cfg,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		anomalyChan: make(chan *models.AnomalyEvent, 1000),
		ctx:        ctx,
		cancel:     cancel,
	}
}

func (d *AnomalyDetector) Start() {
	if !d.cfg.AnomalyDetection.Enabled {
		log.Println("Anomaly detection disabled")
		return
	}

	d.wg.Add(2)
	go d.trainingLoop()
	go d.persistenceLoop()

	log.Println("Anomaly detector started")
}

func (d *AnomalyDetector) trainingLoop() {
	defer d.wg.Done()

	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-d.ctx.Done():
			return
		case <-ticker.C:
			d.trainModel()
		}
	}
}

func (d *AnomalyDetector) trainModel() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	readings, err := d.db.GetRecentReadings(ctx, "meter-0001", 1000)
	if err != nil {
		log.Printf("Failed to get readings for training: %v", err)
		return
	}

	if len(readings) < 10 {
		log.Println("Not enough readings for training")
		return
	}

	data := make([][]float64, len(readings))
	for i, r := range readings {
		data[i] = []float64{r.Voltage, r.Current, r.PowerFactor, r.THD}
	}

	d.forest.Train(data)
	log.Printf("Isolation Forest trained with %d samples", len(readings))
}

func (d *AnomalyDetector) ProcessReading(reading *models.MeterReading) {
	if !d.cfg.AnomalyDetection.Enabled {
		return
	}

	instance := []float64{reading.Voltage, reading.Current, reading.PowerFactor, reading.THD}
	score := d.forest.AnomalyScore(instance)

	if score >= d.cfg.AnomalyDetection.Threshold {
		anomalyType := d.classifyAnomaly(reading)
		event := &models.AnomalyEvent{
			MeterID:         reading.MeterID,
			Timestamp:       reading.Timestamp,
			AnomalyScore:    score,
			AnomalyType:     anomalyType,
			AffectedReading: *reading,
		}

		select {
		case d.anomalyChan <- event:
		default:
			log.Printf("Warning: anomaly channel full, dropping event for %s", reading.MeterID)
		}
	}
}

func (d *AnomalyDetector) classifyAnomaly(reading *models.MeterReading) string {
	switch {
	case reading.Voltage < 190 || reading.Voltage > 250:
		return "voltage_abnormal"
	case reading.PowerFactor < 0.8:
		return "low_power_factor"
	case reading.THD > 10:
		return "high_thd"
	default:
		return "abnormal_pattern"
	}
}

func (d *AnomalyDetector) persistenceLoop() {
	defer d.wg.Done()

	for {
		select {
		case <-d.ctx.Done():
			return
		case event := <-d.anomalyChan:
			if d.cfg.AnomalyDetection.WebhookEnabled {
				response, err := d.sendWebhook(event)
				event.WebhookSent = err == nil
				event.WebhookResponse = response
				if err != nil {
					log.Printf("Webhook failed: %v", err)
				} else {
					log.Printf("Anomaly detected for %s: score=%.3f, type=%s, webhook sent",
						event.MeterID, event.AnomalyScore, event.AnomalyType)
				}
			}

			if err := d.db.InsertAnomalyEvent(context.Background(), event); err != nil {
				log.Printf("Failed to insert anomaly event: %v", err)
			}
		}
	}
}

func (d *AnomalyDetector) sendWebhook(event *models.AnomalyEvent) (string, error) {
	payload, err := json.Marshal(event)
	if err != nil {
		return "", fmt.Errorf("failed to marshal event: %w", err)
	}

	req, err := http.NewRequestWithContext(context.Background(), "POST", d.cfg.AnomalyDetection.WebhookURL, bytes.NewBuffer(payload))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := d.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("webhook returned status %d", resp.StatusCode)
	}

	buf := new(bytes.Buffer)
	buf.ReadFrom(resp.Body)
	return buf.String(), nil
}

func (d *AnomalyDetector) Stop() {
	d.cancel()
	d.wg.Wait()
	close(d.anomalyChan)
	log.Println("Anomaly detector stopped")
}
