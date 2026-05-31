package storage

import (
	"context"
	"fmt"
	"time"

	influxdb2 "github.com/influxdata/influxdb-client-go/v2"
)

type InfluxDBConfig struct {
	URL    string
	Token  string
	Org    string
	Bucket string
}

type InfluxDBStorage struct {
	client influxdb2.Client
	config InfluxDBConfig
}

func NewInfluxDBStorage(config InfluxDBConfig) *InfluxDBStorage {
	client := influxdb2.NewClient(config.URL, config.Token)
	return &InfluxDBStorage{
		client: client,
		config: config,
	}
}

func (s *InfluxDBStorage) WriteTestResult(slaveID byte, fuzzType string, fuzzDesc string,
	status string, responseTime time.Duration, requestSize int, responseSize int,
	anomalyScore float64) error {

	writeAPI := s.client.WriteAPI(s.config.Org, s.config.Bucket)

	p := influxdb2.NewPointWithMeasurement("modbus_test").
		AddTag("slave_id", fmt.Sprintf("%d", slaveID)).
		AddTag("fuzz_type", fuzzType).
		AddTag("status", status).
		AddField("fuzz_desc", fuzzDesc).
		AddField("response_time_ms", float64(responseTime.Microseconds())/1000.0).
		AddField("request_size", requestSize).
		AddField("response_size", responseSize).
		AddField("anomaly_score", anomalyScore).
		SetTime(time.Now())

	writeAPI.WritePoint(p)
	writeAPI.Flush()

	return nil
}

func (s *InfluxDBStorage) WriteSlaveStatus(slaveID byte, isRunning bool, uptimeSeconds float64,
	holdingRegisters int, coils int) error {

	writeAPI := s.client.WriteAPI(s.config.Org, s.config.Bucket)

	statusStr := "stopped"
	if isRunning {
		statusStr = "running"
	}

	p := influxdb2.NewPointWithMeasurement("slave_status").
		AddTag("slave_id", fmt.Sprintf("%d", slaveID)).
		AddTag("status", statusStr).
		AddField("uptime_seconds", uptimeSeconds).
		AddField("holding_registers_count", holdingRegisters).
		AddField("coils_count", coils).
		SetTime(time.Now())

	writeAPI.WritePoint(p)
	writeAPI.Flush()

	return nil
}

func (s *InfluxDBStorage) QueryTestResults(slaveID byte, startTime time.Time, endTime time.Time) ([]map[string]interface{}, error) {
	queryAPI := s.client.QueryAPI(s.config.Org)

	query := fmt.Sprintf(`
		from(bucket:"%s")
			|> range(start: %d, stop: %d)
			|> filter(fn: (r) => r._measurement == "modbus_test")
	`, s.config.Bucket, startTime.Unix(), endTime.Unix())

	if slaveID > 0 {
		query = fmt.Sprintf(`
			from(bucket:"%s")
				|> range(start: %d, stop: %d)
				|> filter(fn: (r) => r._measurement == "modbus_test" and r.slave_id == "%d")
		`, s.config.Bucket, startTime.Unix(), endTime.Unix(), slaveID)
	}

	result, err := queryAPI.Query(context.Background(), query)
	if err != nil {
		return nil, err
	}

	results := make([]map[string]interface{}, 0)
	for result.Next() {
		if result.TableChanged() {
			results = append(results, make(map[string]interface{}))
		}
		if len(results) > 0 {
			results[len(results)-1][result.Record().Field()] = result.Record().Value()
		}
	}

	if result.Err() != nil {
		return nil, result.Err()
	}

	return results, nil
}

func (s *InfluxDBStorage) QueryStatistics(startTime time.Time, endTime time.Time) (map[string]interface{}, error) {
	queryAPI := s.client.QueryAPI(s.config.Org)

	query := fmt.Sprintf(`
		from(bucket:"%s")
			|> range(start: %d, stop: %d)
			|> filter(fn: (r) => r._measurement == "modbus_test")
			|> count()
	`, s.config.Bucket, startTime.Unix(), endTime.Unix())

	result, err := queryAPI.Query(context.Background(), query)
	if err != nil {
		return nil, err
	}

	stats := map[string]interface{}{
		"total_tests": 0,
	}

	for result.Next() {
		stats["total_tests"] = stats["total_tests"].(int) + 1
	}

	if result.Err() != nil {
		return nil, result.Err()
	}

	return stats, nil
}

func (s *InfluxDBStorage) QueryAnomalies(threshold float64, startTime time.Time, endTime time.Time) ([]map[string]interface{}, error) {
	queryAPI := s.client.QueryAPI(s.config.Org)

	query := fmt.Sprintf(`
		from(bucket:"%s")
			|> range(start: %d, stop: %d)
			|> filter(fn: (r) => r._measurement == "modbus_test" and r._field == "anomaly_score" and r._value >= %f)
	`, s.config.Bucket, startTime.Unix(), endTime.Unix(), threshold)

	result, err := queryAPI.Query(context.Background(), query)
	if err != nil {
		return nil, err
	}

	anomalies := make([]map[string]interface{}, 0)
	for result.Next() {
		anomaly := map[string]interface{}{
			"time":          result.Record().Time(),
			"anomaly_score": result.Record().Value(),
			"slave_id":      result.Record().ValueByKey("slave_id"),
		}
		anomalies = append(anomalies, anomaly)
	}

	if result.Err() != nil {
		return nil, result.Err()
	}

	return anomalies, nil
}

func (s *InfluxDBStorage) Close() {
	s.client.Close()
}

func (s *InfluxDBStorage) Ping() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ok, err := s.client.Ping(ctx)
	return ok && err == nil
}
