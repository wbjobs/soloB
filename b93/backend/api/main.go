package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"trace-platform/backend/common/middleware"
	"trace-platform/backend/common/rca"
	"trace-platform/backend/common/sampler"

	"github.com/gin-gonic/gin"
)

type JaegerTrace struct {
	Data []TraceData `json:"data"`
}

type TraceData struct {
	TraceID   string      `json:"traceID"`
	Spans     []SpanData  `json:"spans"`
	Processes interface{} `json:"processes"`
}

type SpanData struct {
	TraceID       string                 `json:"traceID"`
	SpanID        string                 `json:"spanID"`
	OperationName string                 `json:"operationName"`
	StartTime     int64                  `json:"startTime"`
	Duration      int64                  `json:"duration"`
	References    []Reference            `json:"references"`
	Tags          []Tag                  `json:"tags"`
	ProcessID     string                 `json:"processID"`
}

type Reference struct {
	RefType string `json:"refType"`
	TraceID string `json:"traceID"`
	SpanID  string `json:"spanID"`
}

type Tag struct {
	Key   string      `json:"key"`
	Type  string      `json:"type"`
	Value interface{} `json:"value"`
}

type MockTraceStore struct {
	traces map[string]rca.Trace
	mu     sync.RWMutex
}

var store = &MockTraceStore{
	traces: make(map[string]rca.Trace),
}

func main() {
	r := gin.Default()

	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusOK)
			return
		}
		c.Next()
	})

	r.GET("/api/traces", listTraces)
	r.GET("/api/traces/:traceId", getTrace)
	r.GET("/api/analyze/:traceId", analyzeTrace)
	r.POST("/api/generate-slow-trace", generateSlowTrace)
	r.POST("/api/generate-network-delay", generateNetworkDelayTrace)
	r.GET("/api/services", listServices)
	r.GET("/api/sampling/stats", getSamplingStats)
	r.GET("/api/sampling/rules", getSamplingRules)
	r.POST("/api/sampling/simulate", simulateSampling)
	r.GET("/health", healthCheck)

	log.Println("API service starting on :8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func listTraces(c *gin.Context) {
	store.mu.RLock()
	defer store.mu.RUnlock()

	traces := make([]map[string]interface{}, 0, len(store.traces))
	for _, trace := range store.traces {
		var minStart, maxEnd time.Time
		for _, span := range trace.Spans {
			if minStart.IsZero() || span.StartTime.Before(minStart) {
				minStart = span.StartTime
			}
			if span.EndTime.After(maxEnd) {
				maxEnd = span.EndTime
			}
		}
		traces = append(traces, map[string]interface{}{
			"traceId":   trace.TraceID,
			"duration":  maxEnd.Sub(minStart).Milliseconds(),
			"spanCount": len(trace.Spans),
			"timestamp": minStart,
		})
	}

	c.JSON(http.StatusOK, gin.H{"traces": traces})
}

func getTrace(c *gin.Context) {
	traceID := c.Param("traceId")

	store.mu.RLock()
	trace, exists := store.traces[traceID]
	store.mu.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Trace not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"trace": trace})
}

func analyzeTrace(c *gin.Context) {
	traceID := c.Param("traceId")

	store.mu.RLock()
	trace, exists := store.traces[traceID]
	store.mu.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Trace not found"})
		return
	}

	result := rca.AnalyzeTrace(trace)

	c.JSON(http.StatusOK, result)
}

