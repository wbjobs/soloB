package mqtt

import (
	"container/ring"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"iiothub/pkg/models"
)

type MessageHandler func(*models.MeterReading)

type CachedMessage struct {
	Topic     string
	Payload   []byte
	QoS       byte
	Timestamp time.Time
}

type Consumer struct {
	client        mqtt.Client
	cfg           *models.Config
	handlers      []MessageHandler
	workerPool    chan struct{}
	msgCount      uint64
	errorCount    uint64
	replayCount   uint64
	dropCount     uint64
	mu            sync.RWMutex
	wg            sync.WaitGroup
	isConnected   bool
	connMutex     sync.RWMutex

	msgCache      *ring.Ring
	cacheMutex    sync.RWMutex
	cacheCapacity int

	persistenceDir string
	replayWg      sync.WaitGroup
	replayActive   bool
	replayMutex    sync.Mutex

	ctx           context.Context
	cancel        context.CancelFunc
}

func NewConsumer(cfg *models.Config, numWorkers int) *Consumer {
	ctx, cancel := context.WithCancel(context.Background())

	cacheCapacity := 100000
	if cfg.MQTT.CacheCapacity > 0 {
		cacheCapacity = cfg.MQTT.CacheCapacity
	}

	persistenceDir := "./mqtt_persistence"
	if cfg.MQTT.PersistenceDir != "" {
		persistenceDir = cfg.MQTT.PersistenceDir
	}
	os.MkdirAll(persistenceDir, 0755)

	return &Consumer{
		cfg:            cfg,
		handlers:       make([]MessageHandler, 0),
		workerPool:     make(chan struct{}, numWorkers),
		msgCache:       ring.New(cacheCapacity),
		cacheCapacity:  cacheCapacity,
		persistenceDir: persistenceDir,
		ctx:            ctx,
		cancel:         cancel,
	}
}

func (c *Consumer) AddHandler(handler MessageHandler) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.handlers = append(c.handlers, handler)
}

func (c *Consumer) Connect() error {
	store := mqtt.NewFileStore(filepath.Join(c.persistenceDir, "msgstore"))

	opts := mqtt.NewClientOptions()
	opts.AddBroker(c.cfg.MQTT.Broker)
	opts.SetClientID(c.cfg.MQTT.ClientID)
	opts.SetCleanSession(false)
	opts.SetAutoReconnect(true)
	opts.SetKeepAlive(30 * time.Second)
	opts.SetPingTimeout(10 * time.Second)
	opts.SetConnectTimeout(30 * time.Second)
	opts.SetMaxReconnectInterval(15 * time.Second)
	opts.SetConnectionLostHandler(c.onConnectionLost)
	opts.SetOnConnectHandler(c.onConnect)
	opts.SetStore(store)
	opts.SetResumeSubs(true)

	opts.WillEnabled = true
	opts.WillTopic = fmt.Sprintf("clients/%s/status", c.cfg.MQTT.ClientID)
	opts.WillPayload = []byte("offline")
	opts.WillQos = 1
	opts.WillRetained = true

	c.client = mqtt.NewClient(opts)

	log.Printf("MQTT connecting to %s with CleanSession=false, ClientID=%s",
		c.cfg.MQTT.Broker, c.cfg.MQTT.ClientID)

	if token := c.client.Connect(); token.Wait() && token.Error() != nil {
		return fmt.Errorf("failed to connect: %w", token.Error())
	}

	return nil
}

func (c *Consumer) onConnect(client mqtt.Client) {
	c.connMutex.Lock()
	c.isConnected = true
	c.connMutex.Unlock()

	log.Println("MQTT connected successfully, session resumed =", client.IsConnectionOpen())

	if token := client.Publish(
		fmt.Sprintf("clients/%s/status", c.cfg.MQTT.ClientID),
		1, true, []byte("online"),
	); token.Wait() && token.Error() != nil {
		log.Printf("Failed to publish online status: %v", token.Error())
	}

	if err := c.subscribe(); err != nil {
		log.Printf("Failed to subscribe: %v", err)
	}

	go c.startReplay()
}

func (c *Consumer) onConnectionLost(client mqtt.Client, err error) {
	c.connMutex.Lock()
	c.isConnected = false
	c.connMutex.Unlock()

	log.Printf("MQTT connection lost: %v, will auto-reconnect", err)
}

func (c *Consumer) subscribe() error {
	qos := byte(1)
	if c.cfg.MQTT.QoS > 0 {
		qos = c.cfg.MQTT.QoS
	}

	token := c.client.Subscribe(
		c.cfg.MQTT.Topic,
		qos,
		c.messageHandler,
	)

	if token.Wait() && token.Error() != nil {
		return fmt.Errorf("failed to subscribe to %s: %w", c.cfg.MQTT.Topic, token.Error())
	}

	log.Printf("Subscribed to topic: %s with QoS=%d", c.cfg.MQTT.Topic, qos)
	return nil
}

func (c *Consumer) messageHandler(client mqtt.Client, msg mqtt.Message) {
	if msg.Qos() >= 1 {
		msg.Ack()
	}

	c.cacheMessage(msg)

	c.workerPool <- struct{}{}
	c.wg.Add(1)

	go func() {
		defer func() {
			<-c.workerPool
			c.wg.Done()
			if r := recover(); r != nil {
				log.Printf("Recovered from panic in message handler: %v", r)
				atomic.AddUint64(&c.errorCount, 1)
			}
		}()

		reading, err := c.parseMessage(msg)
		if err != nil {
			log.Printf("Failed to parse message: %v", err)
			atomic.AddUint64(&c.errorCount, 1)
			return
		}

		c.mu.RLock()
		handlers := make([]MessageHandler, len(c.handlers))
		copy(handlers, c.handlers)
		c.mu.RUnlock()

		for _, handler := range handlers {
			handler(reading)
		}

		atomic.AddUint64(&c.msgCount, 1)
	}()
}

