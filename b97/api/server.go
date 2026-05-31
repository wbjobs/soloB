package api

import (
	"encoding/hex"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"modbus-fuzzer/anomaly"
	"modbus-fuzzer/detector"
	"modbus-fuzzer/fuzzer"
	"modbus-fuzzer/slave"
	"modbus-fuzzer/storage"
)

type APIServer struct {
	router         *gin.Engine
	slaveManager   *slave.SlaveManager
	detector       *detector.Detector
	master         *fuzzer.ModbusMaster
	isolationForest *anomaly.IsolationForest
	storage        *storage.InfluxDBStorage
	isFuzzing      bool
}

func NewAPIServer(slaveMgr *slave.SlaveManager, det *detector.Detector,
	mast *fuzzer.ModbusMaster, forest *anomaly.IsolationForest, store *storage.InfluxDBStorage) *APIServer {

	gin.SetMode(gin.ReleaseMode)
	router := gin.Default()

	server := &APIServer{
		router:          router,
		slaveManager:    slaveMgr,
		detector:        det,
		master:          mast,
		isolationForest: forest,
		storage:         store,
		isFuzzing:       false,
	}

	server.setupRoutes()
	return server
}

func (s *APIServer) setupRoutes() {
	api := s.router.Group("/api/v1")
	{
		slaves := api.Group("/slaves")
		{
			slaves.GET("", s.GetSlaves)
			slaves.POST("", s.AddSlave)
			slaves.GET("/:id", s.GetSlave)
			slaves.POST("/:id/start", s.StartSlave)
			slaves.POST("/:id/stop", s.StopSlave)
			slaves.POST("/:id/recover", s.RecoverSlave)
		}

		fuzz := api.Group("/fuzz")
		{
			fuzz.POST("/start", s.StartFuzzing)
			fuzz.POST("/stop", s.StopFuzzing)
			fuzz.GET("/status", s.GetFuzzStatus)
			fuzz.POST("/single", s.SingleFuzzTest)
			fuzz.POST("/stuck/:id", s.SimulateStuck)
			fuzz.POST("/syntax", s.SyntaxFuzzTest)
			fuzz.POST("/syntax/batch", s.StartSyntaxFuzzing)
			fuzz.GET("/functions", s.GetModbusFunctions)
		}

		results := api.Group("/results")
		{
			results.GET("", s.GetResults)
			results.GET("/statistics", s.GetStatistics)
			results.GET("/anomalies", s.GetAnomalies)
		}

		anomalyGroup := api.Group("/anomaly")
		{
			anomalyGroup.POST("/train", s.TrainAnomalyModel)
			anomalyGroup.GET("/report", s.GetAnomalyReport)
		}

		watchdog := api.Group("/watchdog")
		{
			watchdog.GET("/status", s.GetWatchdogStatus)
			watchdog.POST("/reset/:id", s.ResetWatchdog)
			watchdog.POST("/recover/:id", s.ManualRecovery)
		}

		storageGroup := api.Group("/storage")
		{
			storageGroup.GET("/query", s.QueryStorage)
			storageGroup.GET("/statistics", s.GetStorageStatistics)
			storageGroup.GET("/ping", s.PingStorage)
		}
	}
}

func (s *APIServer) GetSlaves(c *gin.Context) {
	slaves := make([]map[string]interface{}, 0)
	s.slaveManager.mu.RLock()
	for id, slave := range s.slaveManager.Slaves {
		slaves = append(slaves, map[string]interface{}{
			"id":                id,
			"is_running":        slave.IsRunning,
			"holding_registers": len(slave.HoldingRegisters),
			"coils":             len(slave.Coils),
		})
	}
	s.slaveManager.mu.RUnlock()
	c.JSON(http.StatusOK, gin.H{"slaves": slaves})
}

