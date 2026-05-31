package database

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"iiothub/pkg/models"
)

type Database struct {
	pool *pgxpool.Pool
}

func NewDatabase(cfg *models.Config) (*Database, error) {
	connStr := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable",
		cfg.Database.User,
		cfg.Database.Password,
		cfg.Database.Host,
		cfg.Database.Port,
		cfg.Database.DBName,
	)

	poolConfig, err := pgxpool.ParseConfig(connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to parse pool config: %w", err)
	}

	poolConfig.MaxConns = 100
	poolConfig.MinConns = 10
	poolConfig.MaxConnLifetime = time.Hour
	poolConfig.MaxConnIdleTime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(context.Background(), poolConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create pool: %w", err)
	}

	if err := pool.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	db := &Database{pool: pool}

	if err := db.initSchema(cfg.Database.RetentionDays); err != nil {
		return nil, fmt.Errorf("failed to init schema: %w", err)
	}

	log.Println("Database connection established and schema initialized")
	return db, nil
}

func (db *Database) initSchema(retentionDays int) error {
	ctx := context.Background()

	createExtension := `CREATE EXTENSION IF NOT EXISTS timescaledb;`
	_, err := db.pool.Exec(ctx, createExtension)
	if err != nil {
		return fmt.Errorf("failed to create timescaledb extension: %w", err)
	}

	createMeterReadingsTable := `
	CREATE TABLE IF NOT EXISTS meter_readings (
		meter_id TEXT NOT NULL,
		timestamp TIMESTAMPTZ NOT NULL,
		voltage DOUBLE PRECISION NOT NULL,
		current DOUBLE PRECISION NOT NULL,
		power_factor DOUBLE PRECISION NOT NULL,
		thd DOUBLE PRECISION NOT NULL,
		PRIMARY KEY (meter_id, timestamp)
	);`
	_, err = db.pool.Exec(ctx, createMeterReadingsTable)
	if err != nil {
		return fmt.Errorf("failed to create meter_readings table: %w", err)
	}

	createHypertable := `
	SELECT create_hypertable('meter_readings', 'timestamp', if_not_exists => TRUE, chunk_time_interval => INTERVAL '1 day');
	`
	_, err = db.pool.Exec(ctx, createHypertable)
	if err != nil {
		log.Printf("Warning: failed to create hypertable: %v", err)
	}

	createAggregatedDataTable := `
	CREATE TABLE IF NOT EXISTS aggregated_data (
		meter_id TEXT NOT NULL,
		window_start TIMESTAMPTZ NOT NULL,
		window_end TIMESTAMPTZ NOT NULL,
		voltage_min DOUBLE PRECISION NOT NULL,
		voltage_max DOUBLE PRECISION NOT NULL,
		voltage_mean DOUBLE PRECISION NOT NULL,
		voltage_std_dev DOUBLE PRECISION NOT NULL,
		voltage_fluctuation DOUBLE PRECISION NOT NULL,
		power_factor_mean DOUBLE PRECISION NOT NULL,
		sample_count INTEGER NOT NULL,
		PRIMARY KEY (meter_id, window_start)
	);`
	_, err = db.pool.Exec(ctx, createAggregatedDataTable)
	if err != nil {
		return fmt.Errorf("failed to create aggregated_data table: %w", err)
	}

	createAggHypertable := `
	SELECT create_hypertable('aggregated_data', 'window_start', if_not_exists => TRUE, chunk_time_interval => INTERVAL '1 day');
	`
	_, err = db.pool.Exec(ctx, createAggHypertable)
	if err != nil {
		log.Printf("Warning: failed to create aggregated_data hypertable: %v", err)
	}

	createAnomalyEventsTable := `
	CREATE TABLE IF NOT EXISTS anomaly_events (
		id BIGSERIAL PRIMARY KEY,
		meter_id TEXT NOT NULL,
		timestamp TIMESTAMPTZ NOT NULL,
		anomaly_score DOUBLE PRECISION NOT NULL,
		anomaly_type TEXT NOT NULL,
		affected_reading JSONB NOT NULL,
		webhook_sent BOOLEAN NOT NULL DEFAULT FALSE,
		webhook_response TEXT
	);`
	_, err = db.pool.Exec(ctx, createAnomalyEventsTable)
	if err != nil {
		return fmt.Errorf("failed to create anomaly_events table: %w", err)
	}

	createAnomalyHypertable := `
	SELECT create_hypertable('anomaly_events', 'timestamp', if_not_exists => TRUE, chunk_time_interval => INTERVAL '7 days');
	`
	_, err = db.pool.Exec(ctx, createAnomalyHypertable)
	if err != nil {
		log.Printf("Warning: failed to create anomaly_events hypertable: %v", err)
	}

	addRetentionPolicy := fmt.Sprintf(`
	SELECT add_retention_policy('meter_readings', INTERVAL '%d days', if_not_exists => TRUE);
	SELECT add_retention_policy('aggregated_data', INTERVAL '%d days', if_not_exists => TRUE);
	SELECT add_retention_policy('anomaly_events', INTERVAL '%d days', if_not_exists => TRUE);
	`, retentionDays, retentionDays, retentionDays)
	_, err = db.pool.Exec(ctx, addRetentionPolicy)
	if err != nil {
		log.Printf("Warning: failed to add retention policy: %v", err)
	}

	createIndexes := `
	CREATE INDEX IF NOT EXISTS idx_meter_readings_meter_id ON meter_readings(meter_id, timestamp DESC);
	CREATE INDEX IF NOT EXISTS idx_aggregated_data_meter_id ON aggregated_data(meter_id, window_start DESC);
	CREATE INDEX IF NOT EXISTS idx_anomaly_events_meter_id ON anomaly_events(meter_id, timestamp DESC);
	`
	_, err = db.pool.Exec(ctx, createIndexes)
	if err != nil {
		log.Printf("Warning: failed to create indexes: %v", err)
	}

	return nil
}

