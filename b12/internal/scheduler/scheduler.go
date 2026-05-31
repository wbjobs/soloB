package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"path"
	"sync"
	"time"

	"dtsplatform/internal/config"
	"dtsplatform/internal/models"

	"github.com/robfig/cron/v3"
	clientv3 "go.etcd.io/etcd/client/v3"
)

type Scheduler struct {
	cfg          *config.Config
	etcd         *EtcdManager
	cron         *cron.Cron
	jobs         map[string]models.Job
	jobMu        sync.RWMutex
	executors    map[string]*ExecutorInfo
	executorMu   sync.RWMutex
	running      bool
}

type ExecutorInfo struct {
	ID             string
	Address        string
	MaxTasks       int
	CurrentLoad    int
	SupportedTypes []string
	LastHeartbeat  time.Time
	LeaseID        int64
}

func NewScheduler(cfg *config.Config, etcd *EtcdManager) *Scheduler {
	return &Scheduler{
		cfg:       cfg,
		etcd:      etcd,
		cron:      cron.New(cron.WithSeconds()),
		jobs:      make(map[string]models.Job),
		executors: make(map[string]*ExecutorInfo),
	}
}

func (s *Scheduler) Start(ctx context.Context) error {
	s.running = true

	s.etcd.SetLeaderCallbacks(
		func() {
			log.Println("Acquired leadership, starting scheduler...")
			if err := s.onBecomeLeader(ctx); err != nil {
				log.Printf("Failed to start scheduler: %v", err)
			}
		},
		func() {
			log.Println("Lost leadership, stopping scheduler...")
			s.onLoseLeader()
		},
	)

	if err := s.etcd.StartElection(ctx); err != nil {
		return fmt.Errorf("failed to start election: %w", err)
	}

	go s.executorWatchLoop(ctx)

	<-ctx.Done()
	s.Stop()
	return nil
}

func (s *Scheduler) Stop() {
	s.running = false
	if s.cron != nil {
		s.cron.Stop()
	}
}

func (s *Scheduler) onBecomeLeader(ctx context.Context) error {
	s.cron = cron.New(cron.WithSeconds())

	if err := s.loadJobs(ctx); err != nil {
		return fmt.Errorf("failed to load jobs: %w", err)
	}

	for _, job := range s.jobs {
		if job.Status == models.JobStatusActive && job.Cron != "" {
			if err := s.scheduleJob(job); err != nil {
				log.Printf("Failed to schedule job %s: %v", job.ID, err)
			}
		}
	}

	s.cron.Start()

	if err := s.loadExecutors(ctx); err != nil {
		log.Printf("Failed to load executors: %v", err)
	}

	return nil
}

func (s *Scheduler) onLoseLeader() {
	if s.cron != nil {
		s.cron.Stop()
	}
	s.jobMu.Lock()
	s.jobs = make(map[string]models.Job)
	s.jobMu.Unlock()
}

func (s *Scheduler) loadJobs(ctx context.Context) error {
	jobsData, err := s.etcd.ListJobs(ctx)
	if err != nil {
		return err
	}

	s.jobMu.Lock()
	defer s.jobMu.Unlock()

	for id, data := range jobsData {
		var job models.Job
		if err := json.Unmarshal(data, &job); err != nil {
			log.Printf("Failed to unmarshal job %s: %v", id, err)
			continue
		}
		s.jobs[id] = job
	}

	return nil
}

func (s *Scheduler) loadExecutors(ctx context.Context) error {
	executorsData, err := s.etcd.ListExecutors(ctx)
	if err != nil {
		return err
	}

	s.executorMu.Lock()
	defer s.executorMu.Unlock()

	for id, data := range executorsData {
		var info ExecutorInfo
		if err := json.Unmarshal(data, &info); err != nil {
			log.Printf("Failed to unmarshal executor %s: %v", id, err)
			continue
		}
		s.executors[id] = &info
	}

	return nil
}

func (s *Scheduler) scheduleJob(job models.Job) error {
	_, err := s.cron.AddFunc(job.Cron, func() {
		if s.etcd.IsLeader() {
			s.triggerJob(context.Background(), job.ID)
		}
	})
	return err
}

func (s *Scheduler) triggerJob(ctx context.Context, jobID string) {
	s.jobMu.RLock()
	job, exists := s.jobs[jobID]
	s.jobMu.RUnlock()

	if !exists {
		log.Printf("Job %s not found", jobID)
		return
	}

	if job.Paused {
		log.Printf("Job %s is paused, skipping", jobID)
		return
	}

	log.Printf("Triggering job: %s", jobID)

	go func() {
		execCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		if err := s.executeDAG(execCtx, job); err != nil {
			log.Printf("DAG execution error for %s: %v", jobID, err)
		}
	}()
}

func (s *Scheduler) executeDAG(ctx context.Context, job models.Job) error {
	if len(job.DAG.Tasks) == 0 {
		return s.executeSimpleJob(ctx, job)
	}

	executionID := fmt.Sprintf("%s-%d", job.ID, time.Now().UnixNano())
	log.Printf("Starting DAG execution: %s", executionID)

	return s.processDAGNodes(ctx, job, executionID, job.DAG.Tasks)
}

