package collector

import (
	"math/rand"
	"time"

	"k8s-metrics-recommender/config"
	"k8s-metrics-recommender/database"
	"k8s-metrics-recommender/models"

	"gorm.io/gorm"
)

type MetricCollector struct {
	db      *gorm.DB
	config  *config.Config
	randGen *rand.Rand
}

func NewMetricCollector(cfg *config.Config) *MetricCollector {
	return &MetricCollector{
		db:      database.DB,
		config:  cfg,
		randGen: rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

func (mc *MetricCollector) GenerateHistoricalData(days int) error {
	now := time.Now()
	startTime := now.AddDate(0, 0, -days)

	workloads := map[string]map[string][]struct {
		Name string
		Type models.WorkloadType
	}{
		"cluster-prod": {
			"default": {
				{Name: "nginx", Type: models.Deployment},
				{Name: "redis", Type: models.StatefulSet},
			},
			"production": {
				{Name: "api-gateway", Type: models.Deployment},
				{Name: "user-service", Type: models.Deployment},
				{Name: "order-service", Type: models.Deployment},
				{Name: "mysql-primary", Type: models.StatefulSet},
			},
			"monitoring": {
				{Name: "prometheus", Type: models.StatefulSet},
				{Name: "grafana", Type: models.Deployment},
			},
		},
		"cluster-staging": {
			"default": {
				{Name: "test-app", Type: models.Deployment},
			},
			"staging": {
				{Name: "staging-api", Type: models.Deployment},
				{Name: "staging-db", Type: models.StatefulSet},
			},
		},
		"cluster-dev": {
			"default": {
				{Name: "dev-tools", Type: models.Deployment},
			},
			"development": {
				{Name: "dev-api", Type: models.Deployment},
			},
		},
	}

	baseMetrics := map[string]map[string]map[string]struct {
		BaseCPU    float64
		CPUVar     float64
		BaseMemory uint64
		MemoryVar  float64
	}{
		"cluster-prod": {
			"default": {
				"nginx":         {BaseCPU: 0.5, CPUVar: 0.3, BaseMemory: 512 * 1024 * 1024, MemoryVar: 0.2},
				"redis":         {BaseCPU: 0.3, CPUVar: 0.2, BaseMemory: 1024 * 1024 * 1024, MemoryVar: 0.3},
			},
			"production": {
				"api-gateway":   {BaseCPU: 2.0, CPUVar: 1.0, BaseMemory: 2 * 1024 * 1024 * 1024, MemoryVar: 0.4},
				"user-service":  {BaseCPU: 1.5, CPUVar: 0.8, BaseMemory: 1536 * 1024 * 1024, MemoryVar: 0.3},
				"order-service": {BaseCPU: 1.0, CPUVar: 0.5, BaseMemory: 1024 * 1024 * 1024, MemoryVar: 0.25},
				"mysql-primary": {BaseCPU: 4.0, CPUVar: 2.0, BaseMemory: 8 * 1024 * 1024 * 1024, MemoryVar: 0.5},
			},
			"monitoring": {
				"prometheus": {BaseCPU: 1.0, CPUVar: 0.5, BaseMemory: 4 * 1024 * 1024 * 1024, MemoryVar: 0.4},
				"grafana":    {BaseCPU: 0.2, CPUVar: 0.1, BaseMemory: 256 * 1024 * 1024, MemoryVar: 0.15},
			},
		},
		"cluster-staging": {
			"default": {
				"test-app": {BaseCPU: 0.3, CPUVar: 0.15, BaseMemory: 256 * 1024 * 1024, MemoryVar: 0.1},
			},
			"staging": {
				"staging-api": {BaseCPU: 0.8, CPUVar: 0.4, BaseMemory: 768 * 1024 * 1024, MemoryVar: 0.2},
				"staging-db":  {BaseCPU: 2.0, CPUVar: 1.0, BaseMemory: 4 * 1024 * 1024 * 1024, MemoryVar: 0.3},
			},
		},
		"cluster-dev": {
			"default": {
				"dev-tools": {BaseCPU: 0.2, CPUVar: 0.1, BaseMemory: 128 * 1024 * 1024, MemoryVar: 0.1},
			},
			"development": {
				"dev-api": {BaseCPU: 0.5, CPUVar: 0.25, BaseMemory: 512 * 1024 * 1024, MemoryVar: 0.15},
			},
		},
	}

	for t := startTime; t.Before(now); t = t.Add(time.Hour) {
		for clusterName, namespaces := range workloads {
			for namespace, workloadList := range namespaces {
				for _, workload := range workloadList {
					metrics, ok := baseMetrics[clusterName][namespace][workload.Name]
					if !ok {
						continue
					}

					hourFactor := 1.0
					hour := t.Hour()
					if hour >= 9 && hour <= 18 {
						hourFactor = 1.5
					} else if hour >= 0 && hour < 6 {
						hourFactor = 0.5
					}

					cpuCores := metrics.BaseCPU + (mc.randGen.Float64()-0.5)*2*metrics.CPUVar
					cpuCores *= hourFactor
					if cpuCores < 0.01 {
						cpuCores = 0.01
					}

					memoryBytes := float64(metrics.BaseMemory) * (1 + (mc.randGen.Float64()-0.5)*2*metrics.MemoryVar)
					memoryBytes *= hourFactor

					record := models.MetricRecord{
						ClusterName:  clusterName,
						Namespace:    namespace,
						WorkloadName: workload.Name,
						WorkloadType: workload.Type,
						CPUCores:     cpuCores,
						MemoryBytes:  uint64(memoryBytes),
						RecordedAt:   t,
					}

					if err := mc.db.Create(&record).Error; err != nil {
						return err
					}
				}
			}
		}
	}

	return nil
}

func (mc *MetricCollector) HasAnyData() (bool, error) {
	var count int64
	err := mc.db.Model(&models.MetricRecord{}).Count(&count).Error
	return count > 0, err
}
