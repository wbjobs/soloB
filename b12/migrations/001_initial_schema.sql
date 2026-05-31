-- DTS Platform Initial Schema

-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL,
    cron VARCHAR(100),
    dag_spec JSONB,
    payload BYTEA,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    max_retries INTEGER DEFAULT 0,
    timeout DOUBLE PRECISION DEFAULT 300,
    paused BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_run_at TIMESTAMP,
    next_run_at TIMESTAMP,
    total_runs BIGINT DEFAULT 0,
    success_runs BIGINT DEFAULT 0,
    failed_runs BIGINT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_cron ON jobs(cron);

-- DAG Executions table
CREATE TABLE IF NOT EXISTS executions (
    id VARCHAR(255) PRIMARY KEY,
    job_id VARCHAR(255) NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL,
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_executions_job_id ON executions(job_id);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_start_time ON executions(start_time);

-- Task Executions table
CREATE TABLE IF NOT EXISTS task_executions (
    id SERIAL PRIMARY KEY,
    task_id VARCHAR(255) NOT NULL,
    execution_id VARCHAR(255) NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL,
    retries INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 0,
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    error_message TEXT,
    shard_index INTEGER DEFAULT 0,
    total_shards INTEGER DEFAULT 1,
    executor_id VARCHAR(255),
    log_location VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (task_id, execution_id)
);

CREATE INDEX IF NOT EXISTS idx_task_executions_execution_id ON task_executions(execution_id);
CREATE INDEX IF NOT EXISTS idx_task_executions_status ON task_executions(status);

-- Streaming Pipelines table
CREATE TABLE IF NOT EXISTS pipelines (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    source_topic VARCHAR(255) NOT NULL,
    target_topic VARCHAR(255) NOT NULL,
    transform_spec JSONB,
    window_spec JSONB,
    exactly_once_spec JSONB,
    status VARCHAR(50) DEFAULT 'stopped',
    messages_processed BIGINT DEFAULT 0,
    messages_produced BIGINT DEFAULT 0,
    errors BIGINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_started_at TIMESTAMP,
    last_stopped_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pipelines_status ON pipelines(status);

-- Executors table
CREATE TABLE IF NOT EXISTS executors (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255),
    address VARCHAR(255),
    max_tasks INTEGER DEFAULT 10,
    supported_types TEXT[],
    current_load INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'offline',
    last_heartbeat TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_executors_status ON executors(status);

-- Alerts table
CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    level VARCHAR(20) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    job_id VARCHAR(255),
    task_id VARCHAR(255),
    executor_id VARCHAR(255),
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_level ON alerts(level);

-- Updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_jobs_updated_at ON jobs;
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_pipelines_updated_at ON pipelines;
CREATE TRIGGER update_pipelines_updated_at BEFORE UPDATE ON pipelines
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
