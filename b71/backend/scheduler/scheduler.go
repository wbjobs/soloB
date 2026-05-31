package scheduler

import (
	"math"
	"sync"
	"time"
	"task-scheduler-backend/config"
	"task-scheduler-backend/models"
)

type Scheduler struct {
	tasks         map[string]*models.Task
	queues        [][]*models.Task
	queueConfigs  []models.QueueConfig
	running       bool
	currentTask   *models.Task
	startTime     time.Time
	mu            sync.RWMutex
	stopChan      chan struct{}
	Timeline      []TimelineEntry
	EntropyHistory []EntropyEntry
}

type TimelineEntry struct {
	Time      float64 `json:"time"`
	TaskID    string  `json:"task_id"`
	TaskName  string  `json:"task_name"`
	Priority  int     `json:"priority"`
	Duration  float64 `json:"duration"`
}

type EntropyEntry struct {
	Time    float64 `json:"time"`
	Entropy float64 `json:"entropy"`
}

func NewScheduler() *Scheduler {
	return &Scheduler{
		tasks:         make(map[string]*models.Task),
		queues:        make([][]*models.Task, 3),
		queueConfigs:  models.DefaultQueueConfigs(),
		running:       false,
		stopChan:      make(chan struct{}),
		Timeline:      make([]TimelineEntry, 0),
		EntropyHistory: make([]EntropyEntry, 0),
	}
}

func (s *Scheduler) Start() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.running {
		return
	}

	s.running = true
	s.startTime = time.Now()
	go s.scheduleLoop()
}

func (s *Scheduler) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.running {
		return
	}

	s.running = false
	close(s.stopChan)
	s.stopChan = make(chan struct{})
}

func (s *Scheduler) Reset() {
	s.Stop()
	time.Sleep(100 * time.Millisecond)

	s.mu.Lock()
	defer s.mu.Unlock()

	s.tasks = make(map[string]*models.Task)
	s.queues = make([][]*models.Task, 3)
	s.currentTask = nil
	s.Timeline = make([]TimelineEntry, 0)
	s.EntropyHistory = make([]EntropyEntry, 0)
}

func (s *Scheduler) AddTask(task *models.Task) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.tasks[task.ID] = task
	queueIndex := task.Priority - 1
	if queueIndex < 0 || queueIndex >= len(s.queues) {
		queueIndex = 2
	}
	s.queues[queueIndex] = append(s.queues[queueIndex], task)
	task.Status = models.TaskStatusReady
}

func (s *Scheduler) scheduleLoop() {
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()

	var remainingTimeSlice float64
	var currentQueueIndex int

	for {
		select {
		case <-s.stopChan:
			return
		case <-ticker.C:
			s.mu.Lock()

			elapsed := 0.01

			if s.currentTask == nil {
				s.currentTask, currentQueueIndex = s.getNextTask()
				if s.currentTask != nil {
					s.currentTask.Status = models.TaskStatusRunning
					if s.currentTask.StartedAt == nil {
						now := time.Now()
						s.currentTask.StartedAt = &now
					}
					remainingTimeSlice = s.queueConfigs[currentQueueIndex].TimeQuantum
				}
			}

			if s.currentTask != nil {
				executeTime := math.Min(elapsed, math.Min(remainingTimeSlice, s.currentTask.RemainingTime))

				s.currentTask.RemainingTime -= executeTime
				remainingTimeSlice -= executeTime

				s.Timeline = append(s.Timeline, TimelineEntry{
					Time:     time.Since(s.startTime).Seconds(),
					TaskID:   s.currentTask.ID,
					TaskName: s.currentTask.Name,
					Priority: s.currentTask.Priority,
					Duration: executeTime,
				})

				for _, queue := range s.queues {
					for _, task := range queue {
						if task != s.currentTask && task.Status == models.TaskStatusReady {
							task.WaitingTime += executeTime
						}
					}
				}

				if s.currentTask.RemainingTime <= 0 {
					now := time.Now()
					s.currentTask.Status = models.TaskStatusCompleted
					s.currentTask.CompletedAt = &now
					s.currentTask.TurnaroundTime = time.Since(s.currentTask.CreatedAt).Seconds()
					s.saveTaskToHistory(s.currentTask)
					s.removeTaskFromQueue(s.currentTask, currentQueueIndex)
					s.currentTask = nil
				} else if remainingTimeSlice <= 0 {
					s.currentTask.PreemptCount++
					s.currentTask.Status = models.TaskStatusReady
					s.queues[currentQueueIndex] = append(s.queues[currentQueueIndex], s.currentTask)
					s.currentTask = nil
				}

				entropy := s.calculateEntropy()
				s.EntropyHistory = append(s.EntropyHistory, EntropyEntry{
					Time:    time.Since(s.startTime).Seconds(),
					Entropy: entropy,
				})
			}

			s.mu.Unlock()
		}
	}
}

func (s *Scheduler) getNextTask() (*models.Task, int) {
	for i := 0; i < len(s.queues); i++ {
		if len(s.queues[i]) > 0 {
			task := s.queues[i][0]
			s.queues[i] = s.queues[i][1:]
			return task, i
		}
	}
	return nil, -1
}

func (s *Scheduler) removeTaskFromQueue(task *models.Task, queueIndex int) {
	for i, t := range s.queues[queueIndex] {
		if t.ID == task.ID {
			s.queues[queueIndex] = append(s.queues[queueIndex][:i], s.queues[queueIndex][i+1:]...)
			break
		}
	}
}

