package main

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"modbus-fuzzer/api"
	"modbus-fuzzer/anomaly"
	"modbus-fuzzer/detector"
	"modbus-fuzzer/fuzzer"
	"modbus-fuzzer/slave"
	"modbus-fuzzer/storage"
)

type Config struct {
	APIPort       string
	Slave1Port    int
	Slave2Port    int
	DetectorTimeout int
	InfluxDBURL   string
	InfluxDBToken string
	InfluxDBOrg   string
	InfluxDBBucket string
	EnableInfluxDB bool
}

func loadConfig() *Config {
	return &Config{
		APIPort:        ":8080",
		Slave1Port:     5020,
		Slave2Port:     5021,
		DetectorTimeout: 5,
		InfluxDBURL:    "http://localhost:8086",
		InfluxDBToken:  "your-token-here",
		InfluxDBOrg:    "modbus",
		InfluxDBBucket: "fuzzer",
		EnableInfluxDB: false,
	}
}

func main() {
	config := loadConfig()

	fmt.Println("========================================")
	fmt.Println("Modbus/TCP Fuzzer")
	fmt.Println("========================================")
	fmt.Println()

	slaveManager := slave.NewSlaveManager()
	fmt.Println("✓ Slave Manager initialized")

	master := fuzzer.NewModbusMaster()
	fmt.Println("✓ Modbus Master initialized")

	det := detector.NewDetector(config.DetectorTimeout)
	fmt.Println("✓ Response Detector initialized")

	isolationForest := anomaly.NewIsolationForest(10, 256)
	fmt.Println("✓ Isolation Forest initialized")

	var influxStorage *storage.InfluxDBStorage
	if config.EnableInfluxDB {
		influxConfig := storage.InfluxDBConfig{
			URL:    config.InfluxDBURL,
			Token:  config.InfluxDBToken,
			Org:    config.InfluxDBOrg,
			Bucket: config.InfluxDBBucket,
		}
		influxStorage = storage.NewInfluxDBStorage(influxConfig)
		fmt.Println("✓ InfluxDB Storage initialized")
	} else {
		fmt.Println("ℹ InfluxDB Storage disabled")
	}

	err := slaveManager.AddSlave(1, 100, 100)
	if err != nil {
		log.Printf("Failed to add slave 1: %v", err)
	} else {
		det.AddSlave(1, fmt.Sprintf("localhost:%d", config.Slave1Port))
	}

	err = slaveManager.AddSlave(2, 100, 100)
	if err != nil {
		log.Printf("Failed to add slave 2: %v", err)
	} else {
		det.AddSlave(2, fmt.Sprintf("localhost:%d", config.Slave2Port))
	}

	apiServer := api.NewAPIServer(slaveManager, det, master, isolationForest, influxStorage)
	fmt.Println("✓ API Server initialized")

	fmt.Println()
	fmt.Println("Starting slaves...")
	err = slaveManager.StartSlave(1, config.Slave1Port)
	if err != nil {
		log.Printf("Failed to start slave 1: %v", err)
	} else {
		fmt.Printf("✓ Slave 1 started on port %d\n", config.Slave1Port)
	}

	err = slaveManager.StartSlave(2, config.Slave2Port)
	if err != nil {
		log.Printf("Failed to start slave 2: %v", err)
	} else {
		fmt.Printf("✓ Slave 2 started on port %d\n", config.Slave2Port)
	}

	fmt.Println()
	fmt.Println("========================================")
	fmt.Printf("API Server running on http://localhost%s\n", config.APIPort)
	fmt.Println("========================================")
	fmt.Println()
	fmt.Println("Available endpoints:")
	fmt.Println("  GET  /api/v1/slaves - List all slaves")
	fmt.Println("  POST /api/v1/slaves - Add a new slave")
	fmt.Println("  POST /api/v1/slaves/:id/start - Start slave")
	fmt.Println("  POST /api/v1/slaves/:id/stop - Stop slave")
	fmt.Println()
	fmt.Println("  POST /api/v1/fuzz/start - Start fuzzing")
	fmt.Println("  POST /api/v1/fuzz/stop - Stop fuzzing")
	fmt.Println("  POST /api/v1/fuzz/single - Single fuzz test")
	fmt.Println()
	fmt.Println("  GET  /api/v1/results - Get test results")
	fmt.Println("  GET  /api/v1/results/statistics - Get statistics")
	fmt.Println("  GET  /api/v1/results/anomalies - Get anomalies")
	fmt.Println()
	fmt.Println("  POST /api/v1/anomaly/train - Train anomaly model")
	fmt.Println("  GET  /api/v1/anomaly/report - Get anomaly report")
	fmt.Println()
	fmt.Println("Press Ctrl+C to exit")
	fmt.Println()

	go func() {
		if err := apiServer.Run(config.APIPort); err != nil {
			log.Fatalf("Failed to start API server: %v", err)
		}
	}()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	fmt.Println()
	fmt.Println("Shutting down...")
	slaveManager.StopAll()
	if influxStorage != nil {
		influxStorage.Close()
	}
	fmt.Println("Goodbye!")
}
