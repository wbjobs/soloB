package tenancy

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"dtsplatform/internal/config"
	"dtsplatform/internal/models"
)

type NamespaceManager struct {
	cfg        *config.Config
	namespaces map[string]*models.Namespace
	usage      map[string]*models.ResourceUsage
	mu         sync.RWMutex
}

func NewNamespaceManager(cfg *config.Config) *NamespaceManager {
	return &NamespaceManager{
		cfg:        cfg,
		namespaces: make(map[string]*models.Namespace),
		usage:      make(map[string]*models.ResourceUsage),
	}
}

func (m *NamespaceManager) Start(ctx context.Context) {
	if !m.cfg.Tenancy.Enabled {
		log.Println("Multi-tenancy disabled")
		return
	}

	log.Println("Namespace manager started")

	if err := m.createDefaultNamespace(); err != nil {
		log.Printf("Failed to create default namespace: %v", err)
	}
}

func (m *NamespaceManager) createDefaultNamespace() error {
	defaultNS := m.cfg.Tenancy.DefaultNamespace
	if defaultNS == "" {
		defaultNS = "default"
	}

	existing, _ := m.GetNamespace(defaultNS)
	if existing != nil {
		return nil
	}

	ns := &models.Namespace{
		Name:        defaultNS,
		Description: "Default namespace",
		Status:      models.NamespaceActive,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
		Quota: models.ResourceQuota{
			MaxConcurrentJobs:     m.cfg.Tenancy.DefaultQuota.MaxConcurrentJobs,
			MaxTotalTasks:         m.cfg.Tenancy.DefaultQuota.MaxTotalTasks,
			MaxExecutors:          m.cfg.Tenancy.DefaultQuota.MaxExecutors,
			MaxCPU:                m.cfg.Tenancy.DefaultQuota.MaxCPU,
			MaxMemoryGB:           m.cfg.Tenancy.DefaultQuota.MaxMemoryGB,
			MaxStorageGB:          m.cfg.Tenancy.DefaultQuota.MaxStorageGB,
			MaxDailyExecutions:    m.cfg.Tenancy.DefaultQuota.MaxDailyExecutions,
			MaxTaskTimeoutMinutes: m.cfg.Tenancy.DefaultQuota.MaxTaskTimeoutMinutes,
			MaxRetriesPerTask:     m.cfg.Tenancy.DefaultQuota.MaxRetriesPerTask,
		},
		Usage: models.ResourceUsage{},
		Labels:      map[string]string{"default": "true"},
		Annotations: map[string]string{},
	}

	return m.CreateNamespace(ns)
}

func (m *NamespaceManager) CreateNamespace(ns *models.Namespace) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.namespaces[ns.Name]; exists {
		return fmt.Errorf("namespace %s already exists", ns.Name)
	}

	if ns.CreatedAt.IsZero() {
		ns.CreatedAt = time.Now()
	}
	ns.UpdatedAt = time.Now()

	m.namespaces[ns.Name] = ns
	m.usage[ns.Name] = &models.ResourceUsage{}

	log.Printf("Namespace created: %s", ns.Name)
	return nil
}

func (m *NamespaceManager) GetNamespace(name string) (*models.Namespace, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	ns, exists := m.namespaces[name]
	if !exists {
		return nil, fmt.Errorf("namespace %s not found", name)
	}
	return ns, nil
}

func (m *NamespaceManager) ListNamespaces() []*models.Namespace {
	m.mu.RLock()
	defer m.mu.RUnlock()

	namespaces := make([]*models.Namespace, 0, len(m.namespaces))
	for _, ns := range m.namespaces {
		namespaces = append(namespaces, ns)
	}
	return namespaces
}

func (m *NamespaceManager) UpdateNamespace(name string, updates *models.Namespace) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	ns, exists := m.namespaces[name]
	if !exists {
		return fmt.Errorf("namespace %s not found", name)
	}

	if updates.Description != "" {
		ns.Description = updates.Description
	}
	if updates.Status != "" {
		ns.Status = updates.Status
	}
	if updates.Labels != nil {
		ns.Labels = updates.Labels
	}
	if updates.Annotations != nil {
		ns.Annotations = updates.Annotations
	}
	if updates.Quota.MaxConcurrentJobs > 0 {
		ns.Quota = updates.Quota
	}
	ns.UpdatedAt = time.Now()

	return nil
}

