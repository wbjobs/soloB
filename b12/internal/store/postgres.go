package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"dtsplatform/internal/config"
	"dtsplatform/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(cfg *config.Config) (*PostgresStore, error) {
	pool, err := pgxpool.New(context.Background(), cfg.Database.DSN())
	if err != nil {
		return nil, fmt.Errorf("failed to create postgres pool: %w", err)
	}

	if err := pool.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("failed to ping postgres: %w", err)
	}

	return &PostgresStore{pool: pool}, nil
}

func (s *PostgresStore) Close() {
	if s.pool != nil {
		s.pool.Close()
	}
}

func (s *PostgresStore) CreateJob(ctx context.Context, job *models.Job) error {
	dagData, _ := json.Marshal(job.DAG)
	payloadData := job.Payload

	query := `
		INSERT INTO jobs (id, name, description, type, cron, dag_spec, payload, status, max_retries, timeout, paused)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`
	_, err := s.pool.Exec(ctx, query,
		job.ID, job.Name, job.Description, job.Type, job.Cron,
		dagData, payloadData, job.Status, job.MaxRetries,
		job.Timeout.Seconds(), job.Paused,
	)
	return err
}

func (s *PostgresStore) GetJob(ctx context.Context, jobID string) (*models.Job, error) {
	query := `
		SELECT id, name, description, type, cron, dag_spec, payload, status,
		       max_retries, timeout, paused, created_at, updated_at,
		       last_run_at, next_run_at, total_runs, success_runs, failed_runs
		FROM jobs WHERE id = $1
	`

	var job models.Job
	var dagData []byte
	var payloadData []byte
	var timeoutSecs float64

	err := s.pool.QueryRow(ctx, query, jobID).Scan(
		&job.ID, &job.Name, &job.Description, &job.Type, &job.Cron,
		&dagData, &payloadData, &job.Status, &job.MaxRetries,
		&timeoutSecs, &job.Paused, &job.CreatedAt, &job.UpdatedAt,
		&job.LastRunAt, &job.NextRunAt, &job.TotalRuns, &job.SuccessRuns, &job.FailedRuns,
	)

	if err != nil {
		return nil, err
	}

	job.Timeout = time.Duration(timeoutSecs) * time.Second
	job.Payload = payloadData
	json.Unmarshal(dagData, &job.DAG)

	return &job, nil
}

func (s *PostgresStore) ListJobs(ctx context.Context) ([]models.Job, error) {
	query := `
		SELECT id, name, description, type, cron, dag_spec, payload, status,
		       max_retries, timeout, paused, created_at, updated_at,
		       last_run_at, next_run_at, total_runs, success_runs, failed_runs
		FROM jobs ORDER BY created_at DESC
	`

	rows, err := s.pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []models.Job
	for rows.Next() {
		var job models.Job
		var dagData []byte
		var payloadData []byte
		var timeoutSecs float64

		err := rows.Scan(
			&job.ID, &job.Name, &job.Description, &job.Type, &job.Cron,
			&dagData, &payloadData, &job.Status, &job.MaxRetries,
			&timeoutSecs, &job.Paused, &job.CreatedAt, &job.UpdatedAt,
			&job.LastRunAt, &job.NextRunAt, &job.TotalRuns, &job.SuccessRuns, &job.FailedRuns,
		)
		if err != nil {
			return nil, err
		}

		job.Timeout = time.Duration(timeoutSecs) * time.Second
		job.Payload = payloadData
		json.Unmarshal(dagData, &job.DAG)
		jobs = append(jobs, job)
	}

	return jobs, nil
}

func (s *PostgresStore) UpdateJob(ctx context.Context, job *models.Job) error {
	dagData, _ := json.Marshal(job.DAG)
	query := `
		UPDATE jobs SET
			name = $2, description = $3, type = $4, cron = $5,
			dag_spec = $6, payload = $7, status = $8, max_retries = $9,
			timeout = $10, paused = $11, updated_at = NOW()
		WHERE id = $1
	`
	_, err := s.pool.Exec(ctx, query,
		job.ID, job.Name, job.Description, job.Type, job.Cron,
		dagData, job.Payload, job.Status, job.MaxRetries,
		job.Timeout.Seconds(), job.Paused,
	)
	return err
}

func (s *PostgresStore) DeleteJob(ctx context.Context, jobID string) error {
	query := `DELETE FROM jobs WHERE id = $1`
	_, err := s.pool.Exec(ctx, query, jobID)
	return err
}

func (s *PostgresStore) CreateExecution(ctx context.Context, exec *models.DAGExecution) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	query := `
		INSERT INTO executions (id, job_id, status, start_time)
		VALUES ($1, $2, $3, $4)
	`
	_, err = tx.Exec(ctx, query, exec.ExecutionID, exec.JobID, exec.Status, exec.StartTime)
	if err != nil {
		return err
	}

	for _, task := range exec.Tasks {
		err = s.createTaskExecutionTx(ctx, tx, exec.ExecutionID, &task)
		if err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func (s *PostgresStore) createTaskExecutionTx(ctx context.Context, tx pgx.Tx, execID string, task *models.TaskExecution) error {
	query := `
		INSERT INTO task_executions 
		(task_id, execution_id, status, retries, max_retries, shard_index, total_shards, executor_id, log_location)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`
	_, err := tx.Exec(ctx, query,
		task.TaskID, execID, task.Status, task.Retries, task.MaxRetries,
		task.ShardIndex, task.TotalShards, task.ExecutorID, task.LogLocation,
	)
	return err
}

func (s *PostgresStore) UpdateTaskExecution(ctx context.Context, taskID, execID string, task *models.TaskExecution) error {
	query := `
		UPDATE task_executions SET
			status = $1, retries = $2, start_time = $3,
			end_time = $4, error_message = $5, executor_id = $6, log_location = $7
		WHERE task_id = $8 AND execution_id = $9
	`
	_, err := s.pool.Exec(ctx, query,
		task.Status, task.Retries, task.StartTime,
		task.EndTime, task.ErrorMessage, task.ExecutorID, task.LogLocation,
		taskID, execID,
	)
	return err
}

func (s *PostgresStore) GetExecutionsByJob(ctx context.Context, jobID string, limit int) ([]models.DAGExecution, error) {
	query := `
		SELECT id, job_id, status, start_time, end_time
		FROM executions WHERE job_id = $1 ORDER BY start_time DESC LIMIT $2
	`
	rows, err := s.pool.Query(ctx, query, jobID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var execs []models.DAGExecution
	for rows.Next() {
		var exec models.DAGExecution
		err := rows.Scan(&exec.ExecutionID, &exec.JobID, &exec.Status, &exec.StartTime, &exec.EndTime)
		if err != nil {
			return nil, err
		}
		execs = append(execs, exec)
	}

	return execs, nil
}
