package models

import (
	"time"

	"github.com/google/uuid"
)

type TaskStatus string

const (
	TaskStatusPending   TaskStatus = "pending"
	TaskStatusRunning   TaskStatus = "running"
	TaskStatusReady     TaskStatus = "ready"
	TaskStatusCompleted TaskStatus = "completed"
)

type Task struct {
	ID             string        `json:"id"`
	Name           string        `json:"name"`
	Priority       int           `json:"priority"`
	BurstTime      float64       `json:"burst_time"`
	RemainingTime  float64       `json:"remaining_time"`
	WaitingTime    float64       `json:"waiting_time"`
	TurnaroundTime float64       `json:"turnaround_time"`
	PreemptCount   int           `json:"preempt_count"`
	Status         TaskStatus    `json:"status"`
	CreatedAt      time.Time     `json:"created_at"`
	StartedAt      *time.Time    `json:"started_at,omitempty"`
	CompletedAt    *time.Time    `json:"completed_at,omitempty"`
	QueueIndex     int           `json:"queue_index"`
}

func NewTask(name string, priority int, burstTime float64) *Task {
	now := time.Now()
	return &Task{
		ID:             uuid.New().String(),
		Name:           name,
		Priority:       priority,
		BurstTime:      burstTime,
		RemainingTime:  burstTime,
		WaitingTime:    0,
		TurnaroundTime: 0,
		PreemptCount:   0,
		Status:         TaskStatusPending,
		CreatedAt:      now,
		QueueIndex:     priority - 1,
	}
}

type QueueConfig struct {
	QueueID    int     `json:"queue_id"`
	Priority   int     `json:"priority"`
	TimeQuantum float64 `json:"time_quantum"`
	Name       string  `json:"name"`
}

func DefaultQueueConfigs() []QueueConfig {
	return []QueueConfig{
		{QueueID: 0, Priority: 1, TimeQuantum: 0.5, Name: "High Priority"},
		{QueueID: 1, Priority: 2, TimeQuantum: 1.0, Name: "Medium Priority"},
		{QueueID: 2, Priority: 3, TimeQuantum: 2.0, Name: "Low Priority"},
	}
}
