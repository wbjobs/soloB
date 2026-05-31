package middleware

import (
	"bytes"
	"io"
	"time"

	"trace-platform/backend/common/sampler"

	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

var globalSampler = sampler.NewSmartSampler()

func GetGlobalSampler() *sampler.SmartSampler {
	return globalSampler
}

func SmartSamplingMiddleware(serviceName string, tracer trace.Tracer) gin.HandlerFunc {
	return func(c *gin.Context) {
		startTime := time.Now()
		path := c.Request.URL.Path
		method := c.Request.Method

		var bodyBytes []byte
		if c.Request.Body != nil {
			bodyBytes, _ = io.ReadAll(c.Request.Body)
			c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
		}

		c.Next()

		duration := time.Since(startTime)
		hasError := len(c.Errors) > 0 || c.Writer.Status() >= 500

		decision := globalSampler.ShouldSample(path, method, serviceName, duration, hasError)

		ctx, span := tracer.Start(c.Request.Context(), method+" "+path)
		defer span.End()

		span.SetAttributes(
			attribute.String("http.path", path),
			attribute.String("http.method", method),
			attribute.Int("http.status_code", c.Writer.Status()),
			attribute.Int64("http.duration_ms", duration.Milliseconds()),
			attribute.Bool("sampling.should_sample", decision.ShouldSample),
			attribute.Int("sampling.priority", int(decision.Priority)),
			attribute.Float64("sampling.rate", decision.SampleRate),
			attribute.String("sampling.reason", decision.Reason),
		)

		if decision.ShouldSample {
			span.SetAttributes(attribute.Bool("sampling.sampled", true))
		} else {
			span.SetAttributes(attribute.Bool("sampling.dropped", true))
		}

		c.Set("sampling_decision", decision)
		c.Set("sampling_stats", globalSampler.GetStats())
	}
}

func SamplingStatsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		stats := globalSampler.GetStats()
		c.Set("sampling_stats", stats)
		c.Next()
	}
}

func GetPriorityName(priority sampler.TracePriority) string {
	switch priority {
	case sampler.PriorityCritical:
		return "CRITICAL"
	case sampler.PriorityHigh:
		return "HIGH"
	case sampler.PriorityMedium:
		return "MEDIUM"
	case sampler.PriorityLow:
		return "LOW"
	default:
		return "UNKNOWN"
	}
}

func GetPriorityDescription(priority sampler.TracePriority) string {
	switch priority {
	case sampler.PriorityCritical:
		return "核心业务/错误/慢调用 - 100%采样"
	case sampler.PriorityHigh:
		return "高优先级业务 - QPS>1000时降为50%"
	case sampler.PriorityMedium:
		return "中优先级业务 - QPS>500时降为20%"
	case sampler.PriorityLow:
		return "低优先级业务 - QPS>1000时降为1%"
	default:
		return "未知优先级"
	}
}

func GetSampleMode(qps float64) string {
	if qps > sampler.QPSThresholdHigh {
		return "HIGH_LOAD_MODE - 高负载降采样已激活"
	} else if qps > sampler.QPSThresholdMedium {
		return "MEDIUM_LOAD_MODE - 中负载降采样已激活"
	}
	return "NORMAL_MODE - 正常采样"
}
