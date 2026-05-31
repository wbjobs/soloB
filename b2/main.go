package main

import (
	"fmt"
	"log"

	"k8s-metrics-recommender/cache"
	"k8s-metrics-recommender/collector"
	"k8s-metrics-recommender/config"
	"k8s-metrics-recommender/database"
	"k8s-metrics-recommender/handlers"

	"github.com/gin-gonic/gin"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	if err := database.Connect(&cfg.Database); err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	log.Println("Database connected successfully")

	if err := cache.Connect(&cfg.Redis); err != nil {
		log.Fatalf("Failed to connect to redis: %v", err)
	}
	log.Println("Redis connected successfully")

	metricCollector := collector.NewMetricCollector(cfg)

	hasData, err := metricCollector.HasAnyData()
	if err != nil {
		log.Fatalf("Failed to check existing data: %v", err)
	}

	if !hasData {
		log.Println("No existing metrics data found. Generating historical data for 7 days...")
		if err := metricCollector.GenerateHistoricalData(7); err != nil {
			log.Fatalf("Failed to generate historical data: %v", err)
		}
		log.Println("Historical data generated successfully")
	} else {
		log.Println("Using existing metrics data in database")
	}

	r := gin.Default()

	r.GET("/health", handlers.HealthHandler)
	r.GET("/recommend", handlers.RecommendHandler)
	r.DELETE("/cache/invalidate", handlers.InvalidateCacheHandler)

	r.PUT("/resources", handlers.UpsertResourceHandler)
	r.GET("/audit", handlers.GetAuditLogsHandler)

	addr := fmt.Sprintf(":%d", cfg.Server.Port)
	log.Printf("Server starting on %s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