func (s *APIServer) AddSlave(c *gin.Context) {
	var req struct {
		ID               byte `json:"id" binding:"required"`
		HoldingRegisters int  `json:"holding_registers" binding:"required,min=1"`
		Coils            int  `json:"coils" binding:"required,min=1"`
		Port             int  `json:"port" binding:"required,min=1,max=65535"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	err := s.slaveManager.AddSlave(req.ID, req.HoldingRegisters, req.Coils)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	s.detector.AddSlave(req.ID, "localhost:"+strconv.Itoa(req.Port))
	c.JSON(http.StatusCreated, gin.H{"message": "Slave added successfully"})
}

func (s *APIServer) GetSlave(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid slave ID"})
		return
	}

	slave, exists := s.slaveManager.GetSlave(byte(id))
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Slave not found"})
		return
	}

	c.JSON(http.StatusOK, slave.GetStatus())
}

func (s *APIServer) StartSlave(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid slave ID"})
		return
	}

	var req struct {
		Port int `json:"port" binding:"required,min=1,max=65535"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	err = s.slaveManager.StartSlave(byte(id), req.Port)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Slave started successfully"})
}

func (s *APIServer) StopSlave(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid slave ID"})
		return
	}

	s.slaveManager.StopSlave(byte(id))
	c.JSON(http.StatusOK, gin.H{"message": "Slave stopped successfully"})
}

func (s *APIServer) StartFuzzing(c *gin.Context) {
	var req struct {
		SlaveID     byte `json:"slave_id" binding:"required"`
		TestCount   int  `json:"test_count" binding:"required,min=1"`
		IntervalMs  int  `json:"interval_ms" binding:"min=0"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if s.isFuzzing {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Fuzzing already in progress"})
		return
	}

	s.isFuzzing = true
	go s.runFuzzing(req.SlaveID, req.TestCount, req.IntervalMs)

	c.JSON(http.StatusOK, gin.H{"message": "Fuzzing started", "test_count": req.TestCount})
}

func (s *APIServer) runFuzzing(slaveID byte, testCount int, intervalMs int) {
	for i := 0; i < testCount && s.isFuzzing; i++ {
		packet, fuzzType, fuzzDesc := s.master.GenerateFuzzedPacket()
		result := s.detector.SendAndDetect(slaveID, packet, fuzzType.String(), fuzzDesc)

		dataPoint := anomaly.DataPoint{
			ResponseTime: result.ResponseTime.Seconds() * 1000,
			PacketSize:   float64(len(result.ResponsePacket)),
			Status:       float64(result.Status),
			Timestamp:    result.Timestamp,
		}
		anomalyScore := s.isolationForest.AnomalyScore(dataPoint)

		if s.storage != nil {
			s.storage.WriteTestResult(
				slaveID,
				fuzzType.String(),
				fuzzDesc,
				result.Status.String(),
				result.ResponseTime,
				len(packet),
				len(result.ResponsePacket),
				anomalyScore,
			)
		}

		if intervalMs > 0 {
			time.Sleep(time.Duration(intervalMs) * time.Millisecond)
		}
	}
	s.isFuzzing = false
}

func (s *APIServer) StopFuzzing(c *gin.Context) {
	s.isFuzzing = false
	c.JSON(http.StatusOK, gin.H{"message": "Fuzzing stopped"})
}

func (s *APIServer) GetFuzzStatus(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"is_fuzzing": s.isFuzzing,
	})
}

func (s *APIServer) SingleFuzzTest(c *gin.Context) {
	var req struct {
		SlaveID byte `json:"slave_id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	packet, fuzzType, fuzzDesc := s.master.GenerateFuzzedPacket()
	result := s.detector.SendAndDetect(req.SlaveID, packet, fuzzType.String(), fuzzDesc)

	dataPoint := anomaly.DataPoint{
		ResponseTime: result.ResponseTime.Seconds() * 1000,
		PacketSize:   float64(len(result.ResponsePacket)),
		Status:       float64(result.Status),
		Timestamp:    result.Timestamp,
	}
	anomalyScore := s.isolationForest.AnomalyScore(dataPoint)

	c.JSON(http.StatusOK, gin.H{
		"timestamp":      result.Timestamp,
		"slave_id":       result.SlaveID,
		"fuzz_type":      result.FuzzType,
		"fuzz_desc":      result.FuzzDesc,
		"request_packet": hex.EncodeToString(result.RequestPacket),
		"response_packet": hex.EncodeToString(result.ResponsePacket),
		"status":         result.Status.String(),
		"status_desc":    result.StatusDesc,
		"response_time_ms": result.ResponseTime.Microseconds() / 1000,
		"anomaly_score":  anomalyScore,
	})
}

func (s *APIServer) GetResults(c *gin.Context) {
	results := s.detector.GetResults()

	response := make([]gin.H, len(results))
	for i, r := range results {
		response[i] = gin.H{
			"timestamp":       r.Timestamp,
			"slave_id":        r.SlaveID,
			"fuzz_type":       r.FuzzType,
			"fuzz_desc":       r.FuzzDesc,
			"status":          r.Status.String(),
			"status_desc":     r.StatusDesc,
			"response_time_ms": r.ResponseTime.Microseconds() / 1000,
		}
	}

	c.JSON(http.StatusOK, gin.H{"results": response, "count": len(response)})
}

func (s *APIServer) GetStatistics(c *gin.Context) {
	stats := s.detector.GetStatistics()
	c.JSON(http.StatusOK, stats)
}

func (s *APIServer) GetAnomalies(c *gin.Context) {
	anomalies := s.detector.GetAnomalies()

	response := make([]gin.H, len(anomalies))
	for i, r := range anomalies {
		response[i] = gin.H{
			"timestamp":       r.Timestamp,
			"slave_id":        r.SlaveID,
			"fuzz_type":       r.FuzzType,
			"fuzz_desc":       r.FuzzDesc,
			"status":          r.Status.String(),
			"status_desc":     r.StatusDesc,
			"response_time_ms": r.ResponseTime.Microseconds() / 1000,
		}
	}

	c.JSON(http.StatusOK, gin.H{"anomalies": response, "count": len(response)})
}

func (s *APIServer) TrainAnomalyModel(c *gin.Context) {
	results := s.detector.GetResults()

	dataPoints := make([]anomaly.DataPoint, len(results))
	for i, r := range results {
		dataPoints[i] = anomaly.DataPoint{
			ResponseTime: r.ResponseTime.Seconds() * 1000,
			PacketSize:   float64(len(r.ResponsePacket)),
			Status:       float64(r.Status),
			Timestamp:    r.Timestamp,
		}
	}

	if len(dataPoints) < 10 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Not enough data to train. Need at least 10 test results."})
		return
	}

	s.isolationForest.Train(dataPoints)
	c.JSON(http.StatusOK, gin.H{"message": "Anomaly detection model trained successfully", "training_samples": len(dataPoints)})
}

