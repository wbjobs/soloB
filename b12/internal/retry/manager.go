package retry

import (
	"context"
	"fmt"
	"log"
	"regexp"
	"strings"
	"sync"
	"time"

	"dtsplatform/internal/config"
	"dtsplatform/internal/models"
)

type RetryManager struct {
	cfg            *config.Config
	circuitBreakers map[string]*models.CircuitBreaker
	errorPatterns   *ErrorPatterns
	mu             sync.RWMutex
}

type ErrorPatterns struct {
	Network  []*regexp.Regexp
	Timeout  []*regexp.Regexp
	Resource []*regexp.Regexp
}

func NewRetryManager(cfg *config.Config) (*RetryManager, error) {
	patterns, err := compilePatterns(&cfg.Retry.RetryableErrors)
	if err != nil {
		return nil, err
	}

	return &RetryManager{
		cfg:             cfg,
		circuitBreakers: make(map[string]*models.CircuitBreaker),
		errorPatterns:   patterns,
	}, nil
}

func compilePatterns(cfg *config.RetryableErrorsConfig) (*ErrorPatterns, error) {
	patterns := &ErrorPatterns{}

	var err error
	patterns.Network, err = compileMany(cfg.NetworkPatterns)
	if err != nil {
		return nil, fmt.Errorf("failed to compile network patterns: %w", err)
	}

	patterns.Timeout, err = compileMany(cfg.TimeoutPatterns)
	if err != nil {
		return nil, fmt.Errorf("failed to compile timeout patterns: %w", err)
	}

	patterns.Resource, err = compileMany(cfg.ResourcePatterns)
	if err != nil {
		return nil, fmt.Errorf("failed to compile resource patterns: %w", err)
	}

	return patterns, nil
}

func compileMany(patterns []string) ([]*regexp.Regexp, error) {
	compiled := make([]*regexp.Regexp, 0, len(patterns))
	for _, p := range patterns {
		re, err := regexp.Compile(p)
		if err != nil {
			return nil, err
		}
		compiled = append(compiled, re)
	}
	return compiled, nil
}

func (m *RetryManager) Start(ctx context.Context) {
	if !m.cfg.Retry.Enabled {
		log.Println("Retry manager disabled")
		return
	}
	log.Println("Retry manager started")
}

func (m *RetryManager) ClassifyError(errMsg string) models.ErrorType {
	if errMsg == "" {
		return models.ErrorTypeUnknown
	}

	for _, re := range m.errorPatterns.Network {
		if re.MatchString(errMsg) {
			return models.ErrorTypeNetwork
		}
	}

	for _, re := range m.errorPatterns.Timeout {
		if re.MatchString(errMsg) {
			return models.ErrorTypeTimeout
		}
	}

	for _, re := range m.errorPatterns.Resource {
		if re.MatchString(errMsg) {
			return models.ErrorTypeResource
		}
	}

	lower := strings.ToLower(errMsg)
	if strings.Contains(lower, "connection") ||
		strings.Contains(lower, "network") ||
		strings.Contains(lower, "dial") ||
		strings.Contains(lower, "dns") {
		return models.ErrorTypeNetwork
	}

	if strings.Contains(lower, "timeout") ||
		strings.Contains(lower, "deadline exceeded") {
		return models.ErrorTypeTimeout
	}

	if strings.Contains(lower, "out of memory") ||
		strings.Contains(lower, "insufficient") ||
		strings.Contains(lower, "not enough") ||
		strings.Contains(lower, "resource") {
		return models.ErrorTypeResource
	}

	return models.ErrorTypeUnknown
}

func (m *RetryManager) ShouldRetry(task *models.TaskExecution, errType models.ErrorType, policy *models.RetryPolicy) (bool, time.Duration) {
	if !m.cfg.Retry.Enabled {
		return false, 0
	}

	if task.Retries >= task.MaxRetries {
		return false, 0
	}

	if policy == nil {
		policy = m.getDefaultPolicy()
	}

	if len(policy.Strategies) > 0 {
		shouldRetry := false
		for _, strategy := range policy.Strategies {
			if strategy == errType {
				shouldRetry = true
				break
			}
		}
		if !shouldRetry {
			return false, 0
		}
	}

	if m.cfg.Retry.EnableCircuitBreaker {
		cb := m.getCircuitBreaker(task.Namespace, "", task.TaskID)
		if cb != nil && cb.State == models.CircuitStateOpen {
			if time.Since(cb.LastStateChange) > cb.OpenDuration {
				m.halfOpenCircuit(task.Namespace, "", task.TaskID)
			} else {
				return false, 0
			}
		}
	}

	delay := m.calculateBackoff(task.Retries, policy)
	return true, delay
}

