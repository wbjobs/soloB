const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'task_scheduler',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

const initDb = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        cron_expression VARCHAR(100) NOT NULL,
        command TEXT NOT NULL,
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    await client.query(`
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
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS task_locks (
        task_id INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
        locked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        locked_by VARCHAR(100)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS task_dependencies (
        id SERIAL PRIMARY KEY,
        upstream_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        downstream_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(upstream_task_id, downstream_task_id)
      );
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_task_executions_task_id ON task_executions(task_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_task_dependencies_upstream ON task_dependencies(upstream_task_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_task_dependencies_downstream ON task_dependencies(downstream_task_id);
    `);

    console.log('Database initialized successfully');
  } finally {
    client.release();
  }
};

module.exports = { pool, initDb };
