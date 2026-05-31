package models

import (
	"time"
	"gorm.io/gorm"
)

type SlowQuery struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
	QueryHash   string         `gorm:"index;size:64" json:"query_hash"`
	SQL         string         `gorm:"type:text" json:"sql"`
	Database    string         `gorm:"size:128" json:"database"`
	User        string         `gorm:"size:64" json:"user"`
	DurationMs  float64        `gorm:"index" json:"duration_ms"`
	RowsExamined int64         `json:"rows_examined"`
	RowsSent    int64          `json:"rows_sent"`
	Timestamp   time.Time      `gorm:"index" json:"timestamp"`
	ProcessID   uint32         `json:"process_id"`
	ThreadID    uint32         `json:"thread_id"`
}

type KernelMetrics struct {
	ID              uint           `gorm:"primaryKey" json:"id"`
	CreatedAt       time.Time      `json:"created_at"`
	SlowQueryID     uint           `gorm:"index" json:"slow_query_id"`
	Timestamp       time.Time      `gorm:"index" json:"timestamp"`
	ProcessID       uint32         `gorm:"index" json:"process_id"`
	IOReadBytes     int64          `json:"io_read_bytes"`
	IOWriteBytes    int64          `json:"io_write_bytes"`
	IOReadCount     int64          `json:"io_read_count"`
	IOWriteCount    int64          `json:"io_write_count"`
	IOLatencyAvgMs  float64        `json:"io_latency_avg_ms"`
	IOLatencyMaxMs  float64        `json:"io_latency_max_ms"`
	PageCacheHits   int64          `json:"page_cache_hits"`
	PageCacheMisses int64          `json:"page_cache_misses"`
	PageCacheHitRate float64       `json:"page_cache_hit_rate"`
	TCPTxBytes      int64          `json:"tcp_tx_bytes"`
	TCPRxBytes      int64          `json:"tcp_rx_bytes"`
	MemAllocBytes   int64          `json:"mem_alloc_bytes"`
	MemFreeBytes    int64          `json:"mem_free_bytes"`
	LockWaitTimeMs  float64        `json:"lock_wait_time_ms"`
	LockCount       int64          `json:"lock_count"`
	StackSample     string         `gorm:"type:text" json:"stack_sample"`
	CPUCycles       int64          `json:"cpu_cycles"`
	CPUInstructions int64          `json:"cpu_instructions"`
}

type FlameGraph struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	CreatedAt   time.Time `json:"created_at"`
	SlowQueryID uint      `gorm:"index" json:"slow_query_id"`
	Data        string    `gorm:"type:text" json:"data"`
	SampleCount int64     `json:"sample_count"`
}

type QueryTrend struct {
	Timestamp   time.Time `json:"timestamp"`
	QueryHash   string    `json:"query_hash"`
	AvgDuration float64   `json:"avg_duration"`
	Count       int64     `json:"count"`
	P95Duration float64   `json:"p95_duration"`
}

type AnomalyEvent struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	CreatedAt      time.Time `json:"created_at"`
	Timestamp      time.Time `gorm:"index" json:"timestamp"`
	EventType      string    `gorm:"size:64" json:"event_type"`
	Severity       string    `gorm:"size:32" json:"severity"`
	Description    string    `gorm:"type:text" json:"description"`
	SlowQueryID    *uint     `gorm:"index" json:"slow_query_id"`
	CorrelationScore float64  `json:"correlation_score"`
	Metrics        string    `gorm:"type:text" json:"metrics"`
}

type DiagnosticReport struct {
	ID              uint      `gorm:"primaryKey" json:"id"`
	CreatedAt       time.Time `json:"created_at"`
	StartTime       time.Time `json:"start_time"`
	EndTime         time.Time `json:"end_time"`
	TotalQueries    int64     `json:"total_queries"`
	SlowQueries     int64     `json:"slow_queries"`
	AvgDuration     float64   `json:"avg_duration"`
	TopProblematic  string    `gorm:"type:text" json:"top_problematic"`
	Recommendations string    `gorm:"type:text" json:"recommendations"`
	PDFPath         string    `json:"pdf_path"`
}
