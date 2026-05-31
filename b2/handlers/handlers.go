package handlers

import (
	"log"
	"net/http"
	"strings"

	"k8s-metrics-recommender/cache"
	"k8s-metrics-recommender/database"
	"k8s-metrics-recommender/models"
	"k8s-metrics-recommender/recommender"
	"k8s-metrics-recommender/utils"

	"github.com/gin-gonic/gin"
)

type RecommendRequest struct {
	Namespace    string `form:"namespace" json:"namespace" binding:"required"`
	Workload     string `form:"workload" json:"workload" binding:"required"`
	WorkloadType string `form:"workload_type" json:"workload_type" binding:"required"`
}

type InvalidateCacheRequest struct {
	Namespace    string `form:"namespace" json:"namespace"`
	Workload     string `form:"workload" json:"workload"`
	WorkloadType string `form:"workload_type" json:"workload_type"`
	All          bool   `form:"all" json:"all"`
}

type UpsertResourceRequest struct {
	ClusterName    string  `json:"cluster_name" binding:"required"`
	Namespace      string  `json:"namespace" binding:"required"`
	WorkloadName   string  `json:"workload_name" binding:"required"`
	WorkloadType   string  `json:"workload_type" binding:"required"`
	CPURequest     float64 `json:"cpu_request_cores" binding:"required,min=0"`
	CPULimit       float64 `json:"cpu_limit_cores" binding:"required,min=0"`
	MemoryRequest  uint64  `json:"memory_request_bytes" binding:"required,min=0"`
	MemoryLimit    uint64  `json:"memory_limit_bytes" binding:"required,min=0"`
	Operator       string  `json:"operator"`
}

type AuditQueryRequest struct {
	ClusterName string `form:"cluster_name" json:"cluster_name"`
	Page        int    `form:"page" json:"page"`
	PageSize    int    `form:"page_size" json:"page_size"`
}

func RecommendHandler(c *gin.Context) {
	var req RecommendRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "missing required parameters: namespace, workload, workload_type",
		})
		return
	}

	var wlType models.WorkloadType
	switch req.WorkloadType {
	case "deploy", "deployment", "Deployment":
		wlType = models.Deployment
	case "statefulset", "StatefulSet", "statefulsets":
		wlType = models.StatefulSet
	default:
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "invalid workload_type, must be 'deploy' or 'statefulset'",
		})
		return
	}

	ctx := c.Request.Context()
	cachedResult, found, err := cache.GetRecommendation(ctx, req.Namespace, req.Workload, wlType)
	if err != nil {
		log.Printf("Cache read error: %v", err)
	}
	if found {
		c.JSON(http.StatusOK, cachedResult)
		return
	}

	rec := recommender.NewRecommender()
	result, err := rec.GetRecommendation(req.Namespace, req.Workload, wlType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	if err := cache.SetRecommendation(ctx, req.Namespace, req.Workload, wlType, result); err != nil {
		log.Printf("Cache write error: %v", err)
	}

	c.JSON(http.StatusOK, result)
}

func InvalidateCacheHandler(c *gin.Context) {
	var req InvalidateCacheRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	ctx := c.Request.Context()

	if req.All {
		if err := cache.InvalidateAll(ctx); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "all cache invalidated",
		})
		return
	}

	if req.Namespace == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "namespace is required when 'all' is not set",
		})
		return
	}

	if req.Workload == "" && req.WorkloadType == "" {
		if err := cache.InvalidateNamespace(ctx, req.Namespace); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "namespace cache invalidated",
		})
		return
	}

	if req.Workload == "" || req.WorkloadType == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "both workload and workload_type are required for specific workload invalidation",
		})
		return
	}

	var wlType models.WorkloadType
	switch req.WorkloadType {
	case "deploy", "deployment", "Deployment":
		wlType = models.Deployment
	case "statefulset", "StatefulSet", "statefulsets":
		wlType = models.StatefulSet
	default:
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "invalid workload_type, must be 'deploy' or 'statefulset'",
		})
		return
	}

	if err := cache.InvalidateRecommendation(ctx, req.Namespace, req.Workload, wlType); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "workload cache invalidated",
	})
}

