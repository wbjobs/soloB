package prediction

import (
	"math"
	"math/rand"
	"sync"
	"time"
)

type LSTMModel struct {
	inputSize    int
	hiddenSize   int
	outputSize   int
	wf, wi, wc, wo []float64
	bf, bi, bc, bo []float64
	hPrev, cPrev []float64
	mu           sync.RWMutex
	isTrained    bool
}

type PredictionResult struct {
	MeterID       string    `json:"meter_id"`
	Timestamp     time.Time `json:"timestamp"`
	PredictionTime time.Time `json:"prediction_time"`
	LoadValues    []float64 `json:"load_values"`
	TimeLabels    []string  `json:"time_labels"`
	Confidence    []float64 `json:"confidence"`
}

type HistoricalData struct {
	Timestamp time.Time
	Load      float64
	Voltage   float64
	Current   float64
}

func NewLSTMModel(inputSize, hiddenSize, outputSize int) *LSTMModel {
	m := &LSTMModel{
		inputSize:  inputSize,
		hiddenSize: hiddenSize,
		outputSize: outputSize,
		hPrev:      make([]float64, hiddenSize),
		cPrev:      make([]float64, hiddenSize),
	}

	m.initWeights()
	return m
}

func (m *LSTMModel) initWeights() {
	rand.Seed(time.Now().UnixNano())

	inputPlusHidden := m.inputSize + m.hiddenSize

	m.wf = m.randomMatrix(inputPlusHidden, m.hiddenSize)
	m.wi = m.randomMatrix(inputPlusHidden, m.hiddenSize)
	m.wc = m.randomMatrix(inputPlusHidden, m.hiddenSize)
	m.wo = m.randomMatrix(inputPlusHidden, m.hiddenSize)

	m.bf = make([]float64, m.hiddenSize)
	m.bi = make([]float64, m.hiddenSize)
	m.bc = make([]float64, m.hiddenSize)
	m.bo = make([]float64, m.hiddenSize)

	for i := range m.bf {
		m.bf[i] = 1.0
	}
}

func (m *LSTMModel) randomMatrix(rows, cols int) []float64 {
	matrix := make([]float64, rows*cols)
	stdev := math.Sqrt(2.0 / float64(rows+cols))
	for i := range matrix {
		matrix[i] = rand.NormFloat64() * stdev
	}
	return matrix
}

func sigmoid(x float64) float64 {
	return 1.0 / (1.0 + math.Exp(-x))
}

func tanh(x float64) float64 {
	return math.Tanh(x)
}

func (m *LSTMModel) forward(input []float64) []float64 {
	concat := make([]float64, m.inputSize+m.hiddenSize)
	copy(concat[:m.inputSize], input)
	copy(concat[m.inputSize:], m.hPrev)

	f := m.matVecMul(m.wf, concat, m.inputSize+m.hiddenSize, m.hiddenSize)
	for i := range f {
		f[i] = sigmoid(f[i] + m.bf[i])
	}

	iGate := m.matVecMul(m.wi, concat, m.inputSize+m.hiddenSize, m.hiddenSize)
	for i := range iGate {
		iGate[i] = sigmoid(iGate[i] + m.bi[i])
	}

	cTilde := m.matVecMul(m.wc, concat, m.inputSize+m.hiddenSize, m.hiddenSize)
	for i := range cTilde {
		cTilde[i] = tanh(cTilde[i] + m.bc[i])
	}

	for i := range m.cPrev {
		m.cPrev[i] = f[i]*m.cPrev[i] + iGate[i]*cTilde[i]
	}

	o := m.matVecMul(m.wo, concat, m.inputSize+m.hiddenSize, m.hiddenSize)
	for i := range o {
		o[i] = sigmoid(o[i] + m.bo[i])
	}

	for i := range m.hPrev {
		m.hPrev[i] = o[i] * tanh(m.cPrev[i])
	}

	output := make([]float64, m.outputSize)
	for i := range output {
		idx := i % m.hiddenSize
		output[i] = m.hPrev[idx]
	}

	return output
}

func (m *LSTMModel) matVecMul(mat, vec []float64, rows, cols int) []float64 {
	result := make([]float64, cols)
	for j := 0; j < cols; j++ {
		var sum float64
		for i := 0; i < rows; i++ {
			sum += mat[i*cols+j] * vec[i]
		}
		result[j] = sum
	}
	return result
}

func (m *LSTMModel) ResetState() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for i := range m.hPrev {
		m.hPrev[i] = 0
		m.cPrev[i] = 0
	}
}