func (c *Consumer) cacheMessage(msg mqtt.Message) {
	c.cacheMutex.Lock()
	defer c.cacheMutex.Unlock()

	cached := &CachedMessage{
		Topic:     msg.Topic(),
		Payload:   msg.Payload(),
		QoS:       msg.Qos(),
		Timestamp: time.Now(),
	}

	c.msgCache.Value = cached
	c.msgCache = c.msgCache.Next()
}

func (c *Consumer) getCachedMessages() []*CachedMessage {
	c.cacheMutex.RLock()
	defer c.cacheMutex.RUnlock()

	messages := make([]*CachedMessage, 0, c.cacheCapacity)
	c.msgCache.Do(func(v interface{}) {
		if v != nil {
			if msg, ok := v.(*CachedMessage); ok {
				messages = append(messages, msg)
			}
		}
	})

	return messages
}

func (c *Consumer) startReplay() {
	c.replayMutex.Lock()
	if c.replayActive {
		c.replayMutex.Unlock()
		return
	}
	c.replayActive = true
	c.replayMutex.Unlock()

	defer func() {
		c.replayMutex.Lock()
		c.replayActive = false
		c.replayMutex.Unlock()
	}()

	messages := c.getCachedMessages()
	if len(messages) == 0 {
		return
	}

	log.Printf("Starting replay of %d cached messages", len(messages))

	batchSize := 100
	batch := make([]*CachedMessage, 0, batchSize)

	for _, msg := range messages {
		batch = append(batch, msg)
		if len(batch) >= batchSize {
			c.replayBatch(batch)
			batch = batch[:0]
		}
	}

	if len(batch) > 0 {
		c.replayBatch(batch)
	}

	log.Printf("Replay completed, total replayed: %d", atomic.LoadUint64(&c.replayCount))
}

func (c *Consumer) replayBatch(messages []*CachedMessage) {
	c.replayWg.Add(len(messages))

	for _, msg := range messages {
		go func(m *CachedMessage) {
			defer c.replayWg.Done()

			select {
			case <-c.ctx.Done():
				return
			default:
			}

			reading, err := c.parseCachedMessage(m)
			if err != nil {
				atomic.AddUint64(&c.dropCount, 1)
				return
			}

			c.mu.RLock()
			handlers := make([]MessageHandler, len(c.handlers))
			copy(handlers, c.handlers)
			c.mu.RUnlock()

			for _, handler := range handlers {
				handler(reading)
			}

			atomic.AddUint64(&c.replayCount, 1)
		}(msg)
	}

	c.replayWg.Wait()
}

func (c *Consumer) parseMessage(msg mqtt.Message) (*models.MeterReading, error) {
	topicParts := strings.Split(msg.Topic(), "/")
	if len(topicParts) < 2 {
		return nil, fmt.Errorf("invalid topic format: %s", msg.Topic())
	}
	meterID := topicParts[1]

	var reading models.MeterReading
	if err := json.Unmarshal(msg.Payload(), &reading); err != nil {
		return nil, fmt.Errorf("failed to unmarshal payload: %w", err)
	}

	reading.MeterID = meterID
	if reading.Timestamp.IsZero() {
		reading.Timestamp = time.Now()
	}

	return &reading, nil
}

func (c *Consumer) parseCachedMessage(msg *CachedMessage) (*models.MeterReading, error) {
	topicParts := strings.Split(msg.Topic, "/")
	if len(topicParts) < 2 {
		return nil, fmt.Errorf("invalid topic format: %s", msg.Topic)
	}
	meterID := topicParts[1]

	var reading models.MeterReading
	if err := json.Unmarshal(msg.Payload, &reading); err != nil {
		return nil, fmt.Errorf("failed to unmarshal payload: %w", err)
	}

	reading.MeterID = meterID
	if reading.Timestamp.IsZero() {
		reading.Timestamp = msg.Timestamp
	}

	return &reading, nil
}

func (c *Consumer) GetStats() (msgCount, errorCount, replayCount, dropCount uint64) {
	return atomic.LoadUint64(&c.msgCount),
		atomic.LoadUint64(&c.errorCount),
		atomic.LoadUint64(&c.replayCount),
		atomic.LoadUint64(&c.dropCount)
}

func (c *Consumer) IsConnected() bool {
	c.connMutex.RLock()
	defer c.connMutex.RUnlock()
	return c.isConnected
}

func (c *Consumer) Disconnect() {
	log.Println("Disconnecting MQTT consumer...")

	c.cancel()

	c.replayWg.Wait()
	c.wg.Wait()

	if c.client != nil && c.client.IsConnected() {
		if token := c.client.Publish(
			fmt.Sprintf("clients/%s/status", c.cfg.MQTT.ClientID),
			1, true, []byte("offline"),
		); token.WaitTimeout(5 * time.Second) {
			if token.Error() != nil {
				log.Printf("Failed to publish offline status: %v", token.Error())
			}
		}

		c.client.Disconnect(2000)
	}

	log.Println("MQTT consumer disconnected")
}

func (c *Consumer) StartStatsReporter(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-c.ctx.Done():
				return
			case <-ticker.C:
				msgCount, errCount, replayCount, dropCount := c.GetStats()
				connected := c.IsConnected()
				log.Printf("MQTT Stats: Connected=%v, Messages=%d, Errors=%d, Replayed=%d, Dropped=%d, Workers active=%d/%d",
					connected, msgCount, errCount, replayCount, dropCount,
					len(c.workerPool), cap(c.workerPool))
			}
		}
	}()
}
