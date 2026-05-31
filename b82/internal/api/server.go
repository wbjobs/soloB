package api

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"iiothub/internal/database"
	"iiothub/internal/prediction"
	"iiothub/internal/websocket"
	"iiothub/pkg/models"
)

type Server struct {
	db               *database.Database
	cfg              *models.Config
	router           *gin.Engine
	server           *http.Server
	wsServer         *websocket.WebSocketServer
	predictionSched  *prediction.PredictionScheduler
}

func NewServer(db *database.Database, cfg *models.Config, wsServer *websocket.WebSocketServer, predSched *prediction.PredictionScheduler) *Server {
	gin.SetMode(gin.ReleaseMode)
	router := gin.Default()

	s := &Server{
		db:              db,
		cfg:             cfg,
		router:          router,
		wsServer:        wsServer,
		predictionSched: predSched,
	}

	s.setupRoutes()
	return s
}

func (s *Server) setupRoutes() {
	api := s.router.Group("/api/v1")
	{
		api.GET("/health", s.healthCheck)
		api.GET("/meters/:meter_id/aggregated", s.getAggregatedData)
		api.GET("/meters/:meter_id/readings", s.getReadings)
		api.GET("/anomalies", s.getAnomalies)
		api.GET("/anomalies/:meter_id", s.getMeterAnomalies)
		api.POST("/webhook", s.handleWebhook)

		api.GET("/prediction/:meter_id", s.getPrediction)
		api.GET("/prediction/meters", s.getRegisteredMeters)
		api.POST("/prediction/meters/:meter_id", s.registerMeter)
		api.DELETE("/prediction/meters/:meter_id", s.unregisterMeter)

		api.GET("/ws", s.handleWebSocket)
	}
}

func (s *Server) healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
		"timestamp": time.Now(),
	})
}

func (s *Server) getAggregatedData(c *gin.Context) {
	meterID := c.Param("meter_id")

	startStr := c.DefaultQuery("start", time.Now().Add(-24*time.Hour).Format(time.RFC3339))
	endStr := c.DefaultQuery("end", time.Now().Format(time.RFC3339))

	start, err := time.Parse(time.RFC3339, startStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start time format"})
		return
	}

	end, err := time.Parse(time.RFC3339, endStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid end time format"})
		return
	}

	data, err := s.db.QueryAggregatedData(c.Request.Context(), meterID, start, end)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"meter_id": meterID,
		"start": start,
		"end": end,
		"count": len(data),
		"data": data,
	})
}

func (s *Server) getReadings(c *gin.Context) {
	meterID := c.Param("meter_id")
	limit := c.DefaultQuery("limit", "100")

	var limitInt int
	if _, err := fmt.Sscanf(limit, "%d", &limitInt); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit"})
		return
	}

	if limitInt > 1000 {
		limitInt = 1000
	}

	data, err := s.db.GetRecentReadings(c.Request.Context(), meterID, limitInt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"meter_id": meterID,
		"count": len(data),
		"data": data,
	})
}

func (s *Server) getAnomalies(c *gin.Context) {
	startStr := c.DefaultQuery("start", time.Now().Add(-24*time.Hour).Format(time.RFC3339))
	endStr := c.DefaultQuery("end", time.Now().Format(time.RFC3339))

	start, err := time.Parse(time.RFC3339, startStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start time format"})
		return
	}

	end, err := time.Parse(time.RFC3339, endStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid end time format"})
		return
	}

	data, err := s.db.QueryAnomalyEvents(c.Request.Context(), "", start, end)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"start": start,
		"end": end,
		"count": len(data),
		"data": data,
	})
}

func (s *Server) getMeterAnomalies(c *gin.Context) {
	meterID := c.Param("meter_id")

	startStr := c.DefaultQuery("start", time.Now().Add(-24*time.Hour).Format(time.RFC3339))
	endStr := c.DefaultQuery("end", time.Now().Format(time.RFC3339))

	start, err := time.Parse(time.RFC3339, startStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start time format"})
		return
	}

	end, err := time.Parse(time.RFC3339, endStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid end time format"})
		return
	}

	data, err := s.db.QueryAnomalyEvents(c.Request.Context(), meterID, start, end)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"meter_id": meterID,
		"start": start,
		"end": end,
		"count": len(data),
		"data": data,
	})
}

func (s *Server) handleWebhook(c *gin.Context) {
	var event models.AnomalyEvent
	if err := c.ShouldBindJSON(&event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	log.Printf("Received webhook for meter %s: anomaly type=%s, score=%.3f",
		event.MeterID, event.AnomalyType, event.AnomalyScore)

	c.JSON(http.StatusOK, gin.H{
		"status": "received",
		"event_id": event.ID,
	})
}

func (s *Server) getPrediction(c *gin.Context) {
	meterID := c.Param("meter_id")

	result, err := s.predictionSched.GetPrediction(meterID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if result == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not enough data for prediction"})
		return
	}

	c.JSON(http.StatusOK, result)
}

func (s *Server) getRegisteredMeters(c *gin.Context) {
	meters := s.predictionSched.GetRegisteredMeters()
	c.JSON(http.StatusOK, gin.H{
		"count":   len(meters),
		"meters":  meters,
	})
}

func (s *Server) registerMeter(c *gin.Context) {
	meterID := c.Param("meter_id")
	s.predictionSched.RegisterMeter(meterID)
	c.JSON(http.StatusOK, gin.H{
		"status":   "registered",
		"meter_id": meterID,
	})
}

func (s *Server) unregisterMeter(c *gin.Context) {
	meterID := c.Param("meter_id")
	s.predictionSched.UnregisterMeter(meterID)
	c.JSON(http.StatusOK, gin.H{
		"status":   "unregistered",
		"meter_id": meterID,
	})
}

func (s *Server) handleWebSocket(c *gin.Context) {
	s.wsServer.HandleConnection(c.Writer, c.Request)
}

func (s *Server) Start() error {
	addr := fmt.Sprintf(":%d", s.cfg.API.Port)
	s.server = &http.Server{
		Addr:    addr,
		Handler: s.router,
	}

	log.Printf("API server starting on %s", addr)

	go func() {
		if err := s.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("API server error: %v", err)
		}
	}()

	return nil
}

func (s *Server) Stop() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	log.Println("Stopping API server...")
	if err := s.server.Shutdown(ctx); err != nil {
		return err
	}

	log.Println("API server stopped")
	return nil
}
