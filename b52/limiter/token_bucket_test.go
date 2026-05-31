package limiter

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestTokenBucketBasic(t *testing.T) {
	tb := NewTokenBucket(10, 10)

	for i := 0; i < 10; i++ {
		if !tb.Allow() {
			t.Fatalf("Expected to allow request %d", i)
		}
	}

	if tb.Allow() {
		t.Fatal("Expected to deny after bucket is empty")
	}
}

func TestTokenBucketRefill(t *testing.T) {
	tb := NewTokenBucket(10, 20)

	for i := 0; i < 20; i++ {
		tb.Allow()
	}

	if tb.Allow() {
		t.Fatal("Expected empty bucket")
	}

	time.Sleep(100 * time.Millisecond)

	allowed := 0
	for i := 0; i < 5; i++ {
		if tb.Allow() {
			allowed++
		}
	}

	if allowed < 1 {
		t.Errorf("Expected at least 1 token after 100ms, got %d", allowed)
	}
}

func TestTokenBucketHighConcurrency(t *testing.T) {
	rate := int64(10000)
	capacity := rate
	tb := NewTokenBucket(rate, capacity)

	var allowed int64
	var denied int64
	var wg sync.WaitGroup
	numGoroutines := 100
	requestsPerGoroutine := 200

	start := time.Now()

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < requestsPerGoroutine; j++ {
				if tb.Allow() {
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
	expectedMaxAllowed := capacity + int64(float64(rate)*elapsed.Seconds())

	t.Logf("Total requests: %d", totalRequests)
	t.Logf("Allowed: %d", allowed)
	t.Logf("Denied: %d", denied)
	t.Logf("Elapsed: %v", elapsed)
	t.Logf("Expected max allowed: ~%d", expectedMaxAllowed)
	t.Logf("Capacity: %d, Rate: %d/s", capacity, rate)

	tolerance := float64(rate) * 0.1
	if float64(allowed) > float64(expectedMaxAllowed)+tolerance {
		t.Errorf("Allowed too many requests: %d > expected ~%d (tolerance: %.0f)",
			allowed, expectedMaxAllowed, tolerance)
	}
}

func TestTokenBucketPrecision(t *testing.T) {
	rate := int64(10000)
	capacity := int64(100)
	tb := NewTokenBucket(rate, capacity)

	for i := 0; i < 100; i++ {
		if !tb.Allow() {
			t.Fatalf("Expected to allow request %d", i)
		}
	}

	if tb.Allow() {
		t.Fatal("Expected bucket to be empty")
	}

	time.Sleep(1 * time.Millisecond)

	allowed := 0
	for i := 0; i < 20; i++ {
		if tb.Allow() {
			allowed++
		}
	}

	expectedTokens := (int64(time.Millisecond) * rate) / int64(time.Second)
	t.Logf("Expected tokens after 1ms: %d", expectedTokens)
	t.Logf("Actually allowed: %d", allowed)

	if allowed < int(expectedTokens/2) || allowed > int(expectedTokens)+2 {
		t.Errorf("Token precision issue: expected ~%d, got %d", expectedTokens, allowed)
	}
}

func TestTokenBucketNoOverLimit(t *testing.T) {
	rate := int64(1000)
	capacity := int64(100)
	tb := NewTokenBucket(rate, capacity)

	testDuration := 500 * time.Millisecond
	start := time.Now()

	var allowed int64
	var wg sync.WaitGroup
	numGoroutines := 50

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for time.Since(start) < testDuration {
				if tb.Allow() {
					atomic.AddInt64(&allowed, 1)
				}
			}
		}()
	}

	wg.Wait()
	elapsed := time.Since(start)

	expectedMax := capacity + (int64(elapsed.Nanoseconds())*rate)/int64(time.Second) + 1
	t.Logf("Allowed: %d, Expected max: %d", allowed, expectedMax)
	t.Logf("Elapsed: %v", elapsed)

	if allowed > expectedMax {
		t.Errorf("Over limit: allowed %d > expected max %d", allowed, expectedMax)
	}
}

func TestTokenBucketConsistency(t *testing.T) {
	rate := int64(1000)
	capacity := rate
	tb := NewTokenBucket(rate, capacity)

	for i := 0; i < int(capacity); i++ {
		tb.Allow()
	}

	remaining := tb.GetTokens()
	if remaining < 0 || remaining > capacity {
		t.Errorf("Invalid token count: %d (capacity: %d)", remaining, capacity)
	}

	initialTokens := tb.GetTokens()
	time.Sleep(100 * time.Millisecond)
	afterTokens := tb.GetTokens()

	expectedMinTokens := initialTokens + int64(float64(rate)*0.09)
	if afterTokens < expectedMinTokens {
		t.Logf("Token refill may be slow: %d < expected min %d", afterTokens, expectedMinTokens)
	}
}
