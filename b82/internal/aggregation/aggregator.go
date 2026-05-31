package aggregation

import (
	"context"
	"log"
	"math"
	"sync"
	"time"

	"iiothub/internal/database"
	"iiothub/pkg/models"
)

type WindowBuffer struct {
	readings []*models.MeterReading
	mu       sync.RWMutex
}

type Aggregator struct {
	db           *database.Database
	cfg          *models.Config
	windows      map[string]map[int64]*WindowBuffer
	mu           sync.RWMutex
	windowDur    time.Duration
	outChan      chan *models.AggregatedData
	ctx          context.Context
	cancel       context.CancelFunc
	wg           sync.WaitGroup
	flushTicker  *time.Ticker
}

func NewAggregator(db *database.Database, cfg *models.Config) *Aggregator {
	ctx, cancel := context.WithCancel(context.Background())
	return &Aggregator{
		db:         db,
		cfg:        cfg,
		windows:    make(map[string]map[int64]*WindowBuffer),
		windowDur:  time.Duration(cfg.Aggregation.WindowMinutes) * time.Minute,
		outChan:    make(chan *models.AggregatedData, 1000),
		ctx:        ctx,
		cancel:     cancel,
	}
}

func (a *Aggregator) AddReading(reading *models.MeterReading) {
	windowStart := a.getWindowStart(reading.Timestamp)

	a.mu.Lock()
	meterWindows, ok := a.windows[reading.MeterID]
	if !ok {
		meterWindows = make(map[int64]*WindowBuffer)
		a.windows[reading.MeterID] = meterWindows
	}

	buf, ok := meterWindows[windowStart.Unix()]
	if !ok {
		buf = &WindowBuffer{
			readings: make([]*models.MeterReading, 0, 60),
		}
		meterWindows[windowStart.Unix()] = buf
	}
	a.mu.Unlock()

	buf.mu.Lock()
	buf.readings = append(buf.readings, reading)
	buf.mu.Unlock()
}

func (a *Aggregator) getWindowStart(t time.Time) time.Time {
	return t.Truncate(a.windowDur)
}

func (a *Aggregator) Start() {
	a.flushTicker = time.NewTicker(a.windowDur / 2)

	a.wg.Add(2)
	go a.flushLoop()
	go a.persistenceLoop()

	log.Println("Aggregator started")
}

func (a *Aggregator) flushLoop() {
	defer a.wg.Done()

	for {
		select {
		case <-a.ctx.Done():
			return
		case <-a.flushTicker.C:
			a.flushOldWindows()
		}
	}
}

func (a *Aggregator) flushOldWindows() {
	now := time.Now()
	currentWindowStart := a.getWindowStart(now)

	a.mu.Lock()
	meterIDs := make([]string, 0, len(a.windows))
	for meterID := range a.windows {
		meterIDs = append(meterIDs, meterID)
	}
	a.mu.Unlock()

	for _, meterID := range meterIDs {
		a.mu.Lock()
		meterWindows := a.windows[meterID]
		windowStarts := make([]int64, 0, len(meterWindows))
		for ws := range meterWindows {
			windowStarts = append(windowStarts, ws)
		}
		a.mu.Unlock()

		for _, ws := range windowStarts {
			windowStart := time.Unix(ws, 0)
			if windowStart.Before(currentWindowStart) {
				a.flushWindow(meterID, windowStart)
			}
		}
	}
}

func (a *Aggregator) flushWindow(meterID string, windowStart time.Time) {
	a.mu.Lock()
	meterWindows, ok := a.windows[meterID]
	if !ok {
		a.mu.Unlock()
		return
	}

	buf, ok := meterWindows[windowStart.Unix()]
	if !ok {
		a.mu.Unlock()
		return
	}

	delete(meterWindows, windowStart.Unix())
	if len(meterWindows) == 0 {
		delete(a.windows, meterID)
	}
	a.mu.Unlock()

	buf.mu.RLock()
	readings := make([]*models.MeterReading, len(buf.readings))
	copy(readings, buf.readings)
	buf.mu.RUnlock()

	if len(readings) == 0 {
		return
	}

	agg := a.calculateAggregation(meterID, windowStart, readings)
	select {
	case a.outChan <- agg:
	default:
		log.Printf("Warning: aggregation channel full, dropping aggregation for %s", meterID)
	}
}

func (a *Aggregator) calculateAggregation(meterID string, windowStart time.Time, readings []*models.MeterReading) *models.AggregatedData {
	n := len(readings)
	agg := &models.AggregatedData{
		MeterID:      meterID,
		WindowStart:  windowStart,
		WindowEnd:    windowStart.Add(a.windowDur),
		VoltageMin:   math.Inf(1),
		VoltageMax:   math.Inf(-1),
		SampleCount:  n,
	}

	var voltageSum, pfSum float64
	voltages := make([]float64, n)

	for i, r := range readings {
		voltages[i] = r.Voltage
		voltageSum += r.Voltage
		pfSum += r.PowerFactor

		if r.Voltage < agg.VoltageMin {
			agg.VoltageMin = r.Voltage
		}
		if r.Voltage > agg.VoltageMax {
			agg.VoltageMax = r.Voltage
		}
	}

	agg.VoltageMean = voltageSum / float64(n)
	agg.PowerFactorMean = pfSum / float64(n)
	agg.VoltageFluctuation = agg.VoltageMax - agg.VoltageMin

	var variance float64
	for _, v := range voltages {
		diff := v - agg.VoltageMean
		variance += diff * diff
	}
	agg.VoltageStdDev = math.Sqrt(variance / float64(n))

	return agg
}

func (a *Aggregator) persistenceLoop() {
	defer a.wg.Done()

	for {
		select {
		case <-a.ctx.Done():
			return
		case agg := <-a.outChan:
			if err := a.db.InsertAggregatedData(context.Background(), agg); err != nil {
				log.Printf("Failed to insert aggregated data: %v", err)
			}
		}
	}
}

func (a *Aggregator) FlushAll() {
	log.Println("Flushing all windows...")

	a.mu.Lock()
	meterIDs := make([]string, 0, len(a.windows))
	for meterID := range a.windows {
		meterIDs = append(meterIDs, meterID)
	}
	a.mu.Unlock()

	for _, meterID := range meterIDs {
		a.mu.Lock()
		meterWindows := a.windows[meterID]
		windowStarts := make([]int64, 0, len(meterWindows))
		for ws := range meterWindows {
			windowStarts = append(windowStarts, ws)
		}
		a.mu.Unlock()

		for _, ws := range windowStarts {
			a.flushWindow(meterID, time.Unix(ws, 0))
		}
	}

	log.Println("All windows flushed")
}

func (a *Aggregator) Stop() {
	a.cancel()
	if a.flushTicker != nil {
		a.flushTicker.Stop()
	}
	a.FlushAll()
	a.wg.Wait()
	close(a.outChan)
	log.Println("Aggregator stopped")
}