func (db *Database) InsertMeterReading(ctx context.Context, reading *models.MeterReading) error {
	query := `
	INSERT INTO meter_readings (meter_id, timestamp, voltage, current, power_factor, thd)
	VALUES ($1, $2, $3, $4, $5, $6)
	ON CONFLICT (meter_id, timestamp) DO UPDATE SET
		voltage = EXCLUDED.voltage,
		current = EXCLUDED.current,
		power_factor = EXCLUDED.power_factor,
		thd = EXCLUDED.thd
	`
	_, err := db.pool.Exec(ctx, query,
		reading.MeterID,
		reading.Timestamp,
		reading.Voltage,
		reading.Current,
		reading.PowerFactor,
		reading.THD,
	)
	return err
}

func (db *Database) BatchInsertMeterReadings(ctx context.Context, readings []*models.MeterReading) error {
	if len(readings) == 0 {
		return nil
	}

	copyCount, err := db.pool.CopyFrom(
		ctx,
		pgx.Identifier{"meter_readings"},
		[]string{"meter_id", "timestamp", "voltage", "current", "power_factor", "thd"},
		pgx.CopyFromSlice(len(readings), func(i int) ([]interface{}, error) {
			return []interface{}{
				readings[i].MeterID,
				readings[i].Timestamp,
				readings[i].Voltage,
				readings[i].Current,
				readings[i].PowerFactor,
				readings[i].THD,
			}, nil
		}),
	)
	if err != nil {
		return fmt.Errorf("copy failed: %w", err)
	}
	log.Printf("Batch inserted %d rows", copyCount)
	return nil
}

func (db *Database) InsertAggregatedData(ctx context.Context, agg *models.AggregatedData) error {
	query := `
	INSERT INTO aggregated_data (
		meter_id, window_start, window_end, voltage_min, voltage_max,
		voltage_mean, voltage_std_dev, voltage_fluctuation, power_factor_mean, sample_count
	) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	ON CONFLICT (meter_id, window_start) DO UPDATE SET
		voltage_min = EXCLUDED.voltage_min,
		voltage_max = EXCLUDED.voltage_max,
		voltage_mean = EXCLUDED.voltage_mean,
		voltage_std_dev = EXCLUDED.voltage_std_dev,
		voltage_fluctuation = EXCLUDED.voltage_fluctuation,
		power_factor_mean = EXCLUDED.power_factor_mean,
		sample_count = EXCLUDED.sample_count
	`
	_, err := db.pool.Exec(ctx, query,
		agg.MeterID,
		agg.WindowStart,
		agg.WindowEnd,
		agg.VoltageMin,
		agg.VoltageMax,
		agg.VoltageMean,
		agg.VoltageStdDev,
		agg.VoltageFluctuation,
		agg.PowerFactorMean,
		agg.SampleCount,
	)
	return err
}

