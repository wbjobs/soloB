package handlers

import (
	"net/http"
	"strconv"
	"task-scheduler-backend/config"
	"task-scheduler-backend/models"
	"task-scheduler-backend/scheduler"

	"github.com/gin-gonic/gin"
)

func SubmitTask(sch *scheduler.Scheduler) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Name      string  `json:"name" binding:"required"`
			Priority  int     `json:"priority" binding:"required,min=1,max=3"`
			BurstTime float64 `json:"burst_time" binding:"required,gt=0"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		task := models.NewTask(req.Name, req.Priority, req.BurstTime)
		sch.AddTask(task)

		c.JSON(http.StatusCreated, task)
	}
}

func GetTasks(sch *scheduler.Scheduler) gin.HandlerFunc {
	return func(c *gin.Context) {
		tasks := sch.GetTasks()
		c.JSON(http.StatusOK, tasks)
	}
}

func GetTask(sch *scheduler.Scheduler) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		task, exists := sch.GetTask(id)
		if !exists {
			c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
			return
		}
		c.JSON(http.StatusOK, task)
	}
}

func DeleteTask(sch *scheduler.Scheduler) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		if !sch.DeleteTask(id) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "Task deleted successfully"})
	}
}

func GetSchedulerStatus(sch *scheduler.Scheduler) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"running": sch.IsRunning(),
			"timeline": sch.Timeline,
		})
	}
}

func StartScheduler(sch *scheduler.Scheduler) gin.HandlerFunc {
	return func(c *gin.Context) {
		sch.Start()
		c.JSON(http.StatusOK, gin.H{"message": "Scheduler started"})
	}
}

func StopScheduler(sch *scheduler.Scheduler) gin.HandlerFunc {
	return func(c *gin.Context) {
		sch.Stop()
		c.JSON(http.StatusOK, gin.H{"message": "Scheduler stopped"})
	}
}

func ResetScheduler(sch *scheduler.Scheduler) gin.HandlerFunc {
	return func(c *gin.Context) {
		sch.Reset()
		c.JSON(http.StatusOK, gin.H{"message": "Scheduler reset"})
	}
}

func GetQueues(sch *scheduler.Scheduler) gin.HandlerFunc {
	return func(c *gin.Context) {
		queues := sch.GetQueueStatus()
		c.JSON(http.StatusOK, queues)
	}
}

func UpdateQueueConfig(sch *scheduler.Scheduler) gin.HandlerFunc {
	return func(c *gin.Context) {
		var configs []models.QueueConfig
		if err := c.ShouldBindJSON(&configs); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid queue config format: " + err.Error()})
			return
		}

		for i := range configs {
			if configs[i].TimeQuantum <= 0 {
				configs[i].TimeQuantum = 1.0
			}
		}

		sch.UpdateQueueConfig(configs)
		c.JSON(http.StatusOK, gin.H{"message": "Queue configs updated", "configs": configs})
	}
}

func GetHistory() gin.HandlerFunc {
	return func(c *gin.Context) {
		rows, err := config.DB.Query(`
			SELECT id, name, priority, burst_time, waiting_time, turnaround_time, preempt_count, status, created_at, completed_at
			FROM task_history
			ORDER BY created_at DESC
		`)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()

		var history []map[string]interface{}
		for rows.Next() {
			var id, name, status string
			var priority, preemptCount int
			var burstTime, waitingTime, turnaroundTime float64
			var createdAt, completedAt *string

			err := rows.Scan(&id, &name, &priority, &burstTime, &waitingTime, &turnaroundTime, &preemptCount, &status, &createdAt, &completedAt)
			if err != nil {
				continue
			}

			history = append(history, map[string]interface{}{
				"id":               id,
				"name":             name,
				"priority":         priority,
				"burst_time":       burstTime,
				"waiting_time":     waitingTime,
				"turnaround_time":  turnaroundTime,
				"preempt_count":    preemptCount,
				"status":          status,
				"created_at":      createdAt,
				"completed_at":    completedAt,
			})
		}

		c.JSON(http.StatusOK, history)
	}
}

func GetEntropyHistory(sch *scheduler.Scheduler) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, sch.EntropyHistory)
	}
}

func GetEntropyPrediction(sch *scheduler.Scheduler) gin.HandlerFunc {
	return func(c *gin.Context) {
		numSteps := 5
		if stepsStr := c.Query("steps"); stepsStr != "" {
			if steps, err := strconv.Atoi(stepsStr); err == nil && steps > 0 && steps <= 20 {
				numSteps = steps
			}
		}

		predictions := sch.GetEntropyWithPrediction(numSteps)
		c.JSON(http.StatusOK, gin.H{
			"predictions": predictions,
			"num_steps":   numSteps,
		})
	}
}
