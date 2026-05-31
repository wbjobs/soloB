package models

import "time"

type Job struct {
	ID             string
	Name           string
	Description    string
	Type           string
	Cron           string
	Namespace      string
	DAG            DAGSpec
	Payload        []byte
	Status         JobStatus
	MaxRetries     int
	Timeout        time.Duration
	Paused         bool
	CreatedAt      time.Time
	UpdatedAt      time.Time
	LastRunAt      *time.Time
	NextRunAt      *time.Time
	TotalRuns      int64
	SuccessRuns    int64
	FailedRuns     int64
	RetryPolicy    *RetryPolicy
}

type JobStatus string

const (
	JobStatusActive   JobStatus = "active"
	JobStatusPaused   JobStatus = "paused"
	JobStatusDisabled JobStatus = "disabled"
	JobStatusFused    JobStatus = "fused"
)

type DAGSpec struct {
	Tasks    []DAGTask
	Edges    []DAGEdge
}

type DAGTask struct {
	TaskID       string
	Type         string
	Payload      []byte
	Timeout      time.Duration
	Retries      int
	Shards       int
	Namespace    string
	Dependencies []string
}

type DAGEdge struct {
	From string
	To   string
}

type DAGExecution struct {
	ExecutionID string
	JobID       string
	Status      TaskStatus
	Tasks       []TaskExecution
	StartTime   time.Time
	EndTime     *time.Time
}

type TaskExecution struct {
	TaskID        string
	ExecutionID   string
	Status        TaskStatus
	Retries       int
	MaxRetries    int
	StartTime     *time.Time
	EndTime       *time.Time
	ErrorMessage  string
	ShardIndex    int
	TotalShards   int
	ExecutorID    string
	LogLocation   string
	Namespace     string
	ErrorType     ErrorType
}

type TaskStatus string

const (
	TaskStatusPending   TaskStatus = "pending"
	TaskStatusRunning   TaskStatus = "running"
	TaskStatusCompleted TaskStatus = "completed"
	TaskStatusFailed    TaskStatus = "failed"
	TaskStatusTimeout   TaskStatus = "timeout"
	TaskStatusSkipped   TaskStatus = "skipped"
	TaskStatusRetrying  TaskStatus = "retrying"
)

type TaskPayload struct {
	Command     string            `json:"command,omitempty"`
	Args        []string          `json:"args,omitempty"`
	Env         map[string]string `json:"env,omitempty"`
	Module      string            `json:"module,omitempty"`
	Function    string            `json:"function,omitempty"`
	Params      map[string]any    `json:"params,omitempty"`
	URL         string            `json:"url,omitempty"`
	Method      string            `json:"method,omitempty"`
	Headers     map[string]string `json:"headers,omitempty"`
	Body        []byte            `json:"body,omitempty"`
	Image       string            `json:"image,omitempty"`
	CommandArgs []string          `json:"command_args,omitempty"`
	Volumes     []string          `json:"volumes,omitempty"`
}

type RetryPolicy struct {
	MaxRetries         int
	RetryDelay         time.Duration
	MaxDelay           time.Duration
	BackoffMultiplier  float64
	Strategies         []ErrorType
	FailureThreshold   int
	FuseWindowDuration time.Duration
}

type ErrorType string

const (
	ErrorTypeNetwork     ErrorType = "network"
	ErrorTypeBusiness    ErrorType = "business"
	ErrorTypeResource    ErrorType = "resource"
	ErrorTypeTimeout     ErrorType = "timeout"
	ErrorTypeUnknown     ErrorType = "unknown"
	ErrorTypeNonRetryable ErrorType = "non_retryable"
)

type RetryableErrors struct {
	Network  []string
	Timeout  []string
	Resource []string
}

type JobLineage struct {
	JobID           string
	ExecutionID     string
	SourceJobs      []string
	DownstreamJobs  []string
	AllDependencies []string
	ImpactScope     ImpactAnalysis
	AnalyzedAt      time.Time
}

type ImpactAnalysis struct {
	FailedJobID      string
	FailedTaskID     string
	AffectedJobs     []string
	AffectedTasks    []string
	FailedExecution  string
	RerunableTasks   []string
	EstimatedDelay   time.Duration
	DataDependencies []string
}

type Namespace struct {
	Name         string
	Description  string
	CreatedAt    time.Time
	UpdatedAt    time.Time
	Status       NamespaceStatus
	Quota        ResourceQuota
	Usage        ResourceUsage
	Labels       map[string]string
	Annotations  map[string]string
}

type NamespaceStatus string

const (
	NamespaceActive    NamespaceStatus = "active"
	NamespaceDisabled  NamespaceStatus = "disabled"
	NamespaceSuspended NamespaceStatus = "suspended"
)

type ResourceQuota struct {
	MaxConcurrentJobs     int
	MaxTotalTasks         int
	MaxExecutors          int
	MaxCPU                float64
	MaxMemoryGB           float64
	MaxStorageGB          float64
	MaxDailyExecutions    int64
	MaxTaskTimeoutMinutes int
	MaxRetriesPerTask     int
}

type ResourceUsage struct {
	CurrentConcurrentJobs  int
	CurrentRunningTasks    int
	CurrentExecutors       int
	CurrentCPUPercent      float64
	CurrentMemoryGB        float64
	CurrentStorageGB       float64
	DailyExecutionsToday   int64
	TotalTaskRetries       int64
}

type CircuitBreakerState string

const (
	CircuitStateClosed   CircuitBreakerState = "closed"
	CircuitStateOpen     CircuitBreakerState = "open"
	CircuitStateHalfOpen CircuitBreakerState = "half_open"
)

type CircuitBreaker struct {
	Namespace        string
	JobID            string
	TaskID           string
	State            CircuitBreakerState
	FailureCount     int
	FailureThreshold int
	SuccessThreshold int
	CurrentSuccesses int
	LastFailureAt    time.Time
	LastStateChange  time.Time
	OpenDuration     time.Duration
}

type ScalingMetrics struct {
	Timestamp               time.Time
	QueueLength             int
	RunningTasks            int
	PendingTasks            int
	ExecutorCount           int
	AverageCPUUsage         float64
	AverageMemoryUsage      float64
	MaxCPUUsage             float64
	MaxMemoryUsage          float64
	TaskThroughputPerMinute float64
	AverageTaskDuration     time.Duration
}

type ScalingPolicy struct {
	MinExecutors             int
	MaxExecutors             int
	CPUThresholdHigh         float64
	CPUThresholdLow          float64
	MemoryThresholdHigh      float64
	MemoryThresholdLow       float64
	QueueThresholdHigh       int
	QueueThresholdLow        int
	ScaleUpCooldownMinutes   int
	ScaleDownCooldownMinutes int
	UseHPA                   bool
	UseVPA                   bool
}

type ScalingAction struct {
	ActionType       string
	Timestamp        time.Time
	Reason           string
	FromCount        int
	ToCount          int
	MetricsSnapshot  *ScalingMetrics
	ExecutorsAdded   []string
	ExecutorsRemoved []string
	Success          bool
	ErrorMessage     string
}
