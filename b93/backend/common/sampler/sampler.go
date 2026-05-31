package sampler

import (
	"context"
	"math"
	"math/rand"
	"sync"
	"time"
)

type TracePriority int

const (
	PriorityCritical TracePriority = iota // 核心业务（100%采样）
	PriorityHigh                          // 高优先级（50%采样）
	PriorityMedium                        // 中优先级（20%采样）
	PriorityLow                           // 低优先级（QPS>1000时1%采样）
)

const (
	QPSThresholdHigh     = 1000.0 // QPS阈值，超过触发降采样
	QPSThresholdMedium   = 500.0  // QPS中阈值，触发中度中度降采样
	HighPriorityRate     = 1.0    // 100%采样
	MediumPriorityRate   = 0.5    // 50%采样
	LowPriorityRate      = 0.2    // 20%采样
	UltraLowPriorityRate = 0.01   // 1%采样
)

type SampleDecision struct {
	ShouldSample bool
	Priority     TracePriority
	SampleRate   float64
	Reason       string
}

type QPSStats struct {
	CurrentQPS      float64
	WindowStart    time.Time
	RequestCount    int64
	TotalTraces    int64
	SampledTraces  int64
	DroppedTraces  int64
}

type SmartSampler struct {
	mu                 sync.RWMutex
	qpsWindow        *SlidingWindow
	priorityRules   []PriorityRule
	stats           QPSStats
	highQPSMode   bool
}

type SlidingWindow struct {
	mu          sync.RWMutex
	buckets     []int64
	bucketSize  time.Duration
	windowSize   time.Duration
	currentBucket int
	lastMove     time.Time
}

type PriorityRule struct {
	Name        string
	MatchFunc   func(path, method, service string, duration time.Duration, hasError bool) bool
	Priority    TracePriority
	Description string
}

func NewSlidingWindow(windowSize time.Duration, bucketCount int) *SlidingWindow {
	bucketSize := windowSize / time.Duration(bucketCount)
	return &SlidingWindow{
		buckets:    make([]int64, bucketCount),
		bucketSize:  bucketSize,
		windowSize:   windowSize,
		lastMove:     time.Now(),
	}
}

func (sw *SlidingWindow) Increment() {
	sw.mu.Lock()
	defer sw.mu.Unlock()
	sw.advance()
	sw.buckets[sw.currentBucket]++
}

func (sw *SlidingWindow) advance() {
	now := time.Now()
	elapsed := now.Sub(sw.lastMove)
	bucketsToMove := int(elapsed / sw.bucketSize)
	
	if bucketsToMove > 0 {
		if bucketsToMove > len(sw.buckets) {
			bucketsToMove = len(sw.buckets)
		}
		
		for i := 1; i <= bucketsToMove; i++ {
			idx := (sw.currentBucket + i) % len(sw.buckets)
			sw.buckets[idx] = 0
		}
		
		sw.currentBucket = (sw.currentBucket + bucketsToMove) % len(sw.buckets)
		sw.lastMove = now
	}
}

func (sw *SlidingWindow) GetQPS() float64 {
	sw.mu.RLock()
	defer sw.mu.RUnlock()
	sw.advance()
	
	var total int64
	for _, b := range sw.buckets {
		total += b
	}
	
	windowSeconds := sw.windowSize.Seconds()
	return float64(total) / windowSeconds
}

func NewSmartSampler() *SmartSampler {
	s := &SmartSampler{
		qpsWindow: NewSlidingWindow(10*time.Second, 10),
	}
	
	s.registerDefaultRules()
	go s.startStatsCollector()
	
	return s
}

func (s *SmartSampler) registerDefaultRules() {
	s.priorityRules = []PriorityRule{
		{
			Name:        "错误调用",
			Description: "错误请求100%采样用于根因分析",
			MatchFunc: func(path, method, service string, duration time.Duration, hasError bool) bool {
				return hasError
			},
			Priority: PriorityCritical,
		},
		{
			Name:        "慢调用",
			Description: "耗时>500ms的请求100%采样",
			MatchFunc: func(path, method, service string, duration time.Duration, hasError bool) bool {
				return duration > 500*time.Millisecond
			},
			Priority: PriorityCritical,
		},
		{
			Name:        "健康检查",
			Description: "健康检查接口属于低优先级",
			MatchFunc: func(path, method, service string, duration time.Duration, hasError bool) bool {
				return path == "/health" || path == "/ready" || path == "/live"
			},
			Priority: PriorityLow,
		},
		{
			Name:        "订单服务核心接口",
			Description: "订单创建、支付等核心接口高优先级",
			MatchFunc: func(path, method, service string, duration time.Duration, hasError bool) bool {
				return service == "order-service" && 
					(path == "/api/orders" || path == "/api/payments")
			},
			Priority: PriorityCritical,
		},
		{
			Name:        "库存服务核心接口",
			Description: "库存预留等核心接口高优先级",
			MatchFunc: func(path, method, service string, duration time.Duration, hasError bool) bool {
				return service == "inventory-service" && path == "/api/inventory/reserve"
			},
			Priority: PriorityCritical,
		},
		{
			Name:        "POST操作",
			Description: "写入操作优先级高于读取操作",
			MatchFunc: func(path, method, service string, duration time.Duration, hasError bool) bool {
				return method == "POST" || method == "PUT" || method == "DELETE"
			},
			Priority: PriorityHigh,
		},
		{
			Name:        "GET查询操作",
			Description: "普通查询接口中优先级",
			MatchFunc: func(path, method, service string, duration time.Duration, hasError bool) bool {
				return method == "GET"
			},
			Priority: PriorityMedium,
		},
	}
}

