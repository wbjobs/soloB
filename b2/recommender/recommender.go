package recommender

import (
	"fmt"
	"sort"
	"time"

	"k8s-metrics-recommender/database"
	"k8s-metrics-recommender/models"

	"gorm.io/gorm"
)

type Recommender struct {
	db            *gorm.DB
	bufferPercent int
	daysBack      int
}

func NewRecommender() *Recommender {
	return &Recommender{
		db:            database.DB,
		bufferPercent: 20,
		daysBack:      7,
	}
}

func (r *Recommender) GetRecommendation(namespace, workloadName string, workloadType models.WorkloadType) (*models.RecommendationResponse, error) {
	cutoffTime := time.Now().AddDate(0, 0, -r.daysBack)

	var records []models.MetricRecord
	err := r.db.Where(
		"namespace = ? AND workload_name = ? AND workload_type = ? AND recorded_at >= ?",
		namespace, workloadName, workloadType, cutoffTime,
	).Order("recorded_at ASC").Find(&records).Error

	if err != nil {
		return nil, fmt.Errorf("failed to query metrics: %w", err)
	}

	if len(records) == 0 {
		return &models.RecommendationResponse{
			Success:      false,
			Namespace:    namespace,
			Workload:     workloadName,
			WorkloadType: string(workloadType),
			Message:      fmt.Sprintf("no metrics data found for %s/%s in the past %d days", workloadType, workloadName, r.daysBack),
		}, nil
	}

	cpuP90 := r.calculateP90CPU(records)
	memoryP90 := r.calculateP90Memory(records)

	cpuWithBuffer := cpuP90 * (1 + float64(r.bufferPercent)/100)
	memoryWithBuffer := uint64(float64(memoryP90) * (1 + float64(r.bufferPercent)/100))

	cpuLimit := cpuWithBuffer * 1.5
	memoryLimit := uint64(float64(memoryWithBuffer) * 1.5)

	return &models.RecommendationResponse{
		Success:      true,
		Namespace:    namespace,
		Workload:     workloadName,
		WorkloadType: string(workloadType),
		Recommendation: models.Recommendation{
			CPURequest:    formatCPU(cpuWithBuffer),
			CPULimit:      formatCPU(cpuLimit),
			MemoryRequest: formatMemory(memoryWithBuffer),
			MemoryLimit:   formatMemory(memoryLimit),
		},
		Summary: models.RecommendationSummary{
			TotalRecords:      len(records),
			TimeRangeDays:     r.daysBack,
			CPUPercentile90:   cpuP90,
			MemoryPercentile90: memoryP90,
			BufferPercent:     r.bufferPercent,
		},
	}, nil
}

func (r *Recommender) calculateP90CPU(records []models.MetricRecord) float64 {
	cpuValues := make([]float64, len(records))
	for i, record := range records {
		cpuValues[i] = record.CPUCores
	}
	sort.Float64s(cpuValues)
	return percentile90(cpuValues)
}

func (r *Recommender) calculateP90Memory(records []models.MetricRecord) uint64 {
	memoryValues := make([]uint64, len(records))
	for i, record := range records {
		memoryValues[i] = record.MemoryBytes
	}
	sort.Slice(memoryValues, func(i, j int) bool {
		return memoryValues[i] < memoryValues[j]
	})
	return percentile90Uint64(memoryValues)
}

func percentile90(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	index := int(float64(len(values)-1) * 0.9)
	return values[index]
}

func percentile90Uint64(values []uint64) uint64 {
	if len(values) == 0 {
		return 0
	}
	index := int(float64(len(values)-1) * 0.9)
	return values[index]
}

func formatCPU(cpuCores float64) string {
	if cpuCores >= 1.0 {
		return fmt.Sprintf("%.2f", cpuCores)
	}
	millicores := cpuCores * 1000
	return fmt.Sprintf("%dm", int(millicores))
}

func formatMemory(bytes uint64) string {
	const (
		KB = 1024
		MB = 1024 * KB
		GB = 1024 * MB
	)

	switch {
	case bytes >= GB:
		return fmt.Sprintf("%.2fGi", float64(bytes)/float64(GB))
	case bytes >= MB:
		return fmt.Sprintf("%.2fMi", float64(bytes)/float64(MB))
	case bytes >= KB:
		return fmt.Sprintf("%.2fKi", float64(bytes)/float64(KB))
	default:
		return fmt.Sprintf("%dB", bytes)
	}
}