func (s *Scheduler) executeSimpleJob(ctx context.Context, job models.Job) error {
	executionID := fmt.Sprintf("%s-%d", job.ID, time.Now().UnixNano())
	return s.assignTask(ctx, executionID, models.TaskExecution{
		TaskID:      job.ID,
		ExecutionID: executionID,
		Status:      models.TaskStatusPending,
		MaxRetries:  job.MaxRetries,
	})
}

type dagExecutionState struct {
	completed  map[string]bool
	running    map[string]bool
	scheduled  map[string]bool
	mu         sync.RWMutex
	cond       *sync.Cond
}

func newDAGExecutionState() *dagExecutionState {
	state := &dagExecutionState{
		completed: make(map[string]bool),
		running:   make(map[string]bool),
		scheduled: make(map[string]bool),
	}
	state.cond = sync.NewCond(&state.mu)
	return state
}

func (s *Scheduler) processDAGNodes(ctx context.Context, job models.Job, executionID string, tasks []models.DAGTask) error {
	state := newDAGExecutionState()

	taskMap := make(map[string]models.DAGTask)
	for _, t := range tasks {
		taskMap[t.TaskID] = t
	}

	pendingCount := len(tasks)
	var processMu sync.Mutex
	processMu.Lock()

	for pendingCount > 0 {
		readyTasks := s.findReadyTasks(job.DAG.Edges, taskMap, state)

		if len(readyTasks) == 0 {
			state.mu.Lock()
			state.cond.Wait()
			state.mu.Unlock()
			continue
		}

		for _, task := range readyTasks {
			go func(t models.DAGTask) {
				defer func() {
					state.mu.Lock()
					state.running[t.TaskID] = false
					state.completed[t.TaskID] = true
					state.cond.Broadcast()
					state.mu.Unlock()

					processMu.Lock()
					pendingCount--
					processMu.Unlock()
				}()

				taskExec := models.TaskExecution{
					TaskID:      t.TaskID,
					ExecutionID: executionID,
					Status:      models.TaskStatusPending,
					MaxRetries:  t.Retries,
				}

				if t.Shards > 1 {
					taskExec.TotalShards = t.Shards
					for shard := 0; shard < t.Shards; shard++ {
						shardTask := taskExec
						shardTask.TaskID = fmt.Sprintf("%s-shard-%d", t.TaskID, shard)
						shardTask.ShardIndex = shard
						if err := s.assignTask(ctx, executionID, shardTask); err != nil {
							log.Printf("Failed to assign shard %d for %s: %v", shard, t.TaskID, err)
						}
					}
				} else {
					if err := s.assignTask(ctx, executionID, taskExec); err != nil {
						log.Printf("Failed to assign task %s: %v", t.TaskID, err)
					}
				}
			}(task)
		}
	}

	return nil
}

func (s *Scheduler) findReadyTasks(
	edges []models.DAGEdge,
	taskMap map[string]models.DAGTask,
	state *dagExecutionState,
) []models.DAGTask {
	state.mu.Lock()
	defer state.mu.Unlock()

	var ready []models.DAGTask

	for taskID, task := range taskMap {
		if state.scheduled[taskID] || state.running[taskID] || state.completed[taskID] {
			continue
		}

		if s.dependenciesCompleted(taskID, edges, state.completed) {
			state.scheduled[taskID] = true
			state.running[taskID] = true
			ready = append(ready, task)
		}
	}

	return ready
}

func (s *Scheduler) dependenciesCompleted(taskID string, edges []models.DAGEdge, completed map[string]bool) bool {
	for _, edge := range edges {
		if edge.To == taskID {
			if !completed[edge.From] {
				return false
			}
		}
	}
	return true
}

func (s *Scheduler) assignTask(ctx context.Context, executionID string, task models.TaskExecution) error {
	if err := s.refreshExecutors(ctx); err != nil {
		log.Printf("Warning: failed to refresh executors: %v", err)
	}

	s.executorMu.RLock()
	defer s.executorMu.RUnlock()

	if len(s.executors) == 0 {
		return fmt.Errorf("no executors available")
	}

	bestExecutor := s.pickExecutor(task)
	if bestExecutor == nil {
		return fmt.Errorf("no suitable executor found")
	}

	acquired, err := s.etcd.AcquireTask(ctx, task.TaskID, bestExecutor.ID)
	if err != nil {
		return fmt.Errorf("failed to acquire task: %w", err)
	}
	if !acquired {
		return fmt.Errorf("task %s already acquired by another executor", task.TaskID)
	}

	log.Printf("Assigning task %s (shard %d/%d) to executor %s",
		task.TaskID, task.ShardIndex+1, task.TotalShards, bestExecutor.ID)

	return nil
}

