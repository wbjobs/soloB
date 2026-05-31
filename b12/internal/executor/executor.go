package executor

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"dtsplatform/api/proto"
	"dtsplatform/internal/config"
	"dtsplatform/internal/models"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type Executor struct {
	cfg           *config.Config
	client        scheduler.SchedulerServiceClient
	conn          *grpc.ClientConn
	id            string
	runningTasks  map[string]*RunningTask
	runningMu     sync.RWMutex
	taskQueue     chan *scheduler.Task
	workers       int
	stopChan      chan struct{}
}

type RunningTask struct {
	TaskID    string
	Ctx       context.Context
	Cancel    context.CancelFunc
	StartTime time.Time
}

type TaskExecutor interface {
	Execute(ctx context.Context, payload *models.TaskPayload) ([]byte, error)
	Type() string
}

func NewExecutor(cfg *config.Config) *Executor {
	return &Executor{
		cfg:          cfg,
		id:           cfg.Executor.Name,
		runningTasks: make(map[string]*RunningTask),
		taskQueue:    make(chan *scheduler.Task, 100),
		workers:      cfg.Executor.MaxTasks,
		stopChan:     make(chan struct{}),
	}
}

func (e *Executor) Start(ctx context.Context) error {
	conn, err := grpc.Dial(
		e.cfg.Executor.SchedulerAddr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		return err
	}
	e.conn = conn
	e.client = scheduler.NewSchedulerServiceClient(conn)

	if err := e.register(ctx); err != nil {
		return err
	}

	for i := 0; i < e.workers; i++ {
		go e.worker(i)
	}

	go e.heartbeatLoop(ctx)
	go e.taskFetchLoop(ctx)

	log.Printf("Executor %s started, max tasks: %d", e.id, e.workers)

	<-ctx.Done()
	return e.Stop()
}

func (e *Executor) Stop() error {
	close(e.stopChan)
	if e.conn != nil {
		e.conn.Close()
	}
	return nil
}

func (e *Executor) register(ctx context.Context) error {
	req := &scheduler.RegisterExecutorRequest{
		ExecutorId:     e.id,
		Address:        e.id,
		MaxTasks:       int32(e.cfg.Executor.MaxTasks),
		SupportedTypes: []string{"shell", "python", "http", "docker"},
	}

	resp, err := e.client.RegisterExecutor(ctx, req)
	if err != nil {
		return err
	}

	if !resp.Success {
		return logError(resp.Message)
	}

	log.Printf("Registered with scheduler: %s", e.cfg.Executor.SchedulerAddr)
	return nil
}

func logError(msg string) error {
	log.Printf("Registration failed: %s", msg)
	return nil
}

func (e *Executor) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Duration(e.cfg.Executor.HeartbeatInterval) * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			e.runningMu.RLock()
			runningCount := len(e.runningTasks)
			runningIDs := make([]string, 0, runningCount)
			for id := range e.runningTasks {
				runningIDs = append(runningIDs, id)
			}
			e.runningMu.RUnlock()

			req := &scheduler.HeartbeatRequest{
				ExecutorId:   e.id,
				CurrentLoad:  int32(runningCount),
				RunningTasks: runningIDs,
			}

			resp, err := e.client.Heartbeat(ctx, req)
			if err != nil {
				log.Printf("Heartbeat error: %v", err)
				continue
			}

			if !resp.Alive {
				log.Println("Scheduler marked us as dead, re-registering...")
				e.register(ctx)
			}
		}
	}
}

func (e *Executor) taskFetchLoop(ctx context.Context) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			e.runningMu.RLock()
			canAccept := len(e.runningTasks) < e.workers
			e.runningMu.RUnlock()

			if !canAccept {
				continue
			}

			req := &scheduler.GetTaskRequest{
				ExecutorId: e.id,
			}

			resp, err := e.client.GetTask(ctx, req)
			if err != nil {
				continue
			}

			if resp.HasTask {
				e.taskQueue <- resp.Task
			}
		}
	}
}

func (e *Executor) worker(id int) {
	log.Printf("Worker %d started", id)

	for task := range e.taskQueue {
		e.executeTask(task)
	}
}

func (e *Executor) executeTask(task *scheduler.Task) {
	log.Printf("Executing task: %s (type: %s)", task.TaskId, task.Type)

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(task.Timeout)*time.Second)
	defer cancel()

	e.runningMu.Lock()
	e.runningTasks[task.TaskId] = &RunningTask{
		TaskID:    task.TaskId,
		Ctx:       ctx,
		Cancel:    cancel,
		StartTime: time.Now(),
	}
	e.runningMu.Unlock()

	defer func() {
		e.runningMu.Lock()
		delete(e.runningTasks, task.TaskId)
		e.runningMu.Unlock()
	}()

	e.updateTaskStatus(task.TaskId, scheduler.TaskStatus_RUNNING, "started", time.Now().Unix(), 0, nil)

	var payload models.TaskPayload
	if err := json.Unmarshal(task.Payload, &payload); err != nil {
		e.updateTaskStatus(task.TaskId, scheduler.TaskStatus_FAILED, "invalid payload: "+err.Error(), time.Now().Unix(), time.Now().Unix(), nil)
		return
	}

	executor := e.getExecutor(task.Type)
	if executor == nil {
		e.updateTaskStatus(task.TaskId, scheduler.TaskStatus_FAILED, "unknown task type: "+task.Type, time.Now().Unix(), time.Now().Unix(), nil)
		return
	}

	result, err := executor.Execute(ctx, &payload)
	endTime := time.Now().Unix()

	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			e.updateTaskStatus(task.TaskId, scheduler.TaskStatus_TIMEOUT, err.Error(), time.Now().Unix(), endTime, nil)
		} else {
			e.updateTaskStatus(task.TaskId, scheduler.TaskStatus_FAILED, err.Error(), time.Now().Unix(), endTime, nil)
		}
		return
	}

	e.updateTaskStatus(task.TaskId, scheduler.TaskStatus_COMPLETED, "", time.Now().Unix(), endTime, result)
	log.Printf("Task completed: %s", task.TaskId)
}

func (e *Executor) getExecutor(taskType string) TaskExecutor {
	switch taskType {
	case "shell":
		return NewShellExecutor()
	case "python":
		return NewPythonExecutor()
	case "http":
		return NewHTTPExecutor()
	case "docker":
		return NewDockerExecutor()
	default:
		return nil
	}
}

func (e *Executor) updateTaskStatus(taskID string, status scheduler.TaskStatus, message string, startTime, endTime int64, result []byte) {
	req := &scheduler.UpdateTaskStatusRequest{
		TaskId:    taskID,
		Status:    status,
		Message:   message,
		StartTime: startTime,
		EndTime:   endTime,
		Result:    result,
	}

	_, err := e.client.UpdateTaskStatus(context.Background(), req)
	if err != nil {
		log.Printf("Failed to update task status: %v", err)
	}
}
