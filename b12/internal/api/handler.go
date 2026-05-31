package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"dtsplatform/api/proto"
	"dtsplatform/internal/config"
	"dtsplatform/internal/models"
	"dtsplatform/internal/monitoring"
	"dtsplatform/internal/scheduler"
	"dtsplatform/internal/streaming"
	"dtsplatform/internal/store"

	"github.com/gin-gonic/gin"
)

type APIHandler struct {
	cfg           *config.Config
	scheduler     *scheduler.Scheduler
	streamManager *streaming.StreamManager
	postgres      *store.PostgresStore
	redis         *store.RedisStore
	minio         *store.MinioStore
	metrics       *monitoring.Metrics
}

func NewAPIHandler(
	cfg *config.Config,
	sched *scheduler.Scheduler,
	sm *streaming.StreamManager,
	pg *store.PostgresStore,
	rd *store.RedisStore,
	mio *store.MinioStore,
	metrics *monitoring.Metrics,
) *APIHandler {
	return &APIHandler{
		cfg:           cfg,
		scheduler:     sched,
		streamManager: sm,
		postgres:      pg,
		redis:         rd,
		minio:         mio,
		metrics:       metrics,
	}
}

func (h *APIHandler) RegisterRoutes(r *gin.Engine) {
	api := r.Group("/api/v1")
	{
		api.GET("/health", h.Health)

		jobs := api.Group("/jobs")
		{
			jobs.POST("", h.CreateJob)
			jobs.GET("", h.ListJobs)
			jobs.GET("/:id", h.GetJob)
			jobs.PUT("/:id", h.UpdateJob)
			jobs.DELETE("/:id", h.DeleteJob)
			jobs.POST("/:id/trigger", h.TriggerJob)
			jobs.POST("/:id/pause", h.PauseJob)
			jobs.POST("/:id/resume", h.ResumeJob)
			jobs.GET("/:id/executions", h.ListJobExecutions)
		}

		executors := api.Group("/executors")
		{
			executors.GET("", h.ListExecutors)
		}

		pipelines := api.Group("/pipelines")
		{
			pipelines.POST("", h.CreatePipeline)
			pipelines.GET("", h.ListPipelines)
			pipelines.GET("/:id", h.GetPipeline)
			pipelines.DELETE("/:id", h.DeletePipeline)
			pipelines.POST("/:id/start", h.StartPipeline)
			pipelines.POST("/:id/stop", h.StopPipeline)
		}

		metrics := api.Group("/metrics")
		{
			metrics.GET("", gin.WrapH(h.metrics.Handler()))
		}
	}
}

type CreateJobRequest struct {
	ID          string                  `json:"id" binding:"required"`
	Name        string                  `json:"name" binding:"required"`
	Description string                  `json:"description"`
	Type        string                  `json:"type" binding:"required"`
	Cron        string                  `json:"cron"`
	DAG         models.DAGSpec          `json:"dag"`
	Payload     json.RawMessage         `json:"payload"`
	MaxRetries  int                     `json:"max_retries"`
	Timeout     int64                   `json:"timeout"`
}