func (m *RetryManager) calculateBackoff(attempt int, policy *models.RetryPolicy) time.Duration {
	if policy == nil {
		policy = m.getDefaultPolicy()
	}

	delay := policy.RetryDelay
	if delay <= 0 {
		delay = time.Duration(m.cfg.Retry.DefaultRetryPolicy.RetryDelayMs) * time.Millisecond
	}

	if policy.BackoffMultiplier > 1 {
		for i := 0; i < attempt; i++ {
			delay = time.Duration(float64(delay) * policy.BackoffMultiplier)
		}
	}

	if policy.MaxDelay > 0 && delay > policy.MaxDelay {
		delay = policy.MaxDelay
	}

	maxDelay := time.Duration(m.cfg.Retry.DefaultRetryPolicy.MaxDelayMs) * time.Millisecond
	if maxDelay > 0 && delay > maxDelay {
		delay = maxDelay
	}

	return delay
}

func (m *RetryManager) getDefaultPolicy() *models.RetryPolicy {
	return &models.RetryPolicy{
		MaxRetries:        m.cfg.Retry.DefaultRetryPolicy.MaxRetries,
		RetryDelay:        time.Duration(m.cfg.Retry.DefaultRetryPolicy.RetryDelayMs) * time.Millisecond,
		MaxDelay:          time.Duration(m.cfg.Retry.DefaultRetryPolicy.MaxDelayMs) * time.Millisecond,
		BackoffMultiplier: m.cfg.Retry.DefaultRetryPolicy.BackoffMultiplier,
		FailureThreshold:  m.cfg.Retry.DefaultRetryPolicy.FailureThreshold,
		FuseWindowDuration: time.Duration(m.cfg.Retry.DefaultRetryPolicy.FuseWindowMinutes) * time.Minute,
	}
}

func (m *RetryManager) getCircuitBreaker(namespace, jobID, taskID string) *models.CircuitBreaker {
	m.mu.RLock()
	defer m.mu.RUnlock()

	key := m.circuitKey(namespace, jobID, taskID)
	return m.circuitBreakers[key]
}

func (m *RetryManager) circuitKey(namespace, jobID, taskID string) string {
	if namespace == "" {
		namespace = "default"
	}
	if taskID != "" {
		return fmt.Sprintf("%s:%s:%s", namespace, jobID, taskID)
	}
	if jobID != "" {
		return fmt.Sprintf("%s:%s", namespace, jobID)
	}
	return namespace
}

