const express = require('express');
const { pool } = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT td.*,
             t1.name as upstream_name,
             t2.name as downstream_name
      FROM task_dependencies td
      JOIN tasks t1 ON td.upstream_task_id = t1.id
      JOIN tasks t2 ON td.downstream_task_id = t2.id
      ORDER BY td.id
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching dependencies:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/graph', async (req, res) => {
  try {
    const tasksResult = await pool.query(`
      SELECT id, name, enabled 
      FROM tasks 
      ORDER BY id
    `);
    
    const depsResult = await pool.query(`
      SELECT * FROM task_dependencies
    `);

    const nodes = tasksResult.rows.map(task => ({
      id: `task-${task.id}`,
      taskId: task.id,
      name: task.name,
      enabled: task.enabled,
    }));

    const edges = depsResult.rows.map(dep => ({
      id: `edge-${dep.id}`,
      source: `task-${dep.upstream_task_id}`,
      target: `task-${dep.downstream_task_id}`,
      animated: true,
    }));

    res.json({ nodes, edges });
  } catch (error) {
    console.error('Error fetching dependency graph:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  const { upstream_task_id, downstream_task_id } = req.body;

  if (!upstream_task_id || !downstream_task_id) {
    return res.status(400).json({ error: 'Upstream and downstream task IDs are required' });
  }

  if (parseInt(upstream_task_id) === parseInt(downstream_task_id)) {
    return res.status(400).json({ error: 'A task cannot depend on itself' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const checkCycle = await client.query(`
      WITH RECURSIVE dep_chain AS (
        SELECT upstream_task_id, downstream_task_id, 1 as depth
        FROM task_dependencies
        WHERE upstream_task_id = $1
        UNION ALL
        SELECT td.upstream_task_id, td.downstream_task_id, dc.depth + 1
        FROM task_dependencies td
        JOIN dep_chain dc ON td.upstream_task_id = dc.downstream_task_id
        WHERE dc.depth < 100
      )
      SELECT 1 FROM dep_chain WHERE downstream_task_id = $2
      LIMIT 1
    `, [downstream_task_id, upstream_task_id]);

    if (checkCycle.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This dependency would create a cycle' });
    }

    const result = await client.query(`
      INSERT INTO task_dependencies (upstream_task_id, downstream_task_id)
      VALUES ($1, $2)
      RETURNING *
    `, [upstream_task_id, downstream_task_id]);

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Dependency already exists' });
    }
    console.error('Error creating dependency:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM task_dependencies WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Dependency not found' });
    }

    res.json({ message: 'Dependency deleted successfully' });
  } catch (error) {
    console.error('Error deleting dependency:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/by-tasks', async (req, res) => {
  const { upstream_task_id, downstream_task_id } = req.query;

  if (!upstream_task_id || !downstream_task_id) {
    return res.status(400).json({ error: 'Upstream and downstream task IDs are required' });
  }

  try {
    const result = await pool.query(`
      DELETE FROM task_dependencies 
      WHERE upstream_task_id = $1 AND downstream_task_id = $2 
      RETURNING *
    `, [upstream_task_id, downstream_task_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Dependency not found' });
    }

    res.json({ message: 'Dependency deleted successfully' });
  } catch (error) {
    console.error('Error deleting dependency:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/upstream/:taskId', async (req, res) => {
  const { taskId } = req.params;
  try {
    const result = await pool.query(`
      SELECT t.*, td.id as dependency_id
      FROM tasks t
      JOIN task_dependencies td ON td.upstream_task_id = t.id
      WHERE td.downstream_task_id = $1
      ORDER BY t.id
    `, [taskId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching upstream tasks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/downstream/:taskId', async (req, res) => {
  const { taskId } = req.params;
  try {
    const result = await pool.query(`
      SELECT t.*, td.id as dependency_id
      FROM tasks t
      JOIN task_dependencies td ON td.downstream_task_id = t.id
      WHERE td.upstream_task_id = $1
      ORDER BY t.id
    `, [taskId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching downstream tasks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
