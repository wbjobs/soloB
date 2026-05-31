CREATE DATABASE IF NOT EXISTS alignment_db;

\c alignment_db;

CREATE TABLE IF NOT EXISTS alignment_tasks (
    id VARCHAR(255) PRIMARY KEY,
    task_id VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    sequence_a_length INTEGER NOT NULL,
    sequence_b_length INTEGER NOT NULL,
    final_score INTEGER NOT NULL,
    file_name_a VARCHAR(255) NOT NULL,
    file_name_b VARCHAR(255) NOT NULL,
    aligned_a TEXT NOT NULL,
    aligned_b TEXT NOT NULL,
    alignment_string TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alignment_tasks_task_id ON alignment_tasks(task_id);
CREATE INDEX IF NOT EXISTS idx_alignment_tasks_created_at ON alignment_tasks(created_at);