func (s *SmartSampler) ShouldSample(path, method, service string, duration time.Duration, hasError bool) SampleDecision {
	s.qpsWindow.Increment()
	currentQPS := s.qpsWindow.GetQPS()
	
	s.mu.Lock()
	s.stats.TotalTraces++
	s.mu.Unlock()
	
	priority := s.determinePriority(path, method, service, duration, hasError)
	sampleRate := s.calculateSampleRate(priority, currentQPS)
	
	shouldSample := true
	reason := "默认采样"
	
	if sampleRate < 1.0 {
		randomValue := rand.Float64()
		shouldSample = randomValue < sampleRate
		reason = s.getSampleReason(priority, sampleRate, currentQPS)
	}
	
	if shouldSample {
		s.mu.Lock()
		s.stats.SampledTraces++
		s.mu.Unlock()
	} else {
		s.mu.Lock()
		s.stats.DroppedTraces++
		s.mu.Unlock()
	}
	
	return SampleDecision{
		ShouldSample: shouldSample,
		Priority:     priority,
		SampleRate:   sampleRate,
		Reason:       reason,
	}
}

func (s *SmartSampler) determinePriority(path, method, service string, duration time.Duration, hasError bool) TracePriority {
	for _, rule := range s.priorityRules {
		if rule.MatchFunc(path, method, service, duration, hasError) {
			return rule.Priority
		}
	}
	return PriorityMedium
}

func (s *SmartSampler) calculateSampleRate(priority TracePriority, qps float64) float64 {
	switch priority {
	case PriorityCritical:
		return HighPriorityRate
	case PriorityHigh:
		if qps > QPSThresholdHigh {
			return 0.5
		}
		return HighPriorityRate
	case PriorityMedium:
		if qps > QPSThresholdHigh {
			return LowPriorityRate
		} else if qps > QPSThresholdMedium {
			return MediumPriorityRate
		}
		return MediumPriorityRate
	case PriorityLow:
		if qps > QPSThresholdHigh {
			return UltraLowPriorityRate
		} else if qps > QPSThresholdMedium {
			return LowPriorityRate
		}
		return MediumPriorityRate
	default:
		return MediumPriorityRate
	}
}

func (s *SmartSampler) getSampleReason(priority TracePriority, sampleRate float64, qps float64) string {
	priorityNames := map[TracePriority]string{
		PriorityCritical: "CRITICAL",
		PriorityHigh:     "HIGH",
		PriorityMedium:   "MEDIUM",
		PriorityLow:       "LOW",
	}
	
	if priority == PriorityCritical {
		return "关键路径/错误请求，100%采样用于根因分析"
	}
	
	qpsLevel := "正常QPS"
	if qps > QPSThresholdHigh {
		qpsLevel = "高QPS(>1000)"
	} else if qps > QPSThresholdMedium {
		qpsLevel = "中QPS(>500)"
	}
	
	return "优先级: " + priorityNames[priority] + ", " + qpsLevel + ", 采样率: " + formatPercent(sampleRate)
}

func formatPercent(rate float64) string {
	if rate >= 1.0 {
		return "100%"
	}
	return string(rune(int(math.Round(rate * 100)))) + "%"
}

func (s *SmartSampler) GetStats() QPSStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	return QPSStats{
		CurrentQPS:     s.qpsWindow.GetQPS(),
		RequestCount:  s.stats.RequestCount,
		TotalTraces:   s.stats.TotalTraces,
		SampledTraces: s.stats.SampledTraces,
		DroppedTraces: s.stats.DroppedTraces,
	}
}

func (s *SmartSampler) startStatsCollector() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	
	for range ticker.C {
		s.mu.Lock()
		s.stats.RequestCount = 0
		s.mu.Unlock()
	}
}

func (s *SmartSampler) GetPriorityRules() []PriorityRule {
	return s.priorityRules
}

func (s *SmartSampler) AddCustomRule(rule PriorityRule) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.priorityRules = append(s.priorityRules, rule)
}
