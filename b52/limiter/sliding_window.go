package limiter

import (
	"sync"
	"time"
)

type SlidingWindowLog struct {
	mu       sync.Mutex
	rate     int64
	capacity int64
	window   time.Duration
	logs     []int64
}

func NewSlidingWindowLog(rate, capacity int64, window time.Duration) *SlidingWindowLog {
	return &SlidingWindowLog{
		rate:     rate,
		capacity: capacity,
		window:   window,
		logs:     make([]int64, 0, capacity),
	}
}

func (sw *SlidingWindowLog) Allow() bool {
	sw.mu.Lock()
	defer sw.mu.Unlock()

	now := time.Now().UnixNano()
	windowStart := now - sw.window.Nanoseconds()

	idx := 0
	for idx < len(sw.logs) && sw.logs[idx] < windowStart {
		idx++
	}

	if idx > 0 {
		sw.logs = sw.logs[idx:]
	}

	if int64(len(sw.logs)) >= sw.rate {
		return false
	}

	sw.logs = append(sw.logs, now)
	return true
}

func (sw *SlidingWindowLog) UpdateConfig(rate, capacity int64) {
	sw.mu.Lock()
	defer sw.mu.Unlock()
	sw.rate = rate
	sw.capacity = capacity
	if int64(len(sw.logs)) > capacity {
		sw.logs = sw.logs[len(sw.logs)-int(capacity):]
	}
}

func (sw *SlidingWindowLog) GetTokens() int64 {
	sw.mu.Lock()
	defer sw.mu.Unlock()

	now := time.Now().UnixNano()
	windowStart := now - sw.window.Nanoseconds()

	count := 0
	for i := len(sw.logs) - 1; i >= 0; i-- {
		if sw.logs[i] >= windowStart {
			count++
		} else {
			break
		}
	}

	return sw.rate - int64(count)
}

func (sw *SlidingWindowLog) GetRate() int64 {
	sw.mu.Lock()
	defer sw.mu.Unlock()
	return sw.rate
}

func (sw *SlidingWindowLog) GetCapacity() int64 {
	sw.mu.Lock()
	defer sw.mu.Unlock()
	return sw.capacity
}

func (sw *SlidingWindowLog) Name() string {
	return "sliding_window"
}

func (sw *SlidingWindowLog) GetWindow() time.Duration {
	sw.mu.Lock()
	defer sw.mu.Unlock()
	return sw.window
}

func (sw *SlidingWindowLog) SetWindow(window time.Duration) {
	sw.mu.Lock()
	defer sw.mu.Unlock()
	sw.window = window
}