func generateSlowTrace(c *gin.Context) {
	traceID := generateTraceID()
	now := time.Now()

	spans := make([]rca.Span, 0)

	rootSpan := rca.Span{
		TraceID:     traceID,
		SpanID:      generateSpanID(),
		ServiceName: "order-service",
		Operation:   "POST /api/orders",
		StartTime:   now,
		EndTime:     now.Add(1800 * time.Millisecond),
		Duration:    1800 * time.Millisecond,
		Attributes: map[string]interface{}{
			"http.method": "POST",
			"http.route":  "/api/orders",
		},
		Status: "ok",
	}
	spans = append(spans, rootSpan)

	invStart := now.Add(50 * time.Millisecond)
	invCallSpan := rca.Span{
		TraceID:     traceID,
		SpanID:      generateSpanID(),
		ParentID:    rootSpan.SpanID,
		ServiceName: "order-service",
		Operation:   "call_inventory_service",
		StartTime:   invStart,
		EndTime:     invStart.Add(700 * time.Millisecond),
		Duration:    700 * time.Millisecond,
		Attributes: map[string]interface{}{
			"external.service":  "inventory-service",
			"external.endpoint": "/api/inventory/reserve",
			"code.filepath":     "backend/order/main.go",
			"code.lineno":       103,
		},
		Status: "ok",
	}
	spans = append(spans, invCallSpan)

	invOpStart := invStart.Add(30 * time.Millisecond)
	invOpSpan := rca.Span{
		TraceID:     traceID,
		SpanID:      generateSpanID(),
		ParentID:    invCallSpan.SpanID,
		ServiceName: "inventory-service",
		Operation:   "reserveInventory",
		StartTime:   invOpStart,
		EndTime:     invOpStart.Add(650 * time.Millisecond),
		Duration:    650 * time.Millisecond,
		Attributes: map[string]interface{}{
			"code.filepath": "backend/inventory/main.go",
			"code.lineno":   52,
		},
		Status: "ok",
	}
	spans = append(spans, invOpSpan)

	slowSQLStart := invOpStart.Add(50 * time.Millisecond)
	slowSQLSpan := rca.Span{
		TraceID:     traceID,
		SpanID:      generateSpanID(),
		ParentID:    invOpSpan.SpanID,
		ServiceName: "inventory-service",
		Operation:   "db.query",
		StartTime:   slowSQLStart,
		EndTime:     slowSQLStart.Add(550 * time.Millisecond),
		Duration:    550 * time.Millisecond,
		Attributes: map[string]interface{}{
			"db.statement":  "SELECT stock FROM inventory WHERE product_id = 'PROD-001'",
			"db.system":     "mysql",
			"db.slow_query": true,
			"code.filepath": "backend/common/database/mock_db.go",
			"code.lineno":   25,
			"time.network_ms": 50.0,
			"time.process_ms": 500.0,
			"time.queue_ms":   0.0,
		},
		Status: "ok",
	}
	spans = append(spans, slowSQLSpan)

	payStart := now.Add(800 * time.Millisecond)
	payCallSpan := rca.Span{
		TraceID:     traceID,
		SpanID:      generateSpanID(),
		ParentID:    rootSpan.SpanID,
		ServiceName: "order-service",
		Operation:   "call_payment_service",
		StartTime:   payStart,
		EndTime:     payStart.Add(600 * time.Millisecond),
		Duration:    600 * time.Millisecond,
		Attributes: map[string]interface{}{
			"external.service":  "payment-service",
			"external.endpoint": "/api/payments/process",
			"code.filepath":     "backend/order/main.go",
			"code.lineno":       121,
		},
		Status: "ok",
	}
	spans = append(spans, payCallSpan)

	bizStart := now.Add(1500 * time.Millisecond)
	bizSpan := rca.Span{
		TraceID:     traceID,
		SpanID:      generateSpanID(),
		ParentID:    rootSpan.SpanID,
		ServiceName: "order-service",
		Operation:   "business_logic",
		StartTime:   bizStart,
		EndTime:     bizStart.Add(280 * time.Millisecond),
		Duration:    280 * time.Millisecond,
		Attributes: map[string]interface{}{
			"code.filepath": "backend/order/main.go",
			"code.lineno":   92,
		},
		Status: "ok",
	}
	spans = append(spans, bizSpan)

	trace := rca.Trace{
		TraceID: traceID,
		Spans:   spans,
	}

	store.mu.Lock()
	store.traces[traceID] = trace
	store.mu.Unlock()

	c.JSON(http.StatusOK, gin.H{
		"traceId": traceID,
		"message": "Slow trace generated successfully with root cause analysis",
	})
}

