package limiter

import (
	"sync"
	"time"
)

type Limiter interface {
	Allow() bool
	UpdateConfig(rate, capacity int64)
	GetTokens() int64
	GetRate() int64
	GetCapacity() int64
	Name() string
}

type TokenBucket struct {
	mu           sync.Mutex
	capacity     int64
	rate         int64
	tokens       int64
	lastUpdate   time.Time
	remainderNs  int64
}

func NewTokenBucket(rate, capacity int64) *TokenBucket {
	return &TokenBucket{
		capacity:    capacity,
		rate:        rate,
		tokens:      capacity,
		lastUpdate:  time.Now(),
		remainderNs: 0,
	}
}

func (tb *TokenBucket) Allow() bool {
	tb.mu.Lock()
	defer tb.mu.Unlock()

	now := time.Now()
	elapsedNs := now.Sub(tb.lastUpdate).Nanoseconds()

	if elapsedNs > 0 {
		totalNs := tb.remainderNs + elapsedNs
		newTokens := (totalNs * tb.rate) / int64(time.Second)
		tb.remainderNs = totalNs - (newTokens * int64(time.Second) / tb.rate)

		if newTokens > 0 {
			tb.tokens += newTokens
			if tb.tokens > tb.capacity {
				tb.tokens = tb.capacity
			}
		}
		tb.lastUpdate = now
	}

	if tb.tokens > 0 {
		tb.tokens--
		return true
	}
	return false
}

func (tb *TokenBucket) UpdateConfig(rate, capacity int64) {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	tb.rate = rate
	tb.capacity = capacity
	if tb.tokens > capacity {
		tb.tokens = capacity
	}
}

func (tb *TokenBucket) GetTokens() int64 {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	return tb.tokens
}

func (tb *TokenBucket) GetRate() int64 {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	return tb.rate
}

func (tb *TokenBucket) GetCapacity() int64 {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	return tb.capacity
}

func (tb *TokenBucket) Name() string {
	return "token_bucket"
}
