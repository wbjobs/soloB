package anomaly

import (
	"math"
	"math/rand"
	"sync"
	"time"
)

type DataPoint struct {
	ResponseTime float64
	PacketSize   float64
	Status       float64
	Timestamp    time.Time
}

type IsolationTree struct {
	Left            *IsolationTree
	Right           *IsolationTree
	SplitAttribute  int
	SplitValue      float64
	Height          int
	IsLeaf          bool
	Size            int
}

type IsolationForest struct {
	Trees     []*IsolationTree
	NumTrees  int
	Subsample int
	mu        sync.Mutex
}

func NewIsolationForest(numTrees int, subsample int) *IsolationForest {
	return &IsolationForest{
		Trees:     make([]*IsolationTree, 0),
		NumTrees:  numTrees,
		Subsample: subsample,
	}
}

func (forest *IsolationForest) Train(data []DataPoint) {
	forest.mu.Lock()
	defer forest.mu.Unlock()

	forest.Trees = make([]*IsolationTree, forest.NumTrees)
	maxHeight := int(math.Ceil(math.Log2(float64(forest.Subsample))))

	var wg sync.WaitGroup
	for i := 0; i < forest.NumTrees; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			subsample := forest.bootstrapSample(data)
			forest.Trees[idx] = forest.buildTree(subsample, 0, maxHeight)
		}(i)
	}
	wg.Wait()
}

func (forest *IsolationForest) bootstrapSample(data []DataPoint) []DataPoint {
	sampleSize := forest.Subsample
	if len(data) < sampleSize {
		sampleSize = len(data)
	}

	sample := make([]DataPoint, sampleSize)
	for i := 0; i < sampleSize; i++ {
		sample[i] = data[rand.Intn(len(data))]
	}
	return sample
}

func (forest *IsolationForest) buildTree(data []DataPoint, currentHeight int, maxHeight int) *IsolationTree {
	node := &IsolationTree{
		Height: currentHeight,
		Size:   len(data),
	}

	if currentHeight >= maxHeight || len(data) <= 1 {
		node.IsLeaf = true
		return node
	}

	numAttrs := 3
	splitAttr := rand.Intn(numAttrs)

	minVal, maxVal := getAttributeRange(data, splitAttr)
	if minVal == maxVal {
		node.IsLeaf = true
		return node
	}

	splitValue := minVal + rand.Float64()*(maxVal-minVal)
	node.SplitAttribute = splitAttr
	node.SplitValue = splitValue

	leftData, rightData := splitData(data, splitAttr, splitValue)
	node.Left = forest.buildTree(leftData, currentHeight+1, maxHeight)
	node.Right = forest.buildTree(rightData, currentHeight+1, maxHeight)

	return node
}

func getAttributeRange(data []DataPoint, attr int) (float64, float64) {
	if len(data) == 0 {
		return 0, 0
	}

	minVal := getAttributeValue(data[0], attr)
	maxVal := minVal

	for _, point := range data {
		val := getAttributeValue(point, attr)
		if val < minVal {
			minVal = val
		}
		if val > maxVal {
			maxVal = val
		}
	}
	return minVal, maxVal
}

func getAttributeValue(point DataPoint, attr int) float64 {
	switch attr {
	case 0:
		return point.ResponseTime
	case 1:
		return point.PacketSize
	case 2:
		return point.Status
	default:
		return 0
	}
}

func splitData(data []DataPoint, attr int, value float64) ([]DataPoint, []DataPoint) {
	left := make([]DataPoint, 0)
	right := make([]DataPoint, 0)

	for _, point := range data {
		if getAttributeValue(point, attr) < value {
			left = append(left, point)
		} else {
			right = append(right, point)
		}
	}
	return left, right
}

func (forest *IsolationForest) AnomalyScore(point DataPoint) float64 {
	forest.mu.Lock()
	defer forest.mu.Unlock()

	if len(forest.Trees) == 0 {
		return 0
	}

	totalPathLength := 0.0
	for _, tree := range forest.Trees {
		totalPathLength += forest.pathLength(point, tree, 0)
	}

	avgPathLength := totalPathLength / float64(len(forest.Trees))
	expectedPathLength := harmonicNumber(float64(forest.Subsample)-1) - float64(forest.Subsample-1)/float64(forest.Subsample)

	if expectedPathLength == 0 {
		return 0
	}

	return math.Pow(2, -avgPathLength/expectedPathLength)
}

func (forest *IsolationForest) pathLength(point DataPoint, node *IsolationTree, currentLength int) float64 {
	if node == nil || node.IsLeaf {
		if node != nil && node.Size > 1 {
			return float64(currentLength) + adjustment(node.Size)
		}
		return float64(currentLength)
	}

	val := getAttributeValue(point, node.SplitAttribute)
	if val < node.SplitValue {
		return forest.pathLength(point, node.Left, currentLength+1)
	}
	return forest.pathLength(point, node.Right, currentLength+1)
}

func adjustment(n int) float64 {
	if n <= 1 {
		return 0
	}
	return 2 * (harmonicNumber(float64(n)-1) - float64(n-1)/float64(n))
}

func harmonicNumber(x float64) float64 {
	return math.Log(x) + 0.5772156649
}

func (forest *IsolationForest) DetectAnomalies(data []DataPoint, threshold float64) []DataPoint {
	anomalies := make([]DataPoint, 0)
	for _, point := range data {
		score := forest.AnomalyScore(point)
		if score >= threshold {
			anomalies = append(anomalies, point)
		}
	}
	return anomalies
}

type AnomalyReport struct {
	Timestamp         time.Time
	AnomalyScore      float64
	ResponseTime      float64
	PacketSize        float64
	Status            int
	Recommendation    string
}

func GenerateAnomalyReport(point DataPoint, score float64, statusDesc string) *AnomalyReport {
	report := &AnomalyReport{
		Timestamp:    point.Timestamp,
		AnomalyScore: score,
		ResponseTime: point.ResponseTime,
		PacketSize:   point.PacketSize,
		Status:       int(point.Status),
	}

	if score > 0.8 {
		report.Recommendation = "CRITICAL: High anomaly score detected. Investigate immediately."
	} else if score > 0.6 {
		report.Recommendation = "WARNING: Moderate anomaly detected. Monitor closely."
	} else if score > 0.4 {
		report.Recommendation = "INFO: Low anomaly detected. Keep observing."
	} else {
		report.Recommendation = "NORMAL: No significant anomaly detected."
	}

	if point.Status != 0 {
		report.Recommendation += " Response status: " + statusDesc
	}

	return report
}