func generateNetworkDelayTrace(c *gin.Context) {
	traceID := generateTraceID()
	now := time.Now()

	spans := make([]rca.Span, 0)

	rootSpan := rca.Span{
		TraceID:     traceID,
		SpanID:      generateSpanID(),
		ServiceName: "order-service",
		Operation:   "POST /api/orders",
		StartTime:   now,
		EndTime:     now.Add(2000 * time.Millisecond),
		Duration:    2000 * time.Millisecond,
		Attributes: map[string]interface{}{
			"http.method":     "POST",
			"http.route":      "/api/orders",
			"time.network_ms": 1200.0,
			"time.process_ms": 800.0,
			"time.queue_ms":   0.0,
		},
		Status: "ok",
	}
	spans = append(spans, rootSpan)

	invStart := now.Add(100 * time.Millisecond)
	invCallSpan := rca.Span{
		TraceID:     traceID,
		SpanID:      generateSpanID(),
		ParentID:    rootSpan.SpanID,
		ServiceName: "order-service",
		Operation:   "call_inventory_service",
		StartTime:   invStart,
		EndTime:     invStart.Add(1500 * time.Millisecond),
		Duration:    1500 * time.Millisecond,
		Attributes: map[string]interface{}{
			"external.service":  "inventory-service",
			"external.endpoint": "/api/inventory/reserve",
			"code.filepath":     "backend/order/main.go",
			"code.lineno":       103,
			"time.network_ms":   1100.0,
			"time.process_ms":   400.0,
			"time.queue_ms":     0.0,
		},
		Status: "ok",
	}
	spans = append(spans, invCallSpan)

	invOpStart := invStart.Add(500 * time.Millisecond)
	invOpSpan := rca.Span{
		TraceID:     traceID,
		SpanID:      generateSpanID(),
		ParentID:    invCallSpan.SpanID,
		ServiceName: "inventory-service",
		Operation:   "reserveInventory",
		StartTime:   invOpStart,
		EndTime:     invOpStart.Add(900 * time.Millisecond),
		Duration:    900 * time.Millisecond,
		Attributes: map[string]interface{}{
			"code.filepath": "backend/inventory/main.go",
			"code.lineno":   52,
			"time.network_ms": 0.0,
			"time.process_ms": 900.0,
			"time.queue_ms":   0.0,
		},
		Status: "ok",
	}
	spans = append(spans, invOpSpan)

	dbStart := invOpStart.Add(50 * time.Millisecond)
	dbSpan := rca.Span{
		TraceID:     traceID,
		SpanID:      generateSpanID(),
		ParentID:    invOpSpan.SpanID,
		ServiceName: "inventory-service",
		Operation:   "db.query",
		StartTime:   dbStart,
		EndTime:     dbStart.Add(800 * time.Millisecond),
		Duration:    800 * time.Millisecond,
		Attributes: map[string]interface{}{
			"db.statement":    "SELECT stock FROM inventory WHERE product_id = 'PROD-001'",
			"db.system":       "mysql",
			"code.filepath":   "backend/common/database/mock_db.go",
			"code.lineno":     25,
			"time.network_ms": 650.0,
			"time.process_ms": 150.0,
			"time.queue_ms":   0.0,
		},
		Status: "ok",
	}
	spans = append(spans, dbSpan)

	trace := rca.Trace{
		TraceID: traceID,
		Spans:   spans,
	}

	store.mu.Lock()
	store.traces[traceID] = trace
	store.mu.Unlock()

	c.JSON(http.StatusOK, gin.H{
		"traceId": traceID,
		"message": "Network delay scenario generated - should detect network as root cause instead of slow SQL",
		"scenario": "网络延迟占比高(81.25%)，虽然是数据库操作，但RCA应正确识别为网络问题",
	})
}

func listServices(c *gin.Context) {
	services := []string{"order-service", "inventory-service", "payment-service", "api-service"}
	c.JSON(http.StatusOK, gin.H{"services": services})
}

func healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "healthy", "service": "api-service"})
}

