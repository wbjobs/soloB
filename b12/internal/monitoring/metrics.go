package monitoring

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type Metrics struct {
	JobsTotal         *prometheus.CounterVec
	JobsActive        prometheus.Gauge
	TasksTotal        *prometheus.CounterVec
	TasksRunning      prometheus.Gauge
	TaskDuration      *prometheus.HistogramVec
	ExecutorLoad      *prometheus.GaugeVec
	PipelineMessages  *prometheus.CounterVec
	PipelineErrors    *prometheus.CounterVec
	KafkaLag          *prometheus.GaugeVec
	APIRequests       *prometheus.CounterVec
	APIRequestLatency *prometheus.HistogramVec
}

func NewMetrics(namespace string) *Metrics {
	return &Metrics{
		JobsTotal: promauto.NewCounterVec(
			prometheus.CounterOpts{
				Namespace: namespace,
				Name:      "jobs_total",
				Help:      "Total number of jobs processed",
			},
			[]string{"job_id", "status"},
		),
		JobsActive: promauto.NewGauge(
			prometheus.GaugeOpts{
				Namespace: namespace,
				Name:      "jobs_active",
				Help:      "Number of active jobs",
			},
		),
		TasksTotal: promauto.NewCounterVec(
			prometheus.CounterOpts{
				Namespace: namespace,
				Name:      "tasks_total",
				Help:      "Total number of tasks executed",
			},
			[]string{"task_id", "status", "executor"},
		),
		TasksRunning: promauto.NewGauge(
			prometheus.GaugeOpts{
				Namespace: namespace,
				Name:      "tasks_running",
				Help:      "Number of tasks currently running",
			},
		),
		TaskDuration: promauto.NewHistogramVec(
			prometheus.HistogramOpts{
				Namespace: namespace,
				Name:      "task_duration_seconds",
				Help:      "Task execution duration in seconds",
				Buckets:   []float64{0.1, 0.5, 1, 5, 10, 30, 60, 300},
			},
			[]string{"task_id", "status"},
		),
		ExecutorLoad: promauto.NewGaugeVec(
			prometheus.GaugeOpts{
				Namespace: namespace,
				Name:      "executor_load",
				Help:      "Current load on each executor",
			},
			[]string{"executor_id"},
		),
		PipelineMessages: promauto.NewCounterVec(
			prometheus.CounterOpts{
				Namespace: namespace,
				Name:      "pipeline_messages_total",
				Help:      "Total messages processed by streaming pipeline",
			},
			[]string{"pipeline_id", "direction"},
		),
		PipelineErrors: promauto.NewCounterVec(
			prometheus.CounterOpts{
				Namespace: namespace,
				Name:      "pipeline_errors_total",
				Help:      "Total errors in streaming pipeline",
			},
			[]string{"pipeline_id", "error_type"},
		),
		KafkaLag: promauto.NewGaugeVec(
			prometheus.GaugeOpts{
				Namespace: namespace,
				Name:      "kafka_consumer_lag",
				Help:      "Kafka consumer lag",
			},
			[]string{"topic", "partition", "group"},
		),
		APIRequests: promauto.NewCounterVec(
			prometheus.CounterOpts{
				Namespace: namespace,
				Name:      "api_requests_total",
				Help:      "Total API requests",
			},
			[]string{"method", "path", "status"},
		),
		APIRequestLatency: promauto.NewHistogramVec(
			prometheus.HistogramOpts{
				Namespace: namespace,
				Name:      "api_request_duration_seconds",
				Help:      "API request duration",
				Buckets:   []float64{0.01, 0.05, 0.1, 0.5, 1, 5},
			},
			[]string{"method", "path"},
		),
	}
}

func (m *Metrics) Handler() http.Handler {
	return promhttp.Handler()
}

func (m *Metrics) RecordJob(jobID, status string) {
	m.JobsTotal.WithLabelValues(jobID, status).Inc()
}

func (m *Metrics) RecordTask(taskID, status, executor string, duration float64) {
	m.TasksTotal.WithLabelValues(taskID, status, executor).Inc()
	m.TaskDuration.WithLabelValues(taskID, status).Observe(duration)
}

func (m *Metrics) SetExecutorLoad(executorID string, load float64) {
	m.ExecutorLoad.WithLabelValues(executorID).Set(load)
}

func (m *Metrics) RecordPipelineMessage(pipelineID, direction string) {
	m.PipelineMessages.WithLabelValues(pipelineID, direction).Inc()
}

func (m *Metrics) RecordPipelineError(pipelineID, errorType string) {
	m.PipelineErrors.WithLabelValues(pipelineID, errorType).Inc()
}

func (m *Metrics) RecordAPIRequest(method, path, status string, latency float64) {
	m.APIRequests.WithLabelValues(method, path, status).Inc()
	m.APIRequestLatency.WithLabelValues(method, path).Observe(latency)
}
