package collector

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type Span struct {
	TraceID      string                 `json:"traceId"`
	SpanID       string                 `json:"spanId"`
	ParentSpanID string                 `json:"parentSpanId,omitempty"`
	Name         string                 `json:"name"`
	ServiceName  string                 `json:"serviceName"`
	StartTime    time.Time              `json:"startTime"`
	EndTime      time.Time              `json:"endTime"`
	Duration     int64                  `json:"duration"`
	Tags         map[string]interface{} `json:"tags,omitempty"`
}

type Config struct {
	Port           int
	Elasticsearch  string
	LocalFile      string
	UseES          bool
	UseFile        bool
	Sampler        Sampler
}

type Collector struct {
	config  Config
	client  *http.Client
	spans   map[string][]Span
	spansMu sync.RWMutex
}

func NewCollector(config Config) *Collector {
	if config.Sampler == nil {
		config.Sampler = NewProbabilisticSampler(0.1)
	}

	return &Collector{
		config: config,
		client: &http.Client{Timeout: 5 * time.Second},
		spans:  make(map[string][]Span),
	}
}

func (c *Collector) Start() error {
	r := gin.Default()

	r.Use(c.corsMiddleware())

	r.POST("/spans", c.handleSpan)
	r.GET("/traces/:traceId", c.getTrace)
	r.GET("/traces", c.listTraces)
	r.GET("/health", c.healthCheck)

	addr := fmt.Sprintf(":%d", c.config.Port)
	fmt.Printf("Collector starting on %s, sample rate: %.2f%%\n",
		addr, c.config.Sampler.SampleRate()*100)

	return r.Run(addr)
}

func (c *Collector) corsMiddleware() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		ctx.Header("Access-Control-Allow-Origin", "*")
		ctx.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		ctx.Header("Access-Control-Allow-Headers", "Content-Type")

		if ctx.Request.Method == "OPTIONS" {
			ctx.AbortWithStatus(http.StatusOK)
			return
		}

		ctx.Next()
	}
}

func (c *Collector) handleSpan(ctx *gin.Context) {
	var span Span
	if err := ctx.ShouldBindJSON(&span); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if span.TraceID == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "traceId is required"})
		return
	}

	if !c.config.Sampler.ShouldSample(span.TraceID) {
		ctx.JSON(http.StatusOK, gin.H{"status": "dropped", "reason": "not sampled"})
		return
	}

	if err := c.storeSpan(&span); err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.cacheSpan(&span)

	ctx.JSON(http.StatusOK, gin.H{"status": "stored"})
}

func (c *Collector) cacheSpan(span *Span) {
	c.spansMu.Lock()
	defer c.spansMu.Unlock()

	if _, exists := c.spans[span.TraceID]; !exists {
		c.spans[span.TraceID] = []Span{}
	}
	c.spans[span.TraceID] = append(c.spans[span.TraceID], *span)

	if len(c.spans) > 1000 {
		for k := range c.spans {
			delete(c.spans, k)
			break
		}
	}
}

func (c *Collector) getTrace(ctx *gin.Context) {
	traceID := ctx.Param("traceId")

	c.spansMu.RLock()
	spans, exists := c.spans[traceID]
	c.spansMu.RUnlock()

	if !exists {
		ctx.JSON(http.StatusNotFound, gin.H{"error": "trace not found"})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{
		"traceId": traceID,
		"spans":   spans,
	})
}

func (c *Collector) listTraces(ctx *gin.Context) {
	c.spansMu.RLock()
	defer c.spansMu.RUnlock()

	traces := make([]map[string]interface{}, 0, len(c.spans))
	for traceID, spans := range c.spans {
		var minStart, maxEnd time.Time
		var totalDuration int64

		for i, span := range spans {
			if i == 0 || span.StartTime.Before(minStart) {
				minStart = span.StartTime
			}
			if i == 0 || span.EndTime.After(maxEnd) {
				maxEnd = span.EndTime
			}
			totalDuration += span.Duration
		}

		traces = append(traces, map[string]interface{}{
			"traceId":       traceID,
			"spanCount":     len(spans),
			"startTime":     minStart,
			"endTime":       maxEnd,
			"totalDuration": totalDuration,
		})
	}

	ctx.JSON(http.StatusOK, gin.H{
		"count":  len(traces),
		"traces": traces,
	})
}

func (c *Collector) healthCheck(ctx *gin.Context) {
	ctx.JSON(http.StatusOK, gin.H{
		"status":     "healthy",
		"sampleRate": c.config.Sampler.SampleRate(),
	})
}

func (c *Collector) storeSpan(span *Span) error {
	if c.config.UseES && c.config.Elasticsearch != "" {
		if err := c.writeToElasticsearch(span); err != nil {
			return err
		}
	}

	if c.config.UseFile && c.config.LocalFile != "" {
		if err := c.appendToFile(span); err != nil {
			return err
		}
	}

	return nil
}

func (c *Collector) writeToElasticsearch(span *Span) error {
	data, err := json.Marshal(span)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("%s/traces/_doc", c.config.Elasticsearch)
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return nil
}

func (c *Collector) appendToFile(span *Span) error {
	return nil
}