func generateTraceID() string {
	return fmt.Sprintf("%016x", time.Now().UnixNano())
}

func generateSpanID() string {
	return fmt.Sprintf("%016x", time.Now().UnixNano()^int64(time.Now().Unix()))
}

func getSamplingStats(c *gin.Context) {
	sampler := middleware.GetGlobalSampler()
	stats := sampler.GetStats()
	
	qps := stats.CurrentQPS
	sampleMode := middleware.GetSampleMode(qps)
	
	savingsRate := 0.0
	if stats.TotalTraces > 0 {
		savingsRate = float64(stats.DroppedTraces) / float64(stats.TotalTraces) * 100
	}
	
	c.JSON(http.StatusOK, gin.H{
		"currentQPS":        qps,
		"totalTraces":      stats.TotalTraces,
		"sampledTraces":    stats.SampledTraces,
		"droppedTraces":    stats.DroppedTraces,
		"savingsRate":      savingsRate,
		"sampleMode":       sampleMode,
		"qpsThreshold":     sampler.QPSThresholdHigh,
		"highLoadMode":     qps > sampler.QPSThresholdHigh,
		"criticalRate":     sampler.HighPriorityRate,
		"mediumRate":       sampler.MediumPriorityRate,
		"lowRate":          sampler.UltraLowPriorityRate,
	})
}

func getSamplingRules(c *gin.Context) {
	sampler := middleware.GetGlobalSampler()
	rules := sampler.GetPriorityRules()
	
	rulesList := make([]map[string]interface{}, 0, len(rules))
	for _, rule := range rules {
		rulesList = append(rulesList, map[string]interface{}{
			"name":        rule.Name,
			"description": rule.Description,
			"priority":    middleware.GetPriorityName(rule.Priority),
			"priorityDesc": middleware.GetPriorityDescription(rule.Priority),
		})
	}
	
	c.JSON(http.StatusOK, gin.H{
		"rules": rulesList,
		"priorities": map[string]string{
			"CRITICAL": "100% 采样 - 核心业务/错误/慢调用",
			"HIGH":     "QPS>1000时降为50% - 高优先级业务",
			"MEDIUM":   "QPS>500时降为20% - 普通查询",
			"LOW":      "QPS>1000时降为1% - 健康检查等",
		},
		"thresholds": map[string]float64{
			"highQPS":   sampler.QPSThresholdHigh,
			"mediumQPS": sampler.QPSThresholdMedium,
		},
	})
}

type SimulateRequest struct {
	Path       string `json:"path"`
	Method     string `json:"method"`
	Service    string `json:"service"`
	DurationMs int64  `json:"durationMs"`
	HasError   bool   `json:"hasError"`
	SimulateQPS float64 `json:"simulateQPS"`
}

func simulateSampling(c *gin.Context) {
	var req SimulateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	duration := time.Duration(req.DurationMs) * time.Millisecond
	
	decision := simulateSamplingDecision(req.Path, req.Method, req.Service, duration, req.HasError, req.SimulateQPS)
	
	c.JSON(http.StatusOK, gin.H{
		"shouldSample": decision.ShouldSample,
		"priority":     middleware.GetPriorityName(decision.Priority),
		"priorityDesc": middleware.GetPriorityDescription(decision.Priority),
		"sampleRate":   decision.SampleRate,
		"reason":       decision.Reason,
		"simulatedQPS": req.SimulateQPS,
		"storageImpact": calculateStorageImpact(decision.SampleRate),
		"rcaImpact":     calculateRCAImpact(decision.Priority, decision.ShouldSample),
	})
}

