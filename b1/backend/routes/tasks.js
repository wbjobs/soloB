const express = require('express');
const { pool } = require('../db');
const { executeTask, stopTask, scheduleTask, unscheduleTask, runningTasks } = require('../scheduler');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, 
        (SELECT status FROM task_executions WHERE task_id = t.id ORDER BY start_time DESC LIMIT 1) as last_status,
        (SELECT start_time FROM task_executions WHERE task_id = t.id ORDER BY start_time DESC LIMIT 1) as last_run
      FROM tasks t
      ORDER BY t.created_at DESC
    `);
    
    const tasksWithRunningStatus = result.rows.map(task => {
      let effectiveStatus = task.last_status;
      let isRunning = runningTasks.has(task.id);
      
      if (isRunning && task.last_run) {
        const runTime = new Date(task.last_run).getTime();
        const now = Date.now();
        const elapsedMs = now - runTime;
        const fiveMinutesMs = 5 * 60 * 1000;
        
        if (elapsedMs > fiveMinutesMs) {
          effectiveStatus = 'timeout';
        }
      }
      
      return {
        ...task,
        is_running: isRunning && effectiveStatus !== 'timeout',
        last_status: effectiveStatus
      };
    });
    
    res.json(tasksWithRunningStatus);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  const { name, cron_expression, command } = req.body;
  
  if (!name || !cron_expression || !command) {
    return res.status(400).json({ error: 'Name, cron expression, and command are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO tasks (name, cron_expression, command) 
       VALUES ($1, $2, $3) 
       RETURNING *`,
      [name, cron_expression, command]
    );
    
    const task = result.rows[0];
    scheduleTask(task);
    
    res.status(201).json(task);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, cron_expression, command, enabled } = req.body;

  try {
    const result = await pool.query(
      `UPDATE tasks 
       SET name = COALESCE($1, name),
           cron_expression = COALESCE($2, cron_expression),
           command = COALESCE($3, command),
           enabled = COALESCE($4, enabled),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [name, cron_expression, command, enabled, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = result.rows[0];
    
    if (cron_expression !== undefined || enabled !== undefined) {
      unscheduleTask(parseInt(id));
      if (task.enabled) {
        scheduleTask(task);
      }
    }

    res.json(task);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await stopTask(parseInt(id));
    unscheduleTask(parseInt(id));
    
    const result = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/trigger', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = result.rows[0];
    const execution = await executeTask(task, true);

    if (!execution) {
      return res.status(409).json({ error: 'Task is already running or locked' });
    }

    res.json(execution);
  } catch (error) {
    console.error('Error triggering task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/stop', async (req, res) => {
  const { id } = req.params;
  const result = await stopTask(parseInt(id));
  res.json(result);
});

router.get('/:id/executions', async (req, res) => {
  const { id } = req.params;
  const { page = 1, pageSize = 20 } = req.query;
  const limit = parseInt(pageSize);
  const offset = (parseInt(page) - 1) * limit;

  try {
    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM task_executions WHERE task_id = $1',
      [id]
    );
    const total = parseInt(countResult.rows[0].total);

    const result = await pool.query(
      `SELECT * FROM task_executions 
       WHERE task_id = $1 
       ORDER BY start_time DESC 
       LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );

    res.json({
      data: result.rows,
      pagination: {
        page: parseInt(page),
        pageSize: limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching executions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/executions/stats', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT id, duration_ms, start_time, status
       FROM task_executions 
       WHERE task_id = $1 AND status IN ('success', 'failed', 'timeout', 'stopped')
       ORDER BY start_time DESC 
       LIMIT 10`,
      [id]
    );
    res.json(result.rows.reverse());
  } catch (error) {
    console.error('Error fetching execution stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
