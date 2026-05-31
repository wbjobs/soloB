package lineage

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"dtsplatform/internal/config"
	"dtsplatform/internal/models"
)

type JobDependency struct {
	JobID          string
	DownstreamJobs map[string]bool
	UpstreamJobs   map[string]bool
}

type LineageAnalyzer struct {
	cfg           *config.Config
	dependencies  map[string]*JobDependency
	dagGraph      map[string]map[string]bool
	lineageCache  map[string]*models.JobLineage
	mu            sync.RWMutex
}

func NewLineageAnalyzer(cfg *config.Config) *LineageAnalyzer {
	return &LineageAnalyzer{
		cfg:           cfg,
		dependencies:  make(map[string]*JobDependency),
		dagGraph:      make(map[string]map[string]bool),
		lineageCache:  make(map[string]*models.JobLineage),
	}
}

func (a *LineageAnalyzer) Start(ctx context.Context) {
	if !a.cfg.Lineage.Enabled {
		log.Println("Job lineage analysis disabled")
		return
	}
	log.Println("Lineage analyzer started")
}

func (a *LineageAnalyzer) RegisterJob(job *models.Job) {
	if !a.cfg.Lineage.Enabled {
		return
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	if _, exists := a.dependencies[job.ID]; !exists {
		a.dependencies[job.ID] = &JobDependency{
			JobID:          job.ID,
			DownstreamJobs: make(map[string]bool),
			UpstreamJobs:   make(map[string]bool),
		}
	}

	if len(job.DAG.Tasks) > 0 {
		a.registerDAGTasks(job.ID, job.DAG)
	}

	log.Printf("Job registered for lineage: %s", job.ID)
}

func (a *LineageAnalyzer) registerDAGTasks(jobID string, dag models.DAGSpec) {
	for _, edge := range dag.Edges {
		fromKey := fmt.Sprintf("%s:%s", jobID, edge.From)
		toKey := fmt.Sprintf("%s:%s", jobID, edge.To)

		if _, exists := a.dagGraph[fromKey]; !exists {
			a.dagGraph[fromKey] = make(map[string]bool)
		}
		a.dagGraph[fromKey][toKey] = true
	}
}

func (a *LineageAnalyzer) SetJobDependency(sourceJobID, targetJobID string) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if _, exists := a.dependencies[sourceJobID]; !exists {
		a.dependencies[sourceJobID] = &JobDependency{
			JobID:          sourceJobID,
			DownstreamJobs: make(map[string]bool),
			UpstreamJobs:   make(map[string]bool),
		}
	}
	a.dependencies[sourceJobID].DownstreamJobs[targetJobID] = true

	if _, exists := a.dependencies[targetJobID]; !exists {
		a.dependencies[targetJobID] = &JobDependency{
			JobID:          targetJobID,
			DownstreamJobs: make(map[string]bool),
			UpstreamJobs:   make(map[string]bool),
		}
	}
	a.dependencies[targetJobID].UpstreamJobs[sourceJobID] = true

	log.Printf("Dependency created: %s -> %s", sourceJobID, targetJobID)
}

func (a *LineageAnalyzer) AnalyzeImpact(ctx context.Context, failedJobID, failedTaskID, executionID string) (*models.ImpactAnalysis, error) {
	if !a.cfg.Lineage.Enabled {
		return nil, fmt.Errorf("lineage analysis is disabled")
	}

	a.mu.RLock()
	defer a.mu.RUnlock()

	analysis := &models.ImpactAnalysis{
		FailedJobID:     failedJobID,
		FailedTaskID:    failedTaskID,
		FailedExecution: executionID,
		AffectedJobs:    make([]string, 0),
		AffectedTasks:   make([]string, 0),
		RerunableTasks:  make([]string, 0),
	}

	visited := make(map[string]bool)
	queue := []string{failedJobID}

	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]

		if visited[current] {
			continue
		}
		visited[current] = true

		if dep, exists := a.dependencies[current]; exists {
			for downstream := range dep.DownstreamJobs {
				if !visited[downstream] {
					queue = append(queue, downstream)
					analysis.AffectedJobs = append(analysis.AffectedJobs, downstream)
					analysis.RerunableTasks = append(analysis.RerunableTasks, downstream)
				}
			}
		}
	}

	if failedTaskID != "" {
		analysis.AffectedTasks = a.findAffectedTasks(failedJobID, failedTaskID)
		analysis.RerunableTasks = append(analysis.RerunableTasks, analysis.AffectedTasks...)
	}

	analysis.EstimatedDelay = a.estimateDelay(analysis)
	analysis.DataDependencies = a.getDataDependencies(failedJobID)

	return analysis, nil
}