func UpsertResourceHandler(c *gin.Context) {
	var req UpsertResourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	var wlType models.WorkloadType
	switch strings.ToLower(req.WorkloadType) {
	case "deploy", "deployment":
		wlType = models.Deployment
	case "statefulset", "statefulsets":
		wlType = models.StatefulSet
	default:
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "invalid workload_type, must be 'deploy' or 'statefulset'",
		})
		return
	}

	if req.CPULimit < req.CPURequest {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "cpu_limit_cores cannot be less than cpu_request_cores",
		})
		return
	}

	if req.MemoryLimit < req.MemoryRequest {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "memory_limit_bytes cannot be less than memory_request_bytes",
		})
		return
	}

	db := database.DB
	tx := db.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": tx.Error.Error(),
		})
		return
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	var existingConfig models.ResourceConfig
	err := tx.Where(
		"cluster_name = ? AND namespace = ? AND workload_name = ? AND workload_type = ?",
		req.ClusterName, req.Namespace, req.WorkloadName, wlType,
	).First(&existingConfig).Error

	action := "create"
	var oldConfig *models.ResourceConfig

	if err == nil {
		action = "update"
		oldConfig = &models.ResourceConfig{
			ClusterName:   existingConfig.ClusterName,
			Namespace:     existingConfig.Namespace,
			WorkloadName:  existingConfig.WorkloadName,
			WorkloadType:  existingConfig.WorkloadType,
			CPURequest:    existingConfig.CPURequest,
			CPULimit:      existingConfig.CPULimit,
			MemoryRequest: existingConfig.MemoryRequest,
			MemoryLimit:   existingConfig.MemoryLimit,
		}

		existingConfig.CPURequest = req.CPURequest
		existingConfig.CPULimit = req.CPULimit
		existingConfig.MemoryRequest = req.MemoryRequest
		existingConfig.MemoryLimit = req.MemoryLimit

		if err := tx.Save(&existingConfig).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
	} else {
		newConfig := models.ResourceConfig{
			ClusterName:   req.ClusterName,
			Namespace:     req.Namespace,
			WorkloadName:  req.WorkloadName,
			WorkloadType:  wlType,
			CPURequest:    req.CPURequest,
			CPULimit:      req.CPULimit,
			MemoryRequest: req.MemoryRequest,
			MemoryLimit:   req.MemoryLimit,
		}

		if err := tx.Create(&newConfig).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
		existingConfig = newConfig
	}

	newConfig := &models.ResourceConfig{
		ClusterName:   existingConfig.ClusterName,
		Namespace:     existingConfig.Namespace,
		WorkloadName:  existingConfig.WorkloadName,
		WorkloadType:  existingConfig.WorkloadType,
		CPURequest:    existingConfig.CPURequest,
		CPULimit:      existingConfig.CPULimit,
		MemoryRequest: existingConfig.MemoryRequest,
		MemoryLimit:   existingConfig.MemoryLimit,
	}

	var diffs []utils.DiffItem
	var diffJSON, oldJSON, newJSON string

	if oldConfig != nil {
		diffs, err = utils.CalculateDiff(oldConfig, newConfig)
		if err != nil {
			log.Printf("Diff calculation error: %v", err)
		}
		oldJSON = utils.ToJSON(oldConfig)
	}

	diffJSON = utils.DiffToJSON(diffs)
	newJSON = utils.ToJSON(newConfig)

	operator := req.Operator
	if operator == "" {
		operator = "api"
	}

	auditLog := models.AuditLog{
		ClusterName:  req.ClusterName,
		Namespace:    req.Namespace,
		WorkloadName: req.WorkloadName,
		WorkloadType: wlType,
		Action:       action,
		OldValue:     oldJSON,
		NewValue:     newJSON,
		Diff:         diffJSON,
		Operator:     operator,
	}

	if err := tx.Create(&auditLog).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"action":  action,
		"data":    existingConfig,
	})
}

func GetAuditLogsHandler(c *gin.Context) {
	var req AuditQueryRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	page := req.Page
	if page <= 0 {
		page = 1
	}

	pageSize := req.PageSize
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}

	offset := (page - 1) * pageSize

	db := database.DB
	query := db.Model(&models.AuditLog{})

	if req.ClusterName != "" {
		query = query.Where("cluster_name = ?", req.ClusterName)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	var logs []*models.AuditLog
	err := query.Order("created_at DESC").Offset(offset).Limit(pageSize).Find(&logs).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	totalPages := int(total) / pageSize
	if int(total)%pageSize != 0 {
		totalPages++
	}
	if totalPages == 0 && total > 0 {
		totalPages = 1
	}

	c.JSON(http.StatusOK, gin.H{
		"success":     true,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": totalPages,
		"data":        logs,
	})
}

func HealthHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
	})
}
