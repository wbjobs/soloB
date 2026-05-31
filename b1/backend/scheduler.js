const cron = require('node-cron');
const { exec } = require('child_process');
const { pool } = require('./db');

const runningTasks = new Map();
const cronJobs = new Map();
const TASK_TIMEOUT_MS = 5 * 60 * 1000;

const acquireLock = async (taskId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingLock = await client.query(
      'SELECT * FROM task_locks WHERE task_id = $1 FOR UPDATE',
      [taskId]
    );
    
    if (existingLock.rows.length > 0) {
      await client.query('ROLLBACK');
      return false;
    }
    
    await client.query(
      'INSERT INTO task_locks (task_id, locked_by) VALUES ($1, $2)',
      [taskId, process.pid.toString()]
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error acquiring lock:', error);
    return false;
  } finally {
    client.release();
  }
};

const releaseLock = async (taskId) => {
  try {
    await pool.query('DELETE FROM task_locks WHERE task_id = $1', [taskId]);
  } catch (error) {
    console.error('Error releasing lock:', error);
  }
};

const isTimeoutError = (error) => {
  if (!error) return false;
  if (error.killed) return true;
  if (error.code === 'ETIMEDOUT') return true;
  if (error.signal === 'SIGTERM') return true;
  return false;
};

const cleanupTimeoutExecutions = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const result = await client.query(`
      SELECT * FROM task_executions 
      WHERE status = 'running' 
        AND start_time < CURRENT_TIMESTAMP - INTERVAL '5 minutes'
      FOR UPDATE SKIP LOCKED
    `);

    for (const exec of result.rows) {
      await client.query(
        `UPDATE task_executions 
         SET status = 'timeout', 
             end_time = CURRENT_TIMESTAMP,
             stderr = COALESCE(stderr, '') || '\n[系统] 任务执行超时（超过5分钟）'
         WHERE id = $1`,
        [exec.id]
      );

      await client.query(
        'DELETE FROM task_locks WHERE task_id = $1',
        [exec.task_id]
      );

      if (runningTasks.has(exec.task_id)) {
        runningTasks.delete(exec.task_id);
      }

      console.log(`Execution ${exec.id} for task ${exec.task_id} marked as timeout`);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error cleaning up timeout executions:', error);
  } finally {
    client.release();
  }
};

const executeTask = async (task, manual = false) => {
  if (runningTasks.has(task.id)) {
    console.log(`Task ${task.id} is already running, skipping...`);
    return null;
  }

  const lockAcquired = await acquireLock(task.id);
  if (!lockAcquired) {
    console.log(`Task ${task.id} is locked by another process, skipping...`);
    return null;
  }

  const executionResult = await pool.query(
    'INSERT INTO task_executions (task_id, status) VALUES ($1, $2) RETURNING *',
    [task.id, 'running']
  );
  const execution = executionResult.rows[0];
  
  runningTasks.set(task.id, execution.id);

  return new Promise((resolve) => {
    const startTime = Date.now();
    
    exec(task.command, { timeout: TASK_TIMEOUT_MS, killSignal: 'SIGTERM' }, async (error, stdout, stderr) => {
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      let status = 'success';
      let finalStderr = stderr;
      
      if (error) {
        if (isTimeoutError(error)) {
          status = 'timeout';
          finalStderr = (stderr || '') + '\n[系统] 任务执行超时（超过5分钟）';
        } else {
          status = 'failed';
        }
      }

      await pool.query(
        `UPDATE task_executions 
         SET status = $1, end_time = CURRENT_TIMESTAMP, stdout = $2, stderr = $3, duration_ms = $4 
         WHERE id = $5`,
        [status, stdout, finalStderr, duration, execution.id]
      );

      runningTasks.delete(task.id);
      await releaseLock(task.id);

      triggerDependentTasks(task.id, status).catch(err => {
        console.error('Error triggering dependent tasks:', err);
      });

      resolve({ ...execution, status, stdout, stderr: finalStderr, duration_ms: duration });
    });
  });
};

const stopTask = async (taskId) => {
  const executionId = runningTasks.get(taskId);
  if (!executionId) {
    return { success: false, message: 'Task is not running' };
  }

  await pool.query(
    `UPDATE task_executions 
     SET status = 'stopped', end_time = CURRENT_TIMESTAMP 
     WHERE id = $1`,
    [executionId]
  );

  runningTasks.delete(taskId);
  await releaseLock(taskId);

  return { success: true, message: 'Task stopped successfully' };
};

const scheduleTask = (task) => {
  if (cronJobs.has(task.id)) {
    cronJobs.get(task.id).stop();
  }

  if (!task.enabled) return;

  try {
    const job = cron.schedule(task.cron_expression, async () => {
      const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [task.id]);
      const currentTask = result.rows[0];
      
      if (currentTask && currentTask.enabled) {
        await executeTask(currentTask);
      }
    });
    
    cronJobs.set(task.id, job);
    console.log(`Task ${task.id} scheduled with cron: ${task.cron_expression}`);
  } catch (error) {
    console.error(`Failed to schedule task ${task.id}:`, error);
  }
};

const unscheduleTask = (taskId) => {
  if (cronJobs.has(taskId)) {
    cronJobs.get(taskId).stop();
    cronJobs.delete(taskId);
    console.log(`Task ${taskId} unscheduled`);
  }
};

let timeoutCleanupInterval = null;

const initScheduler = async () => {
  await cleanupTimeoutExecutions();
  
  const result = await pool.query('SELECT * FROM tasks WHERE enabled = TRUE');
  const tasks = result.rows;
  
  tasks.forEach(task => scheduleTask(task));
  console.log(`Scheduler initialized with ${tasks.length} enabled tasks`);
  
  if (!timeoutCleanupInterval) {
    timeoutCleanupInterval = setInterval(cleanupTimeoutExecutions, 30000);
    console.log('Timeout cleanup monitor started');
  }
};

const getDownstreamTasks = async (taskId) => {
  const result = await pool.query(`
    SELECT t.* 
    FROM tasks t
    JOIN task_dependencies td ON td.downstream_task_id = t.id
    WHERE td.upstream_task_id = $1
      AND t.enabled = TRUE
  `, [taskId]);
  return result.rows;
};

const triggerDependentTasks = async (upstreamTaskId, executionStatus) => {
  if (executionStatus !== 'success') {
    console.log(`Task ${upstreamTaskId} completed with status ${executionStatus}, skipping downstream triggers`);
    return;
  }

  const downstreamTasks = await getDownstreamTasks(upstreamTaskId);
  console.log(`Task ${upstreamTaskId} succeeded, triggering ${downstreamTasks.length} dependent tasks`);

  for (const task of downstreamTasks) {
    const result = await executeTask(task);
    if (result) {
      console.log(`Triggered dependent task ${task.id}`);
    } else {
      console.log(`Dependent task ${task.id} is already running or locked`);
    }
  }
};

const getRunningTasks = () => runningTasks;

module.exports = {
  executeTask,
  stopTask,
  scheduleTask,
  unscheduleTask,
  initScheduler,
  runningTasks,
  getRunningTasks,
  TASK_TIMEOUT_MS,
  getDownstreamTasks,
  triggerDependentTasks
};