func (a *LineageAnalyzer) findAffectedTasks(jobID, failedTaskID string) []string {
	affected := make([]string, 0)
	
	taskKey := fmt.Sprintf("%s:%s", jobID, failedTaskID)
	visited := make(map[string]bool)
	queue := []string{taskKey}

	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]

		if visited[current] {
			continue
		}
		visited[current] = true

		if deps, exists := a.dagGraph[current]; exists {
			for next := range deps {
				if !visited[next] {
					queue = append(queue, next)
					affected = append(affected, next)
				}
			}
		}
	}

	return affected
}

func (a *LineageAnalyzer) estimateDelay(analysis *models.ImpactAnalysis) time.Duration {
	totalTasks := len(analysis.AffectedJobs) + len(analysis.AffectedTasks)
	estimatedPerTask := 5 * time.Minute
	return time.Duration(totalTasks) * estimatedPerTask
}

func (a *LineageAnalyzer) getDataDependencies(jobID string) []string {
	deps := make([]string, 0)
	if dep, exists := a.dependencies[jobID]; exists {
		for upstream := range dep.UpstreamJobs {
			deps = append(deps, upstream)
		}
	}
	return deps
}

func (a *LineageAnalyzer) GetJobLineage(jobID string) (*models.JobLineage, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()

	if cache, exists := a.lineageCache[jobID]; exists {
		return cache, nil
	}

	if dep, exists := a.dependencies[jobID]; exists {
		lineage := &models.JobLineage{
			JobID:          jobID,
			SourceJobs:     mapKeys(dep.UpstreamJobs),
			DownstreamJobs: mapKeys(dep.DownstreamJobs),
			AnalyzedAt:     time.Now(),
		}

		lineage.AllDependencies = a.collectAllDependencies(jobID)
		a.lineageCache[jobID] = lineage

		return lineage, nil
	}

	return &models.JobLineage{
		JobID:      jobID,
		AnalyzedAt: time.Now(),
	}, nil
}

func (a *LineageAnalyzer) collectAllDependencies(jobID string) []string {
	visited := make(map[string]bool)
	result := make([]string, 0)
	queue := []string{jobID}

	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]

		if visited[current] {
			continue
		}
		visited[current] = true

		if current != jobID {
			result = append(result, current)
		}

		if dep, exists := a.dependencies[current]; exists {
			for upstream := range dep.UpstreamJobs {
				if !visited[upstream] {
					queue = append(queue, upstream)
				}
			}
			for downstream := range dep.DownstreamJobs {
				if !visited[downstream] {
					queue = append(queue, downstream)
				}
			}
		}
	}

	return result
}

func (a *LineageAnalyzer) GetDownstreamTasks(jobID, taskID string) []string {
	a.mu.RLock()
	defer a.mu.RUnlock()

	return a.findAffectedTasks(jobID, taskID)
}

func (a *LineageAnalyzer) ClearCache(jobID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.lineageCache, jobID)
}

func (a *LineageAnalyzer) BuildGraph() map[string][]string {
	a.mu.RLock()
	defer a.mu.RUnlock()

	graph := make(map[string][]string)
	for jobID, dep := range a.dependencies {
		downstream := make([]string, 0, len(dep.DownstreamJobs))
		for d := range dep.DownstreamJobs {
			downstream = append(downstream, d)
		}
		graph[jobID] = downstream
	}
	return graph
}

func (a *LineageAnalyzer) RemoveJob(jobID string) {
	a.mu.Lock()
	defer a.mu.Unlock()

	delete(a.dependencies, jobID)
	delete(a.lineageCache, jobID)

	for _, dep := range a.dependencies {
		delete(dep.DownstreamJobs, jobID)
		delete(dep.UpstreamJobs, jobID)
	}

	prefix := jobID + ":"
	for key := range a.dagGraph {
		if len(key) >= len(prefix) && key[:len(prefix)] == prefix {
			delete(a.dagGraph, key)
		}
	}
}

func mapKeys(m map[string]bool) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