func (s *Scheduler) refreshExecutors(ctx context.Context) error {
	executorsData, err := s.etcd.ListExecutors(ctx)
	if err != nil {
		return err
	}

	s.executorMu.Lock()
	defer s.executorMu.Unlock()

	timeout := time.Duration(s.cfg.Scheduler.ExecutorTimeout) * time.Second
	if timeout <= 0 {
		timeout = 15 * time.Second
	}

	for id, data := range executorsData {
		var info ExecutorInfo
		if err := json.Unmarshal(data, &info); err != nil {
			continue
		}

		existing, exists := s.executors[id]
		if exists {
			existing.CurrentLoad = info.CurrentLoad
			existing.LastHeartbeat = time.Now()
		} else {
			s.executors[id] = &ExecutorInfo{
				ID:             id,
				Address:        info.Address,
				MaxTasks:       info.MaxTasks,
				SupportedTypes: info.SupportedTypes,
				CurrentLoad:    info.CurrentLoad,
				LastHeartbeat:  time.Now(),
			}
		}
	}

	for id, exec := range s.executors {
		if time.Since(exec.LastHeartbeat) > timeout {
			log.Printf("Executor %s timed out, removing", id)
			delete(s.executors, id)
		}
	}

	return nil
}

func (s *Scheduler) pickExecutor(_ models.TaskExecution) *ExecutorInfo {
	var best *ExecutorInfo
	minLoad := -1

	timeout := time.Duration(s.cfg.Scheduler.ExecutorTimeout) * time.Second
	if timeout <= 0 {
		timeout = 15 * time.Second
	}

	for _, exec := range s.executors {
		if time.Since(exec.LastHeartbeat) > timeout {
			continue
		}
		if exec.CurrentLoad >= exec.MaxTasks {
			continue
		}
		if minLoad == -1 || exec.CurrentLoad < minLoad {
			best = exec
			minLoad = exec.CurrentLoad
		}
	}

	return best
}

func (s *Scheduler) RegisterExecutor(info *ExecutorInfo) error {
	s.executorMu.Lock()
	defer s.executorMu.Unlock()
	s.executors[info.ID] = info
	log.Printf("Executor registered: %s (load: %d/%d)", info.ID, info.CurrentLoad, info.MaxTasks)
	return nil
}

func (s *Scheduler) UpdateExecutorHeartbeat(executorID string, load int) error {
	s.executorMu.Lock()
	defer s.executorMu.Unlock()
	if exec, exists := s.executors[executorID]; exists {
		exec.CurrentLoad = load
		exec.LastHeartbeat = time.Now()
	}
	return nil
}

func (s *Scheduler) AddJob(ctx context.Context, job models.Job) error {
	data, err := json.Marshal(job)
	if err != nil {
		return err
	}

	if err := s.etcd.PutJob(ctx, job.ID, data); err != nil {
		return err
	}

	s.jobMu.Lock()
	s.jobs[job.ID] = job
	s.jobMu.Unlock()

	if s.etcd.IsLeader() && job.Status == models.JobStatusActive && job.Cron != "" {
		if err := s.scheduleJob(job); err != nil {
			log.Printf("Failed to schedule job %s: %v", job.ID, err)
		}
	}

	log.Printf("Job added: %s", job.ID)
	return nil
}

func (s *Scheduler) GetJob(jobID string) (*models.Job, bool) {
	s.jobMu.RLock()
	defer s.jobMu.RUnlock()
	job, exists := s.jobs[jobID]
	return &job, exists
}

func (s *Scheduler) ListJobs() []models.Job {
	s.jobMu.RLock()
	defer s.jobMu.RUnlock()
	jobs := make([]models.Job, 0, len(s.jobs))
	for _, job := range s.jobs {
		jobs = append(jobs, job)
	}
	return jobs
}

func (s *Scheduler) DeleteJob(ctx context.Context, jobID string) error {
	if err := s.etcd.DeleteJob(ctx, jobID); err != nil {
		return err
	}

	s.jobMu.Lock()
	delete(s.jobs, jobID)
	s.jobMu.Unlock()

	log.Printf("Job deleted: %s", jobID)
	return nil
}

func (s *Scheduler) TriggerJob(ctx context.Context, jobID string) error {
	s.jobMu.RLock()
	job, exists := s.jobs[jobID]
	s.jobMu.RUnlock()

	if !exists {
		return fmt.Errorf("job not found: %s", jobID)
	}

	go s.triggerJob(ctx, jobID)
	return nil
}

func (s *Scheduler) executorWatchLoop(ctx context.Context) {
	watcher := s.etcd.WatchExecutors(ctx)
	for event := range watcher {
		if event.Err() != nil {
			log.Printf("Executor watch error: %v", event.Err())
			continue
		}
		for _, ev := range event.Events {
			executorID := path.Base(string(ev.Kv.Key))
			if ev.Type == clientv3.EventTypeDelete {
				s.executorMu.Lock()
				delete(s.executors, executorID)
				s.executorMu.Unlock()
				log.Printf("Executor removed via watch: %s", executorID)
			}
		}
	}
}
