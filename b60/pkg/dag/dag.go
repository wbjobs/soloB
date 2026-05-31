package dag

import (
	"context"
	"fmt"

	"github.com/example/distributed-cron/pkg/job"
	"github.com/example/distributed-cron/pkg/store"
)

func ValidateDAG(jobs []job.Job) error {
	jobMap := make(map[string]bool)
	for _, j := range jobs {
		jobMap[j.Name] = true
	}

	for _, j := range jobs {
		for _, dep := range j.Deps {
			if !jobMap[dep] {
				return fmt.Errorf("job %s depends on non-existent job %s", j.Name, dep)
			}
		}
	}

	visited := make(map[string]bool)
	recursionStack := make(map[string]bool)
	adjacency := buildAdjacencyList(jobs)

	for _, j := range jobs {
		if hasCycle(j.Name, adjacency, visited, recursionStack) {
			return fmt.Errorf("cycle detected in DAG involving job %s", j.Name)
		}
	}

	return nil
}

func buildAdjacencyList(jobs []job.Job) map[string][]string {
	adjacency := make(map[string][]string)
	for _, j := range jobs {
		adjacency[j.Name] = j.Deps
	}
	return adjacency
}

func hasCycle(jobName string, adjacency map[string][]string, visited, recursionStack map[string]bool) bool {
	if recursionStack[jobName] {
		return true
	}
	if visited[jobName] {
		return false
	}

	visited[jobName] = true
	recursionStack[jobName] = true

	for _, dep := range adjacency[jobName] {
		if hasCycle(dep, adjacency, visited, recursionStack) {
			return true
		}
	}

	recursionStack[jobName] = false
	return false
}

type DependencyChecker struct {
	jobStore *store.JobStore
	jobMap   map[string]job.Job
}

func NewDependencyChecker(jobStore *store.JobStore, jobs []job.Job) *DependencyChecker {
	jobMap := make(map[string]job.Job)
	for _, j := range jobs {
		jobMap[j.Name] = j
	}
	return &DependencyChecker{
		jobStore: jobStore,
		jobMap:   jobMap,
	}
}

func (dc *DependencyChecker) CheckDependencies(ctx context.Context, jobName string) (bool, error) {
	j, exists := dc.jobMap[jobName]
	if !exists {
		return false, fmt.Errorf("job %s not found", jobName)
	}

	if len(j.Deps) == 0 {
		return true, nil
	}

	for _, depName := range j.Deps {
		success, err := dc.jobStore.IsLastRunSuccessful(ctx, depName)
		if err != nil {
			return false, fmt.Errorf("failed to check dependency %s for job %s: %w", depName, jobName, err)
		}
		if !success {
			return false, nil
		}
	}

	return true, nil
}

func (dc *DependencyChecker) GetUnmetDependencies(ctx context.Context, jobName string) ([]string, error) {
	j, exists := dc.jobMap[jobName]
	if !exists {
		return nil, fmt.Errorf("job %s not found", jobName)
	}

	if len(j.Deps) == 0 {
		return nil, nil
	}

	var unmetDeps []string
	for _, depName := range j.Deps {
		success, err := dc.jobStore.IsLastRunSuccessful(ctx, depName)
		if err != nil {
			return nil, fmt.Errorf("failed to check dependency %s: %w", depName, err)
		}
		if !success {
			unmetDeps = append(unmetDeps, depName)
		}
	}

	return unmetDeps, nil
}
