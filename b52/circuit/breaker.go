package circuit

import (
	"container/ring"
	"sync"
	"time"
)

type State int

const (
	StateClosed State = iota
	StateOpen
	StateHalfOpen
)

type Breaker struct {
	mu             sync.Mutex
	state          State
	lastStateChange time.Time
	errorThreshold float64
	timeout        time.Duration
	windowSize     int
	ringBuffer     *ring.Ring
	totalRequests  int
	errorCount     int
}

func NewBreaker(errorThreshold float64, timeout time.Duration, windowSize int) *Breaker {
	return &Breaker{
		state:          StateClosed,
		errorThreshold: errorThreshold,
		timeout:        timeout,
		windowSize:     windowSize,
		ringBuffer:     ring.New(windowSize),
	}
}

func (b *Breaker) Allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	switch b.state {
	case StateOpen:
		if time.Since(b.lastStateChange) > b.timeout {
			b.state = StateHalfOpen
			b.lastStateChange = time.Now()
			return true
		}
		return false
	case StateHalfOpen:
		return true
	default:
		return true
	}
}

func (b *Breaker) Success() {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.state == StateHalfOpen {
		b.resetMetrics()
		b.state = StateClosed
		b.lastStateChange = time.Now()
		return
	}

	b.recordRequest(true)
}

func (b *Breaker) Failure() {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.state == StateHalfOpen {
		b.state = StateOpen
		b.lastStateChange = time.Now()
		return
	}

	b.recordRequest(false)

	if b.totalRequests >= b.windowSize/2 {
		errorRate := float64(b.errorCount) / float64(b.totalRequests)
		if errorRate >= b.errorThreshold {
			b.state = StateOpen
			b.lastStateChange = time.Now()
		}
	}
}

func (b *Breaker) recordRequest(success bool) {
	if b.ringBuffer.Value != nil {
		if !b.ringBuffer.Value.(bool) {
			b.errorCount--
		}
		b.totalRequests--
	}

	b.ringBuffer.Value = success
	b.ringBuffer = b.ringBuffer.Next()
	b.totalRequests++

	if !success {
		b.errorCount++
	}
}

func (b *Breaker) resetMetrics() {
	b.ringBuffer = ring.New(b.windowSize)
	b.totalRequests = 0
	b.errorCount = 0
}

func (b *Breaker) GetState() State {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.state
}

func (b *Breaker) GetStateString() string {
	b.mu.Lock()
	defer b.mu.Unlock()

	switch b.state {
	case StateOpen:
		return "OPEN"
	case StateHalfOpen:
		return "HALF_OPEN"
	default:
		return "CLOSED"
	}
}

func (b *Breaker) GetErrorRate() float64 {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.totalRequests == 0 {
		return 0
	}
	return float64(b.errorCount) / float64(b.totalRequests)
}

func (b *Breaker) UpdateConfig(errorThreshold float64, timeout time.Duration, windowSize int) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.errorThreshold = errorThreshold
	b.timeout = timeout
	if windowSize != b.windowSize {
		b.windowSize = windowSize
		b.ringBuffer = ring.New(windowSize)
		b.totalRequests = 0
		b.errorCount = 0
	}
}
