package models

import (
	"time"
)

type MeterReading struct {
	MeterID      string    `json:"meter_id"`
	Timestamp    time.Time `json:"timestamp"`
	Voltage      float64   `json:"voltage"`
	Current      float64   `json:"current"`
	PowerFactor  float64   `json:"power_factor"`
	THD          float64   `json:"thd"`
}

type AggregatedData struct {
	MeterID           string    `json:"meter_id"`
	WindowStart       time.Time `json:"window_start"`
	WindowEnd         time.Time `json:"window_end"`
	VoltageMin        float64   `json:"voltage_min"`
	VoltageMax        float64   `json:"voltage_max"`
	VoltageMean       float64   `json:"voltage_mean"`
	VoltageStdDev     float64   `json:"voltage_std_dev"`
	VoltageFluctuation float64  `json:"voltage_fluctuation"`
	PowerFactorMean   float64   `json:"power_factor_mean"`
	SampleCount       int       `json:"sample_count"`
}

type AnomalyEvent struct {
	ID              int64     `json:"id"`
	MeterID         string    `json:"meter_id"`
	Timestamp       time.Time `json:"timestamp"`
	AnomalyScore    float64   `json:"anomaly_score"`
	AnomalyType     string    `json:"anomaly_type"`
	AffectedReading MeterReading `json:"affected_reading"`
	WebhookSent     bool      `json:"webhook_sent"`
	WebhookResponse string    `json:"webhook_response,omitempty"`
}

type Config struct {
	MQTT struct {
		Broker         string `yaml:"broker"`
		Topic          string `yaml:"topic"`
		ClientID       string `yaml:"client_id"`
		QoS            byte   `yaml:"qos"`
		CacheCapacity  int    `yaml:"cache_capacity"`
		PersistenceDir string `yaml:"persistence_dir"`
	} `yaml:"mqtt"`

	Prediction struct {
		Enabled           bool `yaml:"enabled"`
		WindowSize        int  `yaml:"window_size"`
		PredictionSteps   int  `yaml:"prediction_steps"`
		IntervalMinutes   int  `yaml:"interval_minutes"`
		HistoricalDays    int  `yaml:"historical_days"`
	} `yaml:"prediction"`

	Database struct {
		Host     string `yaml:"host"`
		Port     int    `yaml:"port"`
		User     string `yaml:"user"`
		Password string `yaml:"password"`
		DBName   string `yaml:"dbname"`
		RetentionDays int `yaml:"retention_days"`
	} `yaml:"database"`

	Aggregation struct {
		WindowMinutes int `yaml:"window_minutes"`
	} `yaml:"aggregation"`

	AnomalyDetection struct {
		Enabled        bool    `yaml:"enabled"`
		Threshold      float64 `yaml:"threshold"`
		NumTrees       int     `yaml:"num_trees"`
		SampleSize     int     `yaml:"sample_size"`
		WebhookURL     string  `yaml:"webhook_url"`
		WebhookEnabled bool    `yaml:"webhook_enabled"`
	} `yaml:"anomaly_detection"`

	API struct {
		Port int `yaml:"port"`
	} `yaml:"api"`

	Simulator struct {
		NumMeters  int `yaml:"num_meters"`
		IntervalMs int `yaml:"interval_ms"`
	} `yaml:"simulator"`
}