func (s *APIServer) GetAnomalyReport(c *gin.Context) {
	threshold := 0.5
	if t := c.Query("threshold"); t != "" {
		if parsed, err := strconv.ParseFloat(t, 64); err == nil {
			threshold = parsed
		}
	}

	results := s.detector.GetResults()
	reports := make([]gin.H, 0)

	for _, r := range results {
		dataPoint := anomaly.DataPoint{
			ResponseTime: r.ResponseTime.Seconds() * 1000,
			PacketSize:   float64(len(r.ResponsePacket)),
			Status:       float64(r.Status),
			Timestamp:    r.Timestamp,
		}

		score := s.isolationForest.AnomalyScore(dataPoint)
		if score >= threshold {
			report := anomaly.GenerateAnomalyReport(dataPoint, score, r.StatusDesc)
			reports = append(reports, gin.H{
				"timestamp":      report.Timestamp,
				"anomaly_score":  report.AnomalyScore,
				"response_time":  report.ResponseTime,
				"packet_size":    report.PacketSize,
				"status":         report.Status,
				"recommendation": report.Recommendation,
			})
		}
	}

	c.JSON(http.StatusOK, gin.H{"reports": reports, "count": len(reports)})
}

func (s *APIServer) QueryStorage(c *gin.Context) {
	if s.storage == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Storage not configured"})
		return
	}

	startTime := time.Now().Add(-24 * time.Hour)
	endTime := time.Now()

	slaveID := byte(0)
	if id := c.Query("slave_id"); id != "" {
		if parsed, err := strconv.Atoi(id); err == nil {
			slaveID = byte(parsed)
		}
	}

	results, err := s.storage.QueryTestResults(slaveID, startTime, endTime)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"results": results})
}

func (s *APIServer) GetStorageStatistics(c *gin.Context) {
	if s.storage == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Storage not configured"})
		return
	}

	startTime := time.Now().Add(-24 * time.Hour)
	endTime := time.Now()

	stats, err := s.storage.QueryStatistics(startTime, endTime)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, stats)
}

func (s *APIServer) PingStorage(c *gin.Context) {
	if s.storage == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"connected": false, "error": "Storage not configured"})
		return
	}

	connected := s.storage.Ping()
	c.JSON(http.StatusOK, gin.H{"connected": connected})
}

func (s *APIServer) RecoverSlave(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid slave ID"})
		return
	}

	err = s.slaveManager.WarmRestartSlave(byte(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Slave recovery triggered successfully"})
}

func (s *APIServer) SimulateStuck(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid slave ID"})
		return
	}

	slave, exists := s.slaveManager.GetSlave(byte(id))
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Slave not found"})
		return
	}

	slave.SetStuck(true)
	c.JSON(http.StatusOK, gin.H{"message": "Slave stuck simulation activated"})
}

