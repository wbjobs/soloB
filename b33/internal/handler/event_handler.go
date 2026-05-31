package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"funnelservice/internal/model"
	"funnelservice/internal/service"
)

type EventHandler struct {
	service *service.EventService
}

func NewEventHandler(svc *service.EventService) *EventHandler {
	return &EventHandler{service: svc}
}

func (h *EventHandler) RecordEvent(c *gin.Context) {
	var event model.Event
	if err := c.ShouldBindJSON(&event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.RecordEvent(c.Request.Context(), &event); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h *EventHandler) CalculateFunnel(c *gin.Context) {
	eventsParam := c.Query("events")
	startEvent := c.Query("start_event")
	endEvent := c.Query("end_event")
	windowMinutesStr := c.Query("window_minutes")

	if windowMinutesStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "window_minutes is required"})
		return
	}

	windowMinutes, err := strconv.ParseInt(windowMinutesStr, 10, 64)
	if err != nil || windowMinutes < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "window_minutes must be a positive integer"})
		return
	}

	var events []string
	if eventsParam != "" {
		events = splitAndTrim(eventsParam)
		if len(events) < 2 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "events must contain at least 2 event names"})
			return
		}
	} else if startEvent != "" && endEvent != "" {
		events = []string{startEvent, endEvent}
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "either events or both start_event and end_event must be provided"})
		return
	}

	req := &model.FunnelRequest{
		Events:        events,
		WindowMinutes: windowMinutes,
	}

	resp, err := h.service.CalculateFunnel(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, resp)
}

func (h *EventHandler) RegisterRoutes(r *gin.Engine) {
	r.POST("/events", h.RecordEvent)
	r.GET("/funnel", h.CalculateFunnel)
}

func splitAndTrim(s string) []string {
	parts := strings.Split(s, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		trimmed := strings.TrimSpace(p)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
