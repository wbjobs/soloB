package main

import (
	"container/ring"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"gopkg.in/yaml.v3"
	"iiothub/pkg/models"
)

type CachedMessage struct {
	Topic     string
	Payload   []byte
	QoS       byte
	Timestamp time.Time
}

type MeterSimulator struct {
	meterID    string
	client     mqtt.Client
	interval   time.Duration
	stopChan   chan struct{}
	msgCache   *ring.Ring
	cacheMutex sync.RWMutex
	cacheCap   int
}

func NewMeterSimulator(meterID string, client mqtt.Client, interval time.Duration, cacheCap int) *MeterSimulator {
	return &MeterSimulator{
		meterID:  meterID,
		client:   client,
		interval: interval,
		stopChan: make(chan struct{}),
		msgCache: ring.New(cacheCap),
		cacheCap: cacheCap,
	}
}

func (s *MeterSimulator) Start() {
	go s.run()
}

func (s *MeterSimulator) run() {
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-s.stopChan:
			return
		case <-ticker.C:
			reading := s.generateReading()
			s.publish(reading)
		}
	}
}

func (s *MeterSimulator) generateReading() *models.MeterReading {
	baseVoltage := 220.0 + rand.Float64()*20 - 10
	baseCurrent := 5.0 + rand.Float64()*3
	powerFactor := 0.85 + rand.Float64()*0.14
	thd := 3.0 + rand.Float64()*4

	if rand.Float64() < 0.005 {
		anomalyType := rand.Intn(3)
		switch anomalyType {
		case 0:
			baseVoltage = 180 + rand.Float64()*20
		case 1:
			powerFactor = 0.6 + rand.Float64()*0.15
		case 2:
			thd = 12 + rand.Float64()*5
		}
	}

	return &models.MeterReading{
		MeterID:     s.meterID,
		Timestamp:   time.Now(),
		Voltage:     baseVoltage,
		Current:     baseCurrent,
		PowerFactor: powerFactor,
		THD:         thd,
	}
}

func (s *MeterSimulator) publish(reading *models.MeterReading) {
	payload, err := json.Marshal(reading)
	if err != nil {
		log.Printf("Meter %s: Failed to marshal reading: %v", s.meterID, err)
		return
	}

	topic := fmt.Sprintf("meters/%s/data", s.meterID)

	s.cacheMessage(topic, payload, 1)

	token := s.client.Publish(topic, 1, false, payload)
	go func() {
		<-token.Done()
		if token.Error() != nil {
			log.Printf("Meter %s: Failed to publish: %v", s.meterID, token.Error())
			atomic.AddUint64(&publishErrors, 1)
		} else {
			atomic.AddUint64(&publishSuccess, 1)
		}
	}()
}

func (s *MeterSimulator) cacheMessage(topic string, payload []byte, qos byte) {
	s.cacheMutex.Lock()
	defer s.cacheMutex.Unlock()

	s.msgCache.Value = &CachedMessage{
		Topic:     topic,
		Payload:   payload,
		QoS:       qos,
		Timestamp: time.Now(),
	}
	s.msgCache = s.msgCache.Next()
}

func (s *MeterSimulator) replayCachedMessages() int {
	s.cacheMutex.RLock()
	defer s.cacheMutex.RUnlock()

	count := 0
	s.msgCache.Do(func(v interface{}) {
		if v != nil {
			if msg, ok := v.(*CachedMessage); ok {
				token := s.client.Publish(msg.Topic, msg.QoS, false, msg.Payload)
				<-token.Done()
				if token.Error() == nil {
					count++
				}
			}
		}
	})

	if count > 0 {
		log.Printf("Meter %s: Replayed %d cached messages", s.meterID, count)
	}
	return count
}

func (s *MeterSimulator) Stop() {
	close(s.stopChan)
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

var (
	publishSuccess uint64
	publishErrors  uint64
)

func main() {
	cfg, err := loadConfig("configs/config.yaml")
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	persistenceDir := "./simulator_persistence"
	os.MkdirAll(persistenceDir, 0755)

	store := mqtt.NewFileStore(filepath.Join(persistenceDir, "msgstore"))

	opts := mqtt.NewClientOptions()
	opts.AddBroker(cfg.MQTT.Broker)
	opts.SetClientID("meter-simulator")
	opts.SetCleanSession(false)
	opts.SetAutoReconnect(true)
	opts.SetKeepAlive(30 * time.Second)
	opts.SetPingTimeout(10 * time.Second)
	opts.SetConnectTimeout(30 * time.Second)
	opts.SetMaxReconnectInterval(15 * time.Second)
	opts.SetStore(store)
	opts.SetResumeSubs(true)

	var connected int32 = 0

	opts.OnConnect = func(client mqtt.Client) {
		atomic.StoreInt32(&connected, 1)
		log.Println("Simulator MQTT connected with persistent session")
	}

	opts.OnConnectionLost = func(client mqtt.Client, err error) {
		atomic.StoreInt32(&connected, 0)
		log.Printf("Simulator MQTT connection lost: %v", err)
	}

	client := mqtt.NewClient(opts)
	if token := client.Connect(); token.Wait() && token.Error() != nil {
		log.Fatalf("Failed to connect to MQTT: %v", token.Error())
	}
	defer client.Disconnect(250)

	numMeters := cfg.Simulator.NumMeters
	interval := time.Duration(cfg.Simulator.IntervalMs) * time.Millisecond
	cacheCap := 1000

	log.Printf("Starting %d meter simulators with %v interval, QoS=1, CleanSession=false...",
		numMeters, interval)

	simulators := make([]*MeterSimulator, numMeters)
	var wg sync.WaitGroup

	for i := 0; i < numMeters; i++ {
		meterID := fmt.Sprintf("meter-%04d", i+1)
		sim := NewMeterSimulator(meterID, client, interval, cacheCap)
		simulators[i] = sim

		wg.Add(1)
		go func(s *MeterSimulator) {
			defer wg.Done()
			s.Start()
		}(sim)
	}

	log.Println("All meter simulators started")

	statsTicker := time.NewTicker(30 * time.Second)
	go func() {
		for range statsTicker.C {
			success := atomic.LoadUint64(&publishSuccess)
			errors := atomic.LoadUint64(&publishErrors)
			isConnected := atomic.LoadInt32(&connected) == 1
			log.Printf("Simulator Stats: Connected=%v, Published=%d, Errors=%d",
				isConnected, success, errors)
		}
	}()
	defer statsTicker.Stop()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Println("Stopping simulators...")
	for _, sim := range simulators {
		sim.Stop()
	}
	wg.Wait()

	log.Println("All simulators stopped")
}