func (s *APIServer) GetWatchdogStatus(c *gin.Context) {
	stats := s.detector.GetStatistics()
	c.JSON(http.StatusOK, gin.H{
		"watchdog_status": stats["slave_watchdogs"],
		"total_triggers":  stats["watchdog_triggers"],
	})
}

func (s *APIServer) ResetWatchdog(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid slave ID"})
		return
	}

	slave, exists := s.slaveManager.GetSlave(byte(id))
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Slave not found"})
		return
	}

	slave.ResetNoResponse()
	c.JSON(http.StatusOK, gin.H{"message": "Watchdog counter reset"})
}

func (s *APIServer) ManualRecovery(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid slave ID"})
		return
	}

	err = s.detector.ManualRecovery(byte(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Manual recovery command sent"})
}

func (s *APIServer) Run(addr string) error {
	return s.router.Run(addr)
}

func (s *APIServer) SyntaxFuzzTest(c *gin.Context) {
	var req struct {
		SlaveID byte `json:"slave_id" binding:"required"`
	}
	
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	packet, mutType, desc := s.master.GenerateSyntaxTreePacket(req.SlaveID)
	result := s.detector.SendAndDetect(req.SlaveID, packet, "SyntaxTree: "+mutType, desc)

	dataPoint := anomaly.DataPoint{
		ResponseTime: result.ResponseTime.Seconds() * 1000,
		PacketSize:   float64(len(result.ResponsePacket)),
		Status:       float64(result.Status),
		Timestamp:    result.Timestamp,
	}
	anomalyScore := s.isolationForest.AnomalyScore(dataPoint)

	c.JSON(http.StatusOK, gin.H{
		"timestamp":      result.Timestamp,
		"slave_id":       result.SlaveID,
		"mutation_type":  mutType,
		"mutation_desc":  desc,
		"request_packet": hex.EncodeToString(result.RequestPacket),
		"response_packet": hex.EncodeToString(result.ResponsePacket),
		"status":         result.Status.String(),
		"status_desc":    result.StatusDesc,
		"response_time_ms": result.ResponseTime.Microseconds() / 1000,
		"anomaly_score":  anomalyScore,
	})
}

func (s *APIServer) StartSyntaxFuzzing(c *gin.Context) {
	var req struct {
		SlaveID  byte `json:"slave_id" binding:"required"`
		TestCount int  `json:"test_count" binding:"required,min=1"`
		IntervalMs int `json:"interval_ms" binding:"min=0"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if s.isFuzzing {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Fuzzing already in progress"})
		return
	}

	s.isFuzzing = true
	go s.runSyntaxFuzzing(req.SlaveID, req.TestCount, req.IntervalMs)

	c.JSON(http.StatusOK, gin.H{
		"message":    "Syntax tree fuzzing started",
		"test_count": req.TestCount,
	})
}

func (s *APIServer) runSyntaxFuzzing(slaveID byte, testCount int, intervalMs int) {
	for i := 0; i < testCount && s.isFuzzing; i++ {
		packet, mutType, desc := s.master.GenerateSyntaxTreePacket(slaveID)
		result := s.detector.SendAndDetect(slaveID, packet, "SyntaxTree: "+mutType, desc)

		dataPoint := anomaly.DataPoint{
			ResponseTime: result.ResponseTime.Seconds() * 1000,
			PacketSize:   float64(len(result.ResponsePacket)),
			Status:       float64(result.Status),
			Timestamp:    result.Timestamp,
		}
		anomalyScore := s.isolationForest.AnomalyScore(dataPoint)

		if s.storage != nil {
			s.storage.WriteTestResult(
				slaveID,
				"SyntaxTree: "+mutType,
				desc,
				result.Status.String(),
				result.ResponseTime,
				len(packet),
				len(result.ResponsePacket),
				anomalyScore,
			)
		}

		if intervalMs > 0 {
			time.Sleep(time.Duration(intervalMs) * time.Millisecond)
		}
	}
	s.isFuzzing = false
}

func (s *APIServer) GetModbusFunctions(c *gin.Context) {
	functions := s.master.GetAvailableFunctions()
	c.JSON(http.StatusOK, gin.H{
		"modbus_functions": functions,
		"total_count":     len(functions),
	})
}
