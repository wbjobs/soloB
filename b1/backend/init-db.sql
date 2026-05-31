CREATE DATABASE task_scheduler;

\c task_scheduler;

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  cron_expression VARCHAR(100) NOT NULL,
  command TEXT NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_executions (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL,
  start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  end_time TIMESTAMP,
  stdout TEXT,
  stderr TEXT,
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS task_locks (
  task_id INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  locked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  locked_by VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_task_executions_task_id ON task_executions(task_id);

INSERT INTO tasks (name, cron_expression, command, enabled) VALUES
('示例任务 - 每小时报告', '0 * * * *', 'echo "Hourly report generated at $(date)"', TRUE),
('示例任务 - 测试失败', '* * * * *', 'echo "This will fail" && exit 1', FALSE);
