package collector

import (
	"hash/fnv"
	"math/rand"
	"time"
)

type Sampler interface {
	ShouldSample(traceID string) bool
	SampleRate() float64
}

type ProbabilisticSampler struct {
	rate     float64
	threshold uint64
}

func NewProbabilisticSampler(rate float64) *ProbabilisticSampler {
	if rate < 0 || rate > 1 {
		rate = 0.1
	}
	threshold := uint64(float64(^uint64(0)) * rate)
	return &ProbabilisticSampler{
		rate:     rate,
		threshold: threshold,
	}
}

func (s *ProbabilisticSampler) ShouldSample(traceID string) bool {
	if traceID == "" {
		return false
	}

	h := fnv.New64a()
	h.Write([]byte(traceID))
	hashValue := h.Sum64()

	return hashValue <= s.threshold
}

func (s *ProbabilisticSampler) SampleRate() float64 {
	return s.rate
}

type RateLimitingSampler struct {
	maxTracesPerSecond int
	lastSampleTime     time.Time
	interval           time.Duration
	lastCount          int
}

func NewRateLimitingSampler(maxTracesPerSecond int) *RateLimitingSampler {
	if maxTracesPerSecond <= 0 {
		maxTracesPerSecond = 1
	}
	return &RateLimitingSampler{
		maxTracesPerSecond: maxTracesPerSecond,
		lastSampleTime:     time.Now(),
		interval:           time.Second,
	}
}

func (s *RateLimitingSampler) ShouldSample(traceID string) bool {
	now := time.Now()
	if now.Sub(s.lastSampleTime) >= s.interval {
		s.lastSampleTime = now
		s.lastCount = 0
	}

	if s.lastCount < s.maxTracesPerSecond {
		s.lastCount++
		return true
	}
	return false
}

func (s *RateLimitingSampler) SampleRate() float64 {
	return 1.0 / float64(s.maxTracesPerSecond)
}

type CompositeSampler struct {
	samplers []Sampler
}

func NewCompositeSampler(samplers ...Sampler) *CompositeSampler {
	return &CompositeSampler{
		samplers: samplers,
	}
}

func (s *CompositeSampler) ShouldSample(traceID string) bool {
	for _, sampler := range s.samplers {
		if !sampler.ShouldSample(traceID) {
			return false
		}
	}
	return true
}

func (s *CompositeSampler) SampleRate() float64 {
	if len(s.samplers) == 0 {
		return 0
	}
	return s.samplers[0].SampleRate()
}

type AlwaysSampler struct{}

func NewAlwaysSampler() *AlwaysSampler {
	return &AlwaysSampler{}
}

func (s *AlwaysSampler) ShouldSample(traceID string) bool {
	return true
}

func (s *AlwaysSampler) SampleRate() float64 {
	return 1.0
}

type NeverSampler struct{}

func NewNeverSampler() *NeverSampler {
	return &NeverSampler{}
}

func (s *NeverSampler) ShouldSample(traceID string) bool {
	return false
}

func (s *NeverSampler) SampleRate() float64 {
	return 0.0
}

func init() {
	rand.Seed(time.Now().UnixNano())
}
