package models

import (
	"time"

	"gorm.io/gorm"
)

type WorkloadType string

const (
	Deployment  WorkloadType = "deployment"
	StatefulSet WorkloadType = "statefulset"
)

type MetricRecord struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	ClusterName    string         `gorm:"index:idx_cluster_workload;not null;type:varchar(100)" json:"cluster_name"`
	Namespace      string         `gorm:"index:idx_cluster_workload;not null;type:varchar(100)" json:"namespace"`
	WorkloadName   string         `gorm:"index:idx_cluster_workload;not null;type:varchar(200)" json:"workload_name"`
	WorkloadType   WorkloadType   `gorm:"index:idx_cluster_workload;not null;type:varchar(50)" json:"workload_type"`
	CPUCores       float64        `gorm:"not null" json:"cpu_cores"`
	MemoryBytes    uint64         `gorm:"not null" json:"memory_bytes"`
	RecordedAt     time.Time      `gorm:"index:idx_recorded_at;not null" json:"recorded_at"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}

type Recommendation struct {
	CPURequest    string `json:"cpu_request"`
	CPULimit      string `json:"cpu_limit"`
	MemoryRequest string `json:"memory_request"`
	MemoryLimit   string `json:"memory_limit"`
}

type RecommendationSummary struct {
	TotalRecords      int     `json:"total_records"`
	TimeRangeDays     int     `json:"time_range_days"`
	CPUPercentile90   float64 `json:"cpu_p90_cores"`
	MemoryPercentile90 uint64  `json:"memory_p90_bytes"`
	BufferPercent     int     `json:"buffer_percent"`
}

type RecommendationResponse struct {
	Success      bool                 `json:"success"`
	Namespace    string               `json:"namespace"`
	Workload     string               `json:"workload"`
	WorkloadType string               `json:"workload_type"`
	Recommendation Recommendation      `json:"recommendation"`
	Summary      RecommendationSummary `json:"summary"`
	Message      string               `json:"message,omitempty"`
}

type ResourceConfig struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	ClusterName    string         `gorm:"index:idx_res_cluster;not null;type:varchar(100)" json:"cluster_name"`
	Namespace      string         `gorm:"index:idx_res_cluster;not null;type:varchar(100)" json:"namespace"`
	WorkloadName   string         `gorm:"index:idx_res_cluster;not null;type:varchar(200)" json:"workload_name"`
	WorkloadType   WorkloadType   `gorm:"index:idx_res_cluster;not null;type:varchar(50)" json:"workload_type"`
	CPURequest     float64        `gorm:"not null" json:"cpu_request_cores"`
	CPULimit       float64        `gorm:"not null" json:"cpu_limit_cores"`
	MemoryRequest  uint64         `gorm:"not null" json:"memory_request_bytes"`
	MemoryLimit    uint64         `gorm:"not null" json:"memory_limit_bytes"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}

type AuditLog struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	ClusterName    string         `gorm:"index:idx_audit_cluster;not null;type:varchar(100)" json:"cluster_name"`
	Namespace      string         `gorm:"not null;type:varchar(100)" json:"namespace"`
	WorkloadName   string         `gorm:"not null;type:varchar(200)" json:"workload_name"`
	WorkloadType   WorkloadType   `gorm:"not null;type:varchar(50)" json:"workload_type"`
	Action         string         `gorm:"not null;type:varchar(50)" json:"action"`
	OldValue       string         `gorm:"type:text" json:"old_value"`
	NewValue       string         `gorm:"type:text" json:"new_value"`
	Diff           string         `gorm:"type:text" json:"diff"`
	Operator       string         `gorm:"type:varchar(100);default:'system'" json:"operator"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}

type AuditLogResponse struct {
	Success    bool         `json:"success"`
	Total      int64        `json:"total"`
	Page       int          `json:"page"`
	PageSize   int          `json:"page_size"`
	TotalPages int          `json:"total_pages"`
	Data       []*AuditLog  `json:"data"`
	Message    string       `json:"message,omitempty"`
}

type ResourceConfigResponse struct {
	Success bool            `json:"success"`
	Data    *ResourceConfig `json:"data,omitempty"`
	Message string          `json:"message,omitempty"`
}