func (db *Database) InsertAnomalyEvent(ctx context.Context, event *models.AnomalyEvent) error {
	query := `
	INSERT INTO anomaly_events (meter_id, timestamp, anomaly_score, anomaly_type, affected_reading, webhook_sent, webhook_response)
	VALUES ($1, $2, $3, $4, $5, $6, $7)
	RETURNING id
	`
	var id int64
	err := db.pool.QueryRow(ctx, query,
		event.MeterID,
		event.Timestamp,
		event.AnomalyScore,
		event.AnomalyType,
		event.AffectedReading,
		event.WebhookSent,
		event.WebhookResponse,
	).Scan(&id)
	if err != nil {
		return err
	}
	event.ID = id
	return nil
}

func (db *Database) QueryAggregatedData(ctx context.Context, meterID string, start, end time.Time) ([]*models.AggregatedData, error) {
	query := `
	SELECT meter_id, window_start, window_end, voltage_min, voltage_max,
		   voltage_mean, voltage_std_dev, voltage_fluctuation, power_factor_mean, sample_count
	FROM aggregated_data
	WHERE meter_id = $1 AND window_start >= $2 AND window_start <= $3
	ORDER BY window_start DESC
	`
	rows, err := db.pool.Query(ctx, query, meterID, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []*models.AggregatedData
	for rows.Next() {
		agg := &models.AggregatedData{}
		err := rows.Scan(
			&agg.MeterID,
			&agg.WindowStart,
			&agg.WindowEnd,
			&agg.VoltageMin,
			&agg.VoltageMax,
			&agg.VoltageMean,
			&agg.VoltageStdDev,
			&agg.VoltageFluctuation,
			&agg.PowerFactorMean,
			&agg.SampleCount,
		)
		if err != nil {
			return nil, err
		}
		results = append(results, agg)
	}
	return results, rows.Err()
}

func (db *Database) QueryAnomalyEvents(ctx context.Context, meterID string, start, end time.Time) ([]*models.AnomalyEvent, error) {
	query := `
	SELECT id, meter_id, timestamp, anomaly_score, anomaly_type, affected_reading, webhook_sent, webhook_response
	FROM anomaly_events
	WHERE ($1 = '' OR meter_id = $1) AND timestamp >= $2 AND timestamp <= $3
	ORDER BY timestamp DESC
	LIMIT 1000
	`
	rows, err := db.pool.Query(ctx, query, meterID, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []*models.AnomalyEvent
	for rows.Next() {
		event := &models.AnomalyEvent{}
		err := rows.Scan(
			&event.ID,
			&event.MeterID,
			&event.Timestamp,
			&event.AnomalyScore,
			&event.AnomalyType,
			&event.AffectedReading,
			&event.WebhookSent,
			&event.WebhookResponse,
		)
		if err != nil {
			return nil, err
		}
		results = append(results, event)
	}
	return results, rows.Err()
}

func (db *Database) GetRecentReadings(ctx context.Context, meterID string, limit int) ([]*models.MeterReading, error) {
	query := `
	SELECT meter_id, timestamp, voltage, current, power_factor, thd
	FROM meter_readings
	WHERE meter_id = $1
	ORDER BY timestamp DESC
	LIMIT $2
	`
	rows, err := db.pool.Query(ctx, query, meterID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []*models.MeterReading
	for rows.Next() {
		reading := &models.MeterReading{}
		err := rows.Scan(
			&reading.MeterID,
			&reading.Timestamp,
			&reading.Voltage,
			&reading.Current,
			&reading.PowerFactor,
			&reading.THD,
		)
		if err != nil {
			return nil, err
		}
		results = append(results, reading)
	}
	return results, rows.Err()
}

func (db *Database) Close() {
	db.pool.Close()
}