func (h *APIHandler) CreateJob(c *gin.Context) {
	start := time.Now()
	var req CreateJobRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.recordAPI(c, "POST", "/jobs", 400, start)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	job := models.Job{
		ID:          req.ID,
		Name:        req.Name,
		Description: req.Description,
		Type:        req.Type,
		Cron:        req.Cron,
		DAG:         req.DAG,
		Payload:     req.Payload,
		Status:      models.JobStatusActive,
		MaxRetries:  req.MaxRetries,
		Timeout:     time.Duration(req.Timeout) * time.Second,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if err := h.scheduler.AddJob(c.Request.Context(), job); err != nil {
		h.recordAPI(c, "POST", "/jobs", 500, start)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if h.postgres != nil {
		h.postgres.CreateJob(c.Request.Context(), &job)
	}

	h.recordAPI(c, "POST", "/jobs", 201, start)
	c.JSON(http.StatusCreated, job)
}

func (h *APIHandler) ListJobs(c *gin.Context) {
	start := time.Now()
	jobs := h.scheduler.ListJobs()
	h.recordAPI(c, "GET", "/jobs", 200, start)
	c.JSON(http.StatusOK, gin.H{"data": jobs, "total": len(jobs)})
}

func (h *APIHandler) GetJob(c *gin.Context) {
	start := time.Now()
	id := c.Param("id")
	job, exists := h.scheduler.GetJob(id)
	if !exists {
		h.recordAPI(c, "GET", "/jobs/:id", 404, start)
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}
	h.recordAPI(c, "GET", "/jobs/:id", 200, start)
	c.JSON(http.StatusOK, job)
}

func (h *APIHandler) UpdateJob(c *gin.Context) {
	start := time.Now()
	id := c.Param("id")
	_, exists := h.scheduler.GetJob(id)
	if !exists {
		h.recordAPI(c, "PUT", "/jobs/:id", 404, start)
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}

	var req CreateJobRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.recordAPI(c, "PUT", "/jobs/:id", 400, start)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	job := models.Job{
		ID:          id,
		Name:        req.Name,
		Description: req.Description,
		Type:        req.Type,
		Cron:        req.Cron,
		DAG:         req.DAG,
		Payload:     req.Payload,
		Status:      models.JobStatusActive,
		MaxRetries:  req.MaxRetries,
		Timeout:     time.Duration(req.Timeout) * time.Second,
		UpdatedAt:   time.Now(),
	}

	if err := h.scheduler.AddJob(c.Request.Context(), job); err != nil {
		h.recordAPI(c, "PUT", "/jobs/:id", 500, start)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.recordAPI(c, "PUT", "/jobs/:id", 200, start)
	c.JSON(http.StatusOK, job)
}

func (h *APIHandler) DeleteJob(c *gin.Context) {
	start := time.Now()
	id := c.Param("id")
	if err := h.scheduler.DeleteJob(c.Request.Context(), id); err != nil {
		h.recordAPI(c, "DELETE", "/jobs/:id", 500, start)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if h.postgres != nil {
		h.postgres.DeleteJob(c.Request.Context(), id)
	}

	h.recordAPI(c, "DELETE", "/jobs/:id", 204, start)
	c.Status(http.StatusNoContent)
}

func (h *APIHandler) TriggerJob(c *gin.Context) {
	start := time.Now()
	id := c.Param("id")
	if err := h.scheduler.TriggerJob(c.Request.Context(), id); err != nil {
		h.recordAPI(c, "POST", "/jobs/:id/trigger", 404, start)
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	h.recordAPI(c, "POST", "/jobs/:id/trigger", 202, start)
	c.JSON(http.StatusAccepted, gin.H{"message": "job triggered"})
}

func (h *APIHandler) PauseJob(c *gin.Context) {
	start := time.Now()
	id := c.Param("id")
	job, exists := h.scheduler.GetJob(id)
	if !exists {
		h.recordAPI(c, "POST", "/jobs/:id/pause", 404, start)
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}

	job.Paused = true
	job.UpdatedAt = time.Now()
	h.scheduler.AddJob(c.Request.Context(), *job)

	h.recordAPI(c, "POST", "/jobs/:id/pause", 200, start)
	c.JSON(http.StatusOK, gin.H{"message": "job paused"})
}

func (h *APIHandler) ResumeJob(c *gin.Context) {
	start := time.Now()
	id := c.Param("id")
	job, exists := h.scheduler.GetJob(id)
	if !exists {
		h.recordAPI(c, "POST", "/jobs/:id/resume", 404, start)
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}

	job.Paused = false
	job.UpdatedAt = time.Now()
	h.scheduler.AddJob(c.Request.Context(), *job)

	h.recordAPI(c, "POST", "/jobs/:id/resume", 200, start)
	c.JSON(http.StatusOK, gin.H{"message": "job resumed"})
}

func (h *APIHandler) ListJobExecutions(c *gin.Context) {
	start := time.Now()
	id := c.Param("id")

	var executions []models.DAGExecution
	if h.postgres != nil {
		var err error
		executions, err = h.postgres.GetExecutionsByJob(c.Request.Context(), id, 100)
		if err != nil {
			h.recordAPI(c, "GET", "/jobs/:id/executions", 500, start)
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	h.recordAPI(c, "GET", "/jobs/:id/executions", 200, start)
	c.JSON(http.StatusOK, gin.H{"data": executions, "total": len(executions)})
}

func (h *APIHandler) ListExecutors(c *gin.Context) {
	start := time.Now()
	h.recordAPI(c, "GET", "/executors", 200, start)
	c.JSON(http.StatusOK, gin.H{"data": []string{}, "total": 0})
}

type CreatePipelineRequest struct {
	Name        string                    `json:"name" binding:"required"`
	SourceTopic string                    `json:"source_topic" binding:"required"`
	TargetTopic string                    `json:"target_topic" binding:"required"`
	Transform   *streaming.TransformSpec   `json:"transform"`
	Window      *streaming.WindowSpec      `json:"window"`
	ExactlyOnce *streaming.ExactlyOnceSpec `json:"exactly_once"`
}

func (h *APIHandler) CreatePipeline(c *gin.Context) {
	start := time.Now()
	var req CreatePipelineRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.recordAPI(c, "POST", "/pipelines", 400, start)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	protoReq := &streaming.CreateStreamPipelineRequest{
		Name:        req.Name,
		SourceTopic: req.SourceTopic,
		TargetTopic: req.TargetTopic,
		Transform:   req.Transform,
		Window:      req.Window,
		ExactlyOnce: req.ExactlyOnce,
	}

	pipelineID, err := h.streamManager.CreatePipeline(c.Request.Context(), protoReq)
	if err != nil {
		h.recordAPI(c, "POST", "/pipelines", 500, start)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.recordAPI(c, "POST", "/pipelines", 201, start)
	c.JSON(http.StatusCreated, gin.H{"id": pipelineID})
}

func (h *APIHandler) ListPipelines(c *gin.Context) {
	start := time.Now()
	pipelines := h.streamManager.ListPipelines()
	h.recordAPI(c, "GET", "/pipelines", 200, start)
	c.JSON(http.StatusOK, gin.H{"data": pipelines, "total": len(pipelines)})
}

func (h *APIHandler) GetPipeline(c *gin.Context) {
	start := time.Now()
	id := c.Param("id")
	pipeline, exists := h.streamManager.GetPipeline(id)
	if !exists {
		h.recordAPI(c, "GET", "/pipelines/:id", 404, start)
		c.JSON(http.StatusNotFound, gin.H{"error": "pipeline not found"})
		return
	}
	h.recordAPI(c, "GET", "/pipelines/:id", 200, start)
	c.JSON(http.StatusOK, pipeline)
}

func (h *APIHandler) DeletePipeline(c *gin.Context) {
	start := time.Now()
	id := c.Param("id")
	if err := h.streamManager.DeletePipeline(c.Request.Context(), id); err != nil {
		h.recordAPI(c, "DELETE", "/pipelines/:id", 500, start)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.recordAPI(c, "DELETE", "/pipelines/:id", 204, start)
	c.Status(http.StatusNoContent)
}

func (h *APIHandler) StartPipeline(c *gin.Context) {
	start := time.Now()
	id := c.Param("id")
	if err := h.streamManager.StartPipeline(c.Request.Context(), id); err != nil {
		h.recordAPI(c, "POST", "/pipelines/:id/start", 500, start)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.recordAPI(c, "POST", "/pipelines/:id/start", 202, start)
	c.JSON(http.StatusAccepted, gin.H{"message": "pipeline started"})
}

func (h *APIHandler) StopPipeline(c *gin.Context) {
	start := time.Now()
	id := c.Param("id")
	if err := h.streamManager.StopPipeline(c.Request.Context(), id); err != nil {
		h.recordAPI(c, "POST", "/pipelines/:id/stop", 500, start)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.recordAPI(c, "POST", "/pipelines/:id/stop", 202, start)
	c.JSON(http.StatusAccepted, gin.H{"message": "pipeline stopped"})
}

func (h *APIHandler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":  "healthy",
		"time":    time.Now().Format(time.RFC3339),
		"leader":  h.scheduler != nil && h.scheduler.IsLeader(),
	})
}

func (h *APIHandler) recordAPI(c *gin.Context, method, path string, status int, start time.Time) {
	if h.metrics != nil {
		latency := time.Since(start).Seconds()
		statusStr := fmt.Sprintf("%d", status)
		h.metrics.RecordAPIRequest(method, path, statusStr, latency)
	}
}