func (s *Scheduler) calculateEntropy() float64 {
	var total float64
	counts := make([]int, len(s.queues))

	for i, queue := range s.queues {
		counts[i] = len(queue)
		total += float64(len(queue))
	}

	if s.currentTask != nil {
		total++
	}

	if total == 0 {
		return 0
	}

	var entropy float64
	for _, count := range counts {
		if count > 0 {
			p := float64(count) / total
			entropy -= p * math.Log2(p)
		}
	}

	if s.currentTask != nil {
		p := 1.0 / total
		entropy -= p * math.Log2(p)
	}

	return entropy
}

func (s *Scheduler) saveTaskToHistory(task *models.Task) {
	_, err := config.DB.Exec(`
		INSERT INTO task_history (id, name, priority, burst_time, remaining_time, waiting_time, turnaround_time, preempt_count, status, completed_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, task.ID, task.Name, task.Priority, task.BurstTime, task.RemainingTime, task.WaitingTime, task.TurnaroundTime, task.PreemptCount, task.Status, task.CompletedAt)

	if err != nil {
		config.SaveEntropy(s.calculateEntropy())
	}
}

func (s *Scheduler) GetTasks() []*models.Task {
	s.mu.RLock()
	defer s.mu.RUnlock()

	tasks := make([]*models.Task, 0, len(s.tasks))
	for _, task := range s.tasks {
		tasks = append(tasks, task)
	}
	return tasks
}

func (s *Scheduler) GetTask(id string) (*models.Task, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	task, exists := s.tasks[id]
	return task, exists
}

func (s *Scheduler) DeleteTask(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	task, exists := s.tasks[id]
	if !exists {
		return false
	}

	queueIndex := task.Priority - 1
	s.removeTaskFromQueue(task, queueIndex)
	delete(s.tasks, id)
	return true
}

func (s *Scheduler) IsRunning() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.running
}

func (s *Scheduler) GetQueueConfigs() []models.QueueConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.queueConfigs
}

func (s *Scheduler) UpdateQueueConfig(configs []models.QueueConfig) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.queueConfigs = configs
}

func (s *Scheduler) GetQueueStatus() []map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]map[string]interface{}, len(s.queues))
	for i, queue := range s.queues {
		result[i] = map[string]interface{}{
			"queue_id":      i,
			"priority":      s.queueConfigs[i].Priority,
			"time_quantum":  s.queueConfigs[i].TimeQuantum,
			"name":          s.queueConfigs[i].Name,
			"task_count":    len(queue),
			"tasks":         queue,
		}
	}
	return result
}

type PredictionPoint struct {
	Time     float64 `json:"time"`
	Entropy  float64 `json:"entropy"`
	IsActual bool    `json:"is_actual"`
}

func (s *Scheduler) PredictEntropyFuture(numSteps int) []PredictionPoint {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if len(s.EntropyHistory) < 2 {
		return []PredictionPoint{}
	}

	n := len(s.EntropyHistory)
	var sumX, sumY, sumXY, sumX2 float64

	for _, point := range s.EntropyHistory {
		sumX += point.Time
		sumY += point.Entropy
		sumXY += point.Time * point.Entropy
		sumX2 += point.Time * point.Time
	}

	slope := (float64(n)*sumXY - sumX*sumY) / (float64(n)*sumX2 - sumX*sumX)
	intercept := (sumY - slope*sumX) / float64(n)

	lastTime := s.EntropyHistory[n-1].Time
	avgTimeStep := lastTime / float64(n)

	predictions := make([]PredictionPoint, 0, numSteps)
	for i := 1; i <= numSteps; i++ {
		predTime := lastTime + avgTimeStep*float64(i)
		predEntropy := slope*predTime + intercept
		if predEntropy < 0 {
			predEntropy = 0
		}
		predictions = append(predictions, PredictionPoint{
			Time:     predTime,
			Entropy:  predEntropy,
			IsActual: false,
		})
	}

	return predictions
}

func (s *Scheduler) GetEntropyWithPrediction(numPrediction int) []PredictionPoint {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]PredictionPoint, 0, len(s.EntropyHistory)+numPrediction)

	for _, point := range s.EntropyHistory {
		result = append(result, PredictionPoint{
			Time:     point.Time,
			Entropy:  point.Entropy,
			IsActual: true,
		})
	}

	if len(s.EntropyHistory) >= 2 {
		n := len(s.EntropyHistory)
		var sumX, sumY, sumXY, sumX2 float64

		for _, point := range s.EntropyHistory {
			sumX += point.Time
			sumY += point.Entropy
			sumXY += point.Time * point.Entropy
			sumX2 += point.Time * point.Time
		}

		slope := (float64(n)*sumXY - sumX*sumY) / (float64(n)*sumX2 - sumX*sumX)
		intercept := (sumY - slope*sumX) / float64(n)

		lastTime := s.EntropyHistory[n-1].Time
		avgTimeStep := lastTime / float64(n)

		for i := 1; i <= numPrediction; i++ {
			predTime := lastTime + avgTimeStep*float64(i)
			predEntropy := slope*predTime + intercept
			if predEntropy < 0 {
				predEntropy = 0
			}
			result = append(result, PredictionPoint{
				Time:     predTime,
				Entropy:  predEntropy,
				IsActual: false,
			})
		}
	}

	return result
}
