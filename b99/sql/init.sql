CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS sensor_data (
    device_id TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    temperature DOUBLE PRECISION NOT NULL,
    humidity DOUBLE PRECISION,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    battery INTEGER,
    is_compressed BOOLEAN DEFAULT FALSE,
    is_virtual BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT create_hypertable('sensor_data', 'timestamp', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_sensor_data_device_id ON sensor_data(device_id);
CREATE INDEX IF NOT EXISTS idx_sensor_data_device_time ON sensor_data(device_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS anomalies (
    id SERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    anomaly_type TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    description TEXT,
    severity DOUBLE PRECISION DEFAULT 1.0,
    context_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT create_hypertable('anomalies', 'start_time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_anomalies_device_id ON anomalies(device_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_type ON anomalies(anomaly_type);

CREATE TABLE IF NOT EXISTS device_status (
    device_id TEXT PRIMARY KEY,
    last_seen TIMESTAMPTZ NOT NULL,
    is_online BOOLEAN DEFAULT TRUE,
    current_temperature DOUBLE PRECISION,
    current_humidity DOUBLE PRECISION,
    current_latitude DOUBLE PRECISION,
    current_longitude DOUBLE PRECISION,
    battery INTEGER,
    data_count_24h INTEGER DEFAULT 0,
    active_anomalies INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_device_status()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO device_status (device_id, last_seen, current_temperature, current_humidity, current_latitude, current_longitude, battery, updated_at)
    VALUES (NEW.device_id, NEW.timestamp, NEW.temperature, NEW.humidity, NEW.latitude, NEW.longitude, NEW.battery, NOW())
    ON CONFLICT (device_id) DO UPDATE
    SET last_seen = NEW.timestamp,
        current_temperature = NEW.temperature,
        current_humidity = NEW.humidity,
        current_latitude = NEW.latitude,
        current_longitude = NEW.longitude,
        battery = NEW.battery,
        updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_device_status ON sensor_data;
CREATE TRIGGER trigger_update_device_status
AFTER INSERT ON sensor_data
FOR EACH ROW EXECUTE FUNCTION update_device_status();
