package limiter

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestSlidingWindowBasic(t *testing.T) {
	sw := NewSlidingWindowLog(10, 10, time.Second)

	for i := 0; i < 10; i++ {
		if !sw.Allow() {
			t.Fatalf("Expected to allow request %d", i)
		}
	}

	if sw.Allow() {
		t.Fatal("Expected to deny after window is full")
	}
}

func TestSlidingWindowSliding(t *testing.T) {
	sw := NewSlidingWindowLog(10, 10, 100*time.Millisecond)

	for i := 0; i < 10; i++ {
		sw.Allow()
	}

	if sw.Allow() {
		t.Fatal("Expected window to be full")
	}

	time.Sleep(60 * time.Millisecond)

	if sw.Allow() {
		t.Fatal("Expected still within window")
	}

	time.Sleep(60 * time.Millisecond)

	if !sw.Allow() {
		t.Fatal("Expected window to slide and allow new requests")
	}
}

func TestSlidingWindowHighConcurrency(t *testing.T) {
	rate := int64(10000)
	window := 1 * time.Second
	sw := NewSlidingWindowLog(rate, rate, window)

	var allowed int64
	var denied int64
	var wg sync.WaitGroup
	numGoroutines := 50
	requestsPerGoroutine := 300

	start := time.Now()

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < requestsPerGoroutine; j++ {
				if sw.Allow() {
					atomic.AddInt64(&allowed, 1)
				} else {
					atomic.AddInt64(&denied, 1)
				}
			}
		}()
	}

	wg.Wait()
	elapsed := time.Since(start)

	totalRequests := numGoroutines * requestsPerGoroutine
	t.Logf("Total requests: %d", totalRequests)
	t.Logf("Allowed: %d", allowed)
	t.Logf("Denied: %d", denied)
	t.Logf("Elapsed: %v", elapsed)
	t.Logf("Rate: %d/s, Window: %s", rate, window)

	if allowed > rate {
		t.Errorf("Allowed too many requests: %d > rate %d (allowing for some sliding)", allowed, rate)
	}
}

func TestSlidingWindowName(t *testing.T) {
	sw := NewSlidingWindowLog(10, 10, time.Second)
	if sw.Name() != "sliding_window" {
		t.Errorf("Expected name 'sliding_window', got '%s'", sw.Name())
	}
}

func TestSlidingWindowGetTokens(t *testing.T) {
	sw := NewSlidingWindowLog(10, 10, time.Second)

	if sw.GetTokens() != 10 {
		t.Errorf("Expected 10 tokens, got %d", sw.GetTokens())
	}

	for i := 0; i < 3; i++ {
		sw.Allow()
	}

	if sw.GetTokens() != 7 {
		t.Errorf("Expected 7 tokens, got %d", sw.GetTokens())
	}
}

func TestSlidingWindowUpdateConfig(t *testing.T) {
	sw := NewSlidingWindowLog(10, 10, time.Second)

	sw.UpdateConfig(20, 50)

	if sw.GetRate() != 20 {
		t.Errorf("Expected rate 20, got %d", sw.GetRate())
	}

	if sw.GetCapacity() != 50 {
		t.Errorf("Expected capacity 50, got %d", sw.GetCapacity())
	}
}

func TestSlidingWindowSetWindow(t *testing.T) {
	sw := NewSlidingWindowLog(10, 10, time.Second)

	if sw.GetWindow() != time.Second {
		t.Errorf("Expected window 1s, got %s", sw.GetWindow())
	}

	sw.SetWindow(5 * time.Second)

	if sw.GetWindow() != 5*time.Second {
		t.Errorf("Expected window 5s, got %s", sw.GetWindow())
	}
}

func TestLimiterInterface(t *testing.T) {
	var _ Limiter = NewTokenBucket(10, 10)
	var _ Limiter = NewSlidingWindowLog(10, 10, time.Second)
}