func (m *RetryManager) RecordSuccess(namespace, jobID, taskID string) {
	if !m.cfg.Retry.EnableCircuitBreaker {
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	key := m.circuitKey(namespace, jobID, taskID)
	if cb, exists := m.circuitBreakers[key]; exists {
		cb.CurrentSuccesses++
		if cb.State == models.CircuitStateHalfOpen && cb.CurrentSuccesses >= cb.SuccessThreshold {
			cb.State = models.CircuitStateClosed
			cb.FailureCount = 0
			cb.CurrentSuccesses = 0
			cb.LastStateChange = time.Now()
			log.Printf("Circuit breaker closed: %s", key)
		}
	}
}

func (m *RetryManager) RecordFailure(namespace, jobID, taskID string) {
	if !m.cfg.Retry.EnableCircuitBreaker {
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	key := m.circuitKey(namespace, jobID, taskID)
	if _, exists := m.circuitBreakers[key]; !exists {
		m.circuitBreakers[key] = &models.CircuitBreaker{
			Namespace:        namespace,
			JobID:            jobID,
			TaskID:           taskID,
			State:            models.CircuitStateClosed,
			FailureThreshold: m.cfg.Retry.DefaultRetryPolicy.FailureThreshold,
			SuccessThreshold: 3,
			OpenDuration:     time.Duration(m.cfg.Retry.DefaultRetryPolicy.FuseWindowMinutes) * time.Minute,
		}
	}

	cb := m.circuitBreakers[key]
	cb.FailureCount++
	cb.LastFailureAt = time.Now()

	if cb.FailureCount >= cb.FailureThreshold {
		if cb.State == models.CircuitStateClosed {
			cb.State = models.CircuitStateOpen
			cb.LastStateChange = time.Now()
			log.Printf("Circuit breaker OPEN: %s (failures: %d)", key, cb.FailureCount)
		} else if cb.State == models.CircuitStateHalfOpen {
			cb.State = models.CircuitStateOpen
			cb.LastStateChange = time.Now()
			cb.CurrentSuccesses = 0
		}
	}
}

func (m *RetryManager) halfOpenCircuit(namespace, jobID, taskID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := m.circuitKey(namespace, jobID, taskID)
	if cb, exists := m.circuitBreakers[key]; exists {
		cb.State = models.CircuitStateHalfOpen
		cb.LastStateChange = time.Now()
		cb.CurrentSuccesses = 0
		log.Printf("Circuit breaker HALF-OPEN: %s", key)
	}
}

func (m *RetryManager) ResetCircuit(namespace, jobID, taskID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := m.circuitKey(namespace, jobID, taskID)
	if cb, exists := m.circuitBreakers[key]; exists {
		cb.State = models.CircuitStateClosed
		cb.FailureCount = 0
		cb.CurrentSuccesses = 0
		cb.LastStateChange = time.Now()
		log.Printf("Circuit breaker reset: %s", key)
	}
}

func (m *RetryManager) GetCircuitBreaker(namespace, jobID, taskID string) *models.CircuitBreaker {
	m.mu.RLock()
	defer m.mu.RUnlock()

	key := m.circuitKey(namespace, jobID, taskID)
	cb := m.circuitBreakers[key]
	if cb == nil {
		return nil
	}

	return &models.CircuitBreaker{
		Namespace:        cb.Namespace,
		JobID:            cb.JobID,
		TaskID:           cb.TaskID,
		State:            cb.State,
		FailureCount:     cb.FailureCount,
		FailureThreshold: cb.FailureThreshold,
		SuccessThreshold: cb.SuccessThreshold,
		CurrentSuccesses: cb.CurrentSuccesses,
		LastFailureAt:    cb.LastFailureAt,
		LastStateChange:  cb.LastStateChange,
		OpenDuration:     cb.OpenDuration,
	}
}

func (m *RetryManager) GetAllCircuitBreakers() []*models.CircuitBreaker {
	m.mu.RLock()
	defer m.mu.RUnlock()

	cbs := make([]*models.CircuitBreaker, 0, len(m.circuitBreakers))
	for _, cb := range m.circuitBreakers {
		cbs = append(cbs, &models.CircuitBreaker{
			Namespace:        cb.Namespace,
			JobID:            cb.JobID,
			TaskID:           cb.TaskID,
			State:            cb.State,
			FailureCount:     cb.FailureCount,
			FailureThreshold: cb.FailureThreshold,
			SuccessThreshold: cb.SuccessThreshold,
			CurrentSuccesses: cb.CurrentSuccesses,
			LastFailureAt:    cb.LastFailureAt,
			LastStateChange:  cb.LastStateChange,
			OpenDuration:     cb.OpenDuration,
		})
	}
	return cbs
}

func (m *RetryManager) IsCircuitOpen(namespace, jobID, taskID string) bool {
	cb := m.GetCircuitBreaker(namespace, jobID, taskID)
	return cb != nil && cb.State == models.CircuitStateOpen
}

func (m *RetryManager) ExecuteWithRetry(
	ctx context.Context,
	namespace, jobID, taskID string,
	maxRetries int,
	fn func() error,
) error {
	var lastErr error
	var errType models.ErrorType

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if m.IsCircuitOpen(namespace, jobID, taskID) {
			return fmt.Errorf("circuit breaker is open for %s", taskID)
		}

		lastErr = fn()
		if lastErr == nil {
			m.RecordSuccess(namespace, jobID, taskID)
			return nil
		}

		errType = m.ClassifyError(lastErr.Error())
		
		if errType == models.ErrorTypeNonRetryable || errType == models.ErrorTypeBusiness {
			m.RecordFailure(namespace, jobID, taskID)
			return lastErr
		}

		if attempt < maxRetries {
			policy := m.getDefaultPolicy()
			delay := m.calculateBackoff(attempt, policy)
			
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(delay):
				m.RecordFailure(namespace, jobID, taskID)
			}
		}
	}

	if lastErr != nil {
		m.RecordFailure(namespace, jobID, taskID)
	}

	return lastErr
}