func (m *NamespaceManager) DeleteNamespace(name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.namespaces[name]; !exists {
		return fmt.Errorf("namespace %s not found", name)
	}

	if name == m.cfg.Tenancy.DefaultNamespace {
		return fmt.Errorf("cannot delete default namespace")
	}

	usage := m.usage[name]
	if usage != nil && (usage.CurrentRunningTasks > 0 || usage.CurrentConcurrentJobs > 0) {
		return fmt.Errorf("namespace %s has running jobs/tasks", name)
	}

	delete(m.namespaces, name)
	delete(m.usage, name)
	log.Printf("Namespace deleted: %s", name)
	return nil
}

func (m *NamespaceManager) CheckQuota(namespace string, resourceCheck func(*models.ResourceQuota, *models.ResourceUsage) bool) (bool, error) {
	if !m.cfg.Tenancy.Enabled {
		return true, nil
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	ns, exists := m.namespaces[namespace]
	if !exists {
		return false, fmt.Errorf("namespace %s not found", namespace)
	}

	if ns.Status != models.NamespaceActive {
		return false, fmt.Errorf("namespace %s is not active", namespace)
	}

	usage, exists := m.usage[namespace]
	if !exists {
		usage = &models.ResourceUsage{}
		m.usage[namespace] = usage
	}

	return resourceCheck(&ns.Quota, usage), nil
}

func (m *NamespaceManager) CanExecuteJob(namespace string) (bool, error) {
	return m.CheckQuota(namespace, func(quota *models.ResourceQuota, usage *models.ResourceUsage) bool {
		if quota.MaxConcurrentJobs > 0 && usage.CurrentConcurrentJobs >= quota.MaxConcurrentJobs {
			return false
		}
		if quota.MaxDailyExecutions > 0 && usage.DailyExecutionsToday >= quota.MaxDailyExecutions {
			return false
		}
		return true
	})
}

func (m *NamespaceManager) CanExecuteTask(namespace string) (bool, error) {
	return m.CheckQuota(namespace, func(quota *models.ResourceQuota, usage *models.ResourceUsage) bool {
		if quota.MaxTotalTasks > 0 && usage.CurrentRunningTasks >= quota.MaxTotalTasks {
			return false
		}
		return true
	})
}

func (m *NamespaceManager) IncrementJobCount(namespace string) error {
	if !m.cfg.Tenancy.Enabled {
		return nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.namespaces[namespace]; !exists {
		return fmt.Errorf("namespace %s not found", namespace)
	}

	usage, exists := m.usage[namespace]
	if !exists {
		usage = &models.ResourceUsage{}
		m.usage[namespace] = usage
	}

	usage.CurrentConcurrentJobs++
	usage.DailyExecutionsToday++

	return nil
}

func (m *NamespaceManager) DecrementJobCount(namespace string) error {
	if !m.cfg.Tenancy.Enabled {
		return nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	usage, exists := m.usage[namespace]
	if !exists {
		return nil
	}

	if usage.CurrentConcurrentJobs > 0 {
		usage.CurrentConcurrentJobs--
	}
	return nil
}

func (m *NamespaceManager) IncrementTaskCount(namespace string) error {
	if !m.cfg.Tenancy.Enabled {
		return nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	usage, exists := m.usage[namespace]
	if !exists {
		usage = &models.ResourceUsage{}
		m.usage[namespace] = usage
	}

	usage.CurrentRunningTasks++
	return nil
}

func (m *NamespaceManager) DecrementTaskCount(namespace string) error {
	if !m.cfg.Tenancy.Enabled {
		return nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	usage, exists := m.usage[namespace]
	if !exists {
		return nil
	}

	if usage.CurrentRunningTasks > 0 {
		usage.CurrentRunningTasks--
	}
	return nil
}

func (m *NamespaceManager) GetUsage(namespace string) (*models.ResourceUsage, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	usage, exists := m.usage[namespace]
	if !exists {
		return nil, fmt.Errorf("usage not found for namespace %s", namespace)
	}
	return usage, nil
}

func (m *NamespaceManager) GetNamespaceOrDefault(namespace string) string {
	if !m.cfg.Tenancy.Enabled || namespace == "" {
		if m.cfg.Tenancy.DefaultNamespace != "" {
			return m.cfg.Tenancy.DefaultNamespace
		}
		return "default"
	}
	return namespace
}

func (m *NamespaceManager) ValidateAccess(accessingNamespace, targetNamespace string) bool {
	if !m.cfg.Tenancy.Enabled {
		return true
	}

	if accessingNamespace == "" {
		accessingNamespace = m.GetNamespaceOrDefault("")
	}

	if accessingNamespace == targetNamespace {
		return true
	}

	return false
}
