package database

import (
	"fmt"

	"k8s-metrics-recommender/config"
	"k8s-metrics-recommender/models"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

func Connect(cfg *config.DatabaseConfig) error {
	dsn := cfg.DSN()
	
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	DB = db

	if err := DB.AutoMigrate(&models.MetricRecord{}, &models.ResourceConfig{}, &models.AuditLog{}); err != nil {
		return fmt.Errorf("failed to migrate database: %w", err)
	}

	return nil
}
