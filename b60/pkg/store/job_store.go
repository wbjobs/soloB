package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	clientv3 "go.etcd.io/etcd/client/v3"
)

type JobStatus struct {
	Name        string    `json:"name"`
	Status      string    `json:"status"`
	StartTime   time.Time `json:"start_time"`
	EndTime     time.Time `json:"end_time,omitempty"`
	LastSuccess time.Time `json:"last_success,omitempty"`
	LastFail    time.Time `json:"last_fail,omitempty"`
	RetryCount  int       `json:"retry_count"`
	Error       string    `json:"error,omitempty"`
	NodeID      string    `json:"node_id"`
}

type JobStore struct {
	client *clientv3.Client
	prefix string
}

func NewJobStore(client *clientv3.Client) *JobStore {
	return &JobStore{
		client: client,
		prefix: "/distributed-cron/jobs/",
	}
}

func (s *JobStore) getJobKey(jobName string) string {
	return fmt.Sprintf("%s%s", s.prefix, jobName)
}

func (s *JobStore) Get(ctx context.Context, jobName string) (*JobStatus, error) {
	key := s.getJobKey(jobName)
	resp, err := s.client.Get(ctx, key)
	if err != nil {
		return nil, err
	}

	if len(resp.Kvs) == 0 {
		return nil, nil
	}

	var status JobStatus
	err = json.Unmarshal(resp.Kvs[0].Value, &status)
	if err != nil {
		return nil, err
	}

	return &status, nil
}

func (s *JobStore) Save(ctx context.Context, status *JobStatus) error {
	key := s.getJobKey(status.Name)
	data, err := json.Marshal(status)
	if err != nil {
		return err
	}

	_, err = s.client.Put(ctx, key, string(data))
	return err
}

func (s *JobStore) MarkRunning(ctx context.Context, jobName, nodeID string) error {
	status := &JobStatus{
		Name:      jobName,
		Status:    "running",
		StartTime: time.Now(),
		NodeID:    nodeID,
	}

	existing, err := s.Get(ctx, jobName)
	if err != nil {
		return err
	}
	if existing != nil {
		status.LastSuccess = existing.LastSuccess
		status.LastFail = existing.LastFail
	}

	return s.Save(ctx, status)
}

func (s *JobStore) MarkSuccess(ctx context.Context, jobName string) error {
	status, err := s.Get(ctx, jobName)
	if err != nil {
		return err
	}
	if status == nil {
		status = &JobStatus{Name: jobName}
	}

	status.Status = "success"
	status.EndTime = time.Now()
	status.LastSuccess = time.Now()
	status.RetryCount = 0
	status.Error = ""

	return s.Save(ctx, status)
}

func (s *JobStore) MarkFailed(ctx context.Context, jobName string, retryCount int, errMsg string) error {
	status, err := s.Get(ctx, jobName)
	if err != nil {
		return err
	}
	if status == nil {
		status = &JobStatus{Name: jobName}
	}

	status.Status = "failed"
	status.EndTime = time.Now()
	status.LastFail = time.Now()
	status.RetryCount = retryCount
	status.Error = errMsg

	return s.Save(ctx, status)
}

func (s *JobStore) IsLastRunSuccessful(ctx context.Context, jobName string) (bool, error) {
	status, err := s.Get(ctx, jobName)
	if err != nil {
		return false, err
	}
	if status == nil {
		return false, nil
	}
	return status.Status == "success" && !status.LastSuccess.IsZero(), nil
}

func (s *JobStore) GetLastSuccessTime(ctx context.Context, jobName string) (time.Time, error) {
	status, err := s.Get(ctx, jobName)
	if err != nil {
		return time.Time{}, err
	}
	if status == nil {
		return time.Time{}, nil
	}
	return status.LastSuccess, nil
}
