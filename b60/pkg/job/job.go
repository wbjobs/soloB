package job

import (
	"context"
	"fmt"
	"time"

	"github.com/example/distributed-cron/pkg/lock"
)

type Job struct {
	Name           string
	CronExpression string
	TimeZone       string
	Deps           []string
	Command        string
	MaxRetries     int
	InitialDelay   time.Duration
	BackoffFactor  float64
}

type JobStoreInterface interface {
	MarkRunning(ctx context.Context, jobName, nodeID string) error
	MarkSuccess(ctx context.Context, jobName string) error
	MarkFailed(ctx context.Context, jobName string, retryCount int, errMsg string) error
	IsLastRunSuccessful(ctx context.Context, jobName string) (bool, error)
}

type Executor struct {
	lockManager *lock.DistributedLockManager
	jobStore    JobStoreInterface
	nodeID      string
}

func NewExecutor(lockManager *lock.DistributedLockManager, jobStore JobStoreInterface, nodeID string) *Executor {
	return &Executor{
		lockManager: lockManager,
		jobStore:    jobStore,
		nodeID:      nodeID,
	}
}

func (e *Executor) Execute(ctx context.Context, job Job) error {
	lockKey := fmt.Sprintf("/distributed-cron/locks/%s", job.Name)
	distLock := e.lockManager.NewLock(lockKey, e.nodeID)

	lockCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	locked, err := distLock.TryLock(lockCtx, 60)
	if err != nil {
		return fmt.Errorf("failed to acquire lock for job %s: %w", job.Name, err)
	}
	if !locked {
		return nil
	}
	defer func() {
		unlockCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = distLock.Unlock(unlockCtx)
	}()

	keepAliveCtx, keepAliveCancel := context.WithCancel(ctx)
	defer keepAliveCancel()
	_, _ = distLock.KeepAlive(keepAliveCtx)

	if e.jobStore != nil {
		if err := e.jobStore.MarkRunning(ctx, job.Name, e.nodeID); err != nil {
			return fmt.Errorf("failed to mark job %s as running: %w", job.Name, err)
		}
	}

	err = e.executeWithRetry(ctx, job)

	if e.jobStore != nil {
		if err == nil {
			_ = e.jobStore.MarkSuccess(ctx, job.Name)
		} else {
			_ = e.jobStore.MarkFailed(ctx, job.Name, job.MaxRetries, err.Error())
		}
	}

	return err
}

func (e *Executor) executeWithRetry(ctx context.Context, job Job) error {
	var lastErr error
	delay := job.InitialDelay
	if delay == 0 {
		delay = 1 * time.Second
	}

	for attempt := 0; attempt <= job.MaxRetries; attempt++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		err := e.executeOnce(job)
		if err == nil {
			return nil
		}

		lastErr = err

		if attempt < job.MaxRetries {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(delay):
			}

			delay = time.Duration(float64(delay) * job.BackoffFactor)
		}
	}

	return lastErr
}

func (e *Executor) executeOnce(job Job) error {
	fmt.Printf("[%s] Executing job %s: %s\n", time.Now().Format(time.RFC3339), job.Name, job.Command)
	time.Sleep(2 * time.Second)
	return nil
}
