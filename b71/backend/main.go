package main

import (
	"log"
	"net/http"
	"task-scheduler-backend/config"
	"task-scheduler-backend/handlers"
	"task-scheduler-backend/scheduler"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	config.InitRedis()
	config.InitSQLite()

	sch := scheduler.NewScheduler()
	sch.Start()

	router := gin.Default()

	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:3000"},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Content-Type"},
		AllowCredentials: true,
	}))

	api := router.Group("/api")
	{
		api.POST("/tasks", handlers.SubmitTask(sch))
		api.GET("/tasks", handlers.GetTasks(sch))
		api.GET("/tasks/:id", handlers.GetTask(sch))
		api.DELETE("/tasks/:id", handlers.DeleteTask(sch))

		api.GET("/scheduler/status", handlers.GetSchedulerStatus(sch))
		api.POST("/scheduler/start", handlers.StartScheduler(sch))
		api.POST("/scheduler/stop", handlers.StopScheduler(sch))
		api.POST("/scheduler/reset", handlers.ResetScheduler(sch))

		api.GET("/scheduler/queues", handlers.GetQueues(sch))
		api.PUT("/scheduler/queues", handlers.UpdateQueueConfig(sch))

		api.GET("/history", handlers.GetHistory())
		api.GET("/scheduler/entropy", handlers.GetEntropyHistory(sch))
		api.GET("/scheduler/entropy/prediction", handlers.GetEntropyPrediction(sch))
	}

	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	log.Println("Server starting on :8080")
	if err := router.Run(":8080"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