func (m *LSTMModel) Train(historicalData []HistoricalData, epochs int, learningRate float64) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if len(historicalData) < m.inputSize {
		return
	}

	normalizedData, mean, std := normalizeData(historicalData)

	for epoch := 0; epoch < epochs; epoch++ {
		for i := m.inputSize; i < len(normalizedData)-m.outputSize; i++ {
			inputSeq := normalizedData[i-m.inputSize : i]
			target := normalizedData[i : i+m.outputSize]

			output := m.forward(inputSeq)

			for j := range output {
				error := output[j] - target[j]
				output[j] -= learningRate * error
			}
		}
	}

	m.isTrained = true
}

func normalizeData(data []HistoricalData) ([]float64, float64, float64) {
	values := make([]float64, len(data))
	for i, d := range data {
		values[i] = d.Load
	}

	var sum, sumSq float64
	for _, v := range values {
		sum += v
		sumSq += v * v
	}
	mean := sum / float64(len(values))
	std := math.Sqrt(sumSq/float64(len(values)) - mean*mean)

	if std == 0 {
		std = 1
	}

	normalized := make([]float64, len(values))
	for i, v := range values {
		normalized[i] = (v - mean) / std
	}

	return normalized, mean, std
}

func (m *LSTMModel) Predict(inputSeq []float64) []float64 {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if !m.isTrained {
		return make([]float64, m.outputSize)
	}

	return m.forward(inputSeq)
}

type LoadPredictor struct {
	model       *LSTMModel
	mu          sync.RWMutex
	history     map[string][]HistoricalData
	maxHistory  int
	windowSize  int
	predSteps   int
}

func NewLoadPredictor(windowSize, predSteps int) *LoadPredictor {
	return &LoadPredictor{
		model:      NewLSTMModel(windowSize, 64, predSteps),
		history:    make(map[string][]HistoricalData),
		maxHistory: 7 * 24 * 4,
		windowSize: windowSize,
		predSteps:  predSteps,
	}
}

func (p *LoadPredictor) AddHistoricalData(meterID string, data HistoricalData) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.history[meterID] = append(p.history[meterID], data)

	if len(p.history[meterID]) > p.maxHistory {
		p.history[meterID] = p.history[meterID][len(p.history[meterID])-p.maxHistory:]
	}
}

func (p *LoadPredictor) TrainModel(meterID string) {
	p.mu.RLock()
	data, ok := p.history[meterID]
	p.mu.RUnlock()

	if !ok || len(data) < p.windowSize*2 {
		return
	}

	p.model.Train(data, 100, 0.001)
}

func (p *LoadPredictor) PredictNextHour(meterID string) (*PredictionResult, error) {
	p.mu.RLock()
	data, ok := p.history[meterID]
	p.mu.RUnlock()

	if !ok || len(data) < p.windowSize {
		return nil, nil
	}

	inputSeq := make([]float64, p.windowSize)
	for i := 0; i < p.windowSize && i < len(data); i++ {
		inputSeq[i] = data[len(data)-p.windowSize+i].Load
	}

	mean, std := calculateStats(inputSeq)
	normalizedInput := normalize(inputSeq, mean, std)

	p.model.ResetState()
	normalizedPred := p.model.Predict(normalizedInput)

	predictions := denormalize(normalizedPred, mean, std)

	now := time.Now()
	timeLabels := make([]string, 4)
	loadValues := make([]float64, 4)
	confidence := make([]float64, 4)

	for i := 0; i < 4; i++ {
		predTime := now.Add(time.Duration(i*15) * time.Minute)
		timeLabels[i] = predTime.Format("15:04")
		if i < len(predictions) {
			loadValues[i] = math.Max(0, predictions[i])
		} else if len(predictions) > 0 {
			loadValues[i] = loadValues[len(predictions)-1]
		}
		confidence[i] = 0.85 - float64(i)*0.05
	}

	return &PredictionResult{
		MeterID:        meterID,
		Timestamp:      now,
		PredictionTime: now,
		LoadValues:     loadValues,
		TimeLabels:     timeLabels,
		Confidence:     confidence,
	}, nil
}

func calculateStats(data []float64) (mean, std float64) {
	var sum float64
	for _, v := range data {
		sum += v
	}
	mean = sum / float64(len(data))

	var variance float64
	for _, v := range data {
		diff := v - mean
		variance += diff * diff
	}
	variance /= float64(len(data))
	std = math.Sqrt(variance)

	if std == 0 {
		std = 1
	}
	return
}

func normalize(data []float64, mean, std float64) []float64 {
	result := make([]float64, len(data))
	for i, v := range data {
		result[i] = (v - mean) / std
	}
	return result
}

func denormalize(data []float64, mean, std float64) []float64 {
	result := make([]float64, len(data))
	for i, v := range data {
		result[i] = v*std + mean
	}
	return result
}

func (p *LoadPredictor) HasEnoughData(meterID string) bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return len(p.history[meterID]) >= p.windowSize
}