func simulateSamplingDecision(path, method, service string, duration time.Duration, hasError bool, simulateQPS float64) sampler.SampleDecision {
	var priority sampler.TracePriority
	
	if hasError {
		priority = sampler.PriorityCritical
	} else if duration > 500*time.Millisecond {
		priority = sampler.PriorityCritical
	} else if path == "/health" || path == "/ready" || path == "/live" {
		priority = sampler.PriorityLow
	} else if (service == "order-service" && (path == "/api/orders" || path == "/api/payments")) ||
		(service == "inventory-service" && path == "/api/inventory/reserve") {
		priority = sampler.PriorityCritical
	} else if method == "POST" || method == "PUT" || method == "DELETE" {
		priority = sampler.PriorityHigh
	} else if method == "GET" {
		priority = sampler.PriorityMedium
	} else {
		priority = sampler.PriorityMedium
	}
	
	var sampleRate float64
	switch priority {
	case sampler.PriorityCritical:
		sampleRate = sampler.HighPriorityRate
	case sampler.PriorityHigh:
		if simulateQPS > sampler.QPSThresholdHigh {
			sampleRate = 0.5
		} else {
			sampleRate = sampler.HighPriorityRate
		}
	case sampler.PriorityMedium:
		if simulateQPS > sampler.QPSThresholdHigh {
			sampleRate = sampler.LowPriorityRate
		} else if simulateQPS > sampler.QPSThresholdMedium {
			sampleRate = sampler.MediumPriorityRate
		} else {
			sampleRate = sampler.MediumPriorityRate
		}
	case sampler.PriorityLow:
		if simulateQPS > sampler.QPSThresholdHigh {
			sampleRate = sampler.UltraLowPriorityRate
		} else if simulateQPS > sampler.QPSThresholdMedium {
			sampleRate = sampler.LowPriorityRate
		} else {
			sampleRate = sampler.MediumPriorityRate
		}
	}
	
	reason := "优先级: " + middleware.GetPriorityName(priority)
	if simulateQPS > sampler.QPSThresholdHigh {
		reason += ", 高QPS(>1000)模式"
	} else if simulateQPS > sampler.QPSThresholdMedium {
		reason += ", 中QPS(>500)模式"
	} else {
		reason += ", 正常QPS模式"
	}
	reason += fmt.Sprintf(", 采样率: %.0f%%", sampleRate*100)
	
	if priority == sampler.PriorityCritical {
		reason = "关键路径/错误/慢调用请求，100%采样用于根因分析"
	}
	
	return sampler.SampleDecision{
		ShouldSample: sampleRate >= 1.0 || (sampleRate > 0 && sampleRate < 1.0),
		Priority:     priority,
		SampleRate:   sampleRate,
		Reason:       reason,
	}
}

func calculateStorageImpact(sampleRate float64) map[string]interface{} {
	dailyRequests := 1000000.0 // 假设日均100万请求
	traceSizeKB := 5.0         // 假设每个trace平均5KB
	
	originalStorage := dailyRequests * traceSizeKB / 1024 / 1024 // GB
	estimatedStorage := originalStorage * sampleRate
	savings := originalStorage - estimatedStorage
	savingsPercent := (1 - sampleRate) * 100
	
	return map[string]interface{}{
		"originalStorageGB":  fmt.Sprintf("%.2f GB/天", originalStorage),
		"estimatedStorageGB": fmt.Sprintf("%.2f GB/天", estimatedStorage),
		"savingsGB":          fmt.Sprintf("%.2f GB/天", savings),
		"savingsPercent":     fmt.Sprintf("%.1f%%", savingsPercent),
		"monthlySavingsTB":   fmt.Sprintf("%.2f TB/月", savings*30/1024),
	}
}

func calculateRCAImpact(priority sampler.TracePriority, shouldSample bool) map[string]interface{} {
	impact := map[string]interface{}{
		"criticalTracesGuaranteed": priority == sampler.PriorityCritical,
		"rcaAccuracyImpact":        "无影响",
		"recommendation":           "根因分析准确性有保障",
	}
	
	if priority == sampler.PriorityCritical {
		impact["rcaAccuracyImpact"] = "错误和慢调用100%采样，RCA准确性完全保障"
	} else if !shouldSample {
		impact["rcaAccuracyImpact"] = "非核心请求被采样丢弃，不影响RCA"
		impact["recommendation"] = "仅丢弃低优先级trace，核心业务trace完整保留"
	}
	
	return impact
}
