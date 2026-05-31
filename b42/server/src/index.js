require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const redisListener = require('./redisListener');
const influxDB = require('./influxdb');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const workers = new Map();
const activeTasks = new Map();
const taskHistory = [];
const MAX_HISTORY = 1000;
const WORKER_TIMEOUT = 30000;

function getSystemStats() {
  const stats = {
    workers: {
      total: workers.size,
      online: 0,
      busy: 0,
      idle: 0,
      offline: 0
    },
    tasks: {
      pending: 0,
      started: 0,
      success: 0,
      failure: 0,
      active: activeTasks.size
    }
  };

  const now = Date.now();
  workers.forEach((worker) => {
    if (now - worker.lastSeen > WORKER_TIMEOUT) {
      worker.status = 'offline';
    }

    if (worker.status === 'online') {
      stats.workers.online++;
      if (worker.isBusy) {
        stats.workers.busy++;
      } else {
        stats.workers.idle++;
      }
    } else if (worker.status === 'offline') {
      stats.workers.offline++;
    }
  });

  taskHistory.forEach(task => {
    if (task.status === 'PENDING') stats.tasks.pending++;
    else if (task.status === 'STARTED') stats.tasks.started++;
    else if (task.status === 'SUCCESS') stats.tasks.success++;
    else if (task.status === 'FAILURE') stats.tasks.failure++;
  });

  return stats;
}

function getWorkersData() {
  const now = Date.now();
  const workersData = [];
  workers.forEach((worker, id) => {
    const isOffline = now - worker.lastSeen > WORKER_TIMEOUT;
    workersData.push({
      id,
      name: worker.name || id,
      queue: worker.queue || 'default',
      status: isOffline ? 'offline' : worker.status,
      isBusy: worker.isBusy,
      currentTask: worker.currentTask,
      processedTasks: worker.processedTasks || 0,
      failedTasks: worker.failedTasks || 0,
      lastSeen: worker.lastSeen
    });
  });
  return workersData;
}

function getTaskFlows() {
  const flows = [];
  const flowMap = new Map();

  taskHistory.forEach(task => {
    if (task.workerId) {
      const fromWorker = task.queuedBy || 'scheduler';
      const toWorker = task.workerId;
      const key = `${fromWorker}->${toWorker}`;
      if (!flowMap.has(key)) {
        flowMap.set(key, { source: fromWorker, target: toWorker, count: 0 });
      }
      flowMap.get(key).count++;
    }
  });

  flowMap.forEach(flow => flows.push(flow));
  return flows;
}

io.on('connection', (socket) => {
  console.log('[Socket.IO] Client connected:', socket.id);

  const initialData = {
    workers: getWorkersData(),
    taskFlows: getTaskFlows(),
    recentTasks: taskHistory.slice(-50),
    stats: getSystemStats()
  };

  console.log('[Socket.IO] Sending initial data to', socket.id);
  console.log('[Socket.IO] Workers:', initialData.workers.length);
  console.log('[Socket.IO] Task flows:', initialData.taskFlows.length);

  socket.emit('initial-data', initialData);

  socket.on('disconnect', () => {
    console.log('[Socket.IO] Client disconnected:', socket.id);
  });
});

function broadcastUpdate() {
  const data = {
    workers: getWorkersData(),
    taskFlows: getTaskFlows(),
    stats: getSystemStats()
  };

  console.log('[Socket.IO] Broadcasting update:', {
    workers: data.workers.length,
    taskFlows: data.taskFlows.length,
    stats: data.stats
  });

  io.emit('update', data);
}

function broadcastTaskEvent(event) {
  console.log('[Socket.IO] Broadcasting task event:', event.status, event.taskId);
  io.emit('task-event', event);
}

console.log('[Event] Registering event handler with redisListener');
redisListener.onEvent((event) => {
  const eventType = event.type || event.status;
  const now = Date.now();

  console.log('[Event] Processing event:', eventType);

  if (eventType === 'worker-online' || eventType === 'worker-heartbeat') {
    const workerId = event.workerId;
    if (!workerId) {
      console.warn('[Event] Missing workerId, skipping');
      return;
    }

    const existingWorker = workers.get(workerId);
    
    const newWorker = {
      id: workerId,
      name: event.workerName || existingWorker?.name || workerId,
      queue: event.queue || existingWorker?.queue || 'default',
      status: 'online',
      isBusy: existingWorker?.isBusy || false,
      currentTask: existingWorker?.currentTask || null,
      processedTasks: existingWorker?.processedTasks || 0,
      failedTasks: existingWorker?.failedTasks || 0,
      lastSeen: now
    };

    workers.set(workerId, newWorker);
    console.log('[Event] Worker updated:', workerId, '-', newWorker.name, 'status=online');

    influxDB.writeWorkerEvent({
      workerId,
      status: 'online',
      queue: event.queue
    });

    broadcastUpdate();
    return;
  }

  if (eventType === 'worker-offline') {
    const workerId = event.workerId;
    if (!workerId) {
      console.warn('[Event] Missing workerId, skipping');
      return;
    }

    if (workers.has(workerId)) {
      const worker = workers.get(workerId);
      worker.status = 'offline';
      worker.lastSeen = now;
      workers.set(workerId, worker);
      console.log('[Event] Worker offline:', workerId);
    }

    influxDB.writeWorkerEvent({
      workerId,
      status: 'offline'
    });

    broadcastUpdate();
    return;
  }

  const validTaskStatuses = ['PENDING', 'STARTED', 'SUCCESS', 'FAILURE', 'RETRY', 'REVOKED'];
  if (validTaskStatuses.includes(eventType)) {
    if (!event.taskId) {
      console.warn('[Event] Missing taskId, skipping');
      return;
    }

    const taskEvent = {
      taskId: event.taskId,
      taskName: event.taskName || 'unknown',
      workerId: event.workerId || null,
      status: eventType,
      timestamp: event.timestamp || now,
      queue: event.queue || 'default',
      error: event.error || null,
      duration: event.duration || null
    };

    console.log('[Event] Task event:', taskEvent.status, '-', taskEvent.taskId, '(worker:', taskEvent.workerId, ')');

    if (eventType === 'STARTED' && event.workerId) {
      if (workers.has(event.workerId)) {
        const worker = workers.get(event.workerId);
        worker.isBusy = true;
        worker.currentTask = { taskId: event.taskId, taskName: event.taskName };
        worker.lastSeen = now;
        workers.set(event.workerId, worker);
        console.log('[Event] Worker', event.workerId, 'now busy with', event.taskName);
      }
      activeTasks.set(event.taskId, taskEvent);
    }

    if (eventType === 'SUCCESS' || eventType === 'FAILURE') {
      activeTasks.delete(event.taskId);
      
      if (event.workerId && workers.has(event.workerId)) {
        const worker = workers.get(event.workerId);
        worker.isBusy = false;
        worker.currentTask = null;
        if (eventType === 'SUCCESS') {
          worker.processedTasks = (worker.processedTasks || 0) + 1;
        } else {
          worker.failedTasks = (worker.failedTasks || 0) + 1;
        }
        worker.lastSeen = now;
        workers.set(event.workerId, worker);
        console.log('[Event] Worker', event.workerId, 'now idle, processed:', worker.processedTasks, 'failed:', worker.failedTasks);
      }
    }

    taskHistory.push(taskEvent);
    if (taskHistory.length > MAX_HISTORY) {
      taskHistory.shift();
    }

    influxDB.writeTaskEvent(taskEvent);
    broadcastTaskEvent(taskEvent);
    broadcastUpdate();
    return;
  }

  console.log('[Event] Unknown event type, ignoring:', eventType);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', stats: getSystemStats() });
});

app.get('/api/workers', (req, res) => {
  res.json({ workers: getWorkersData() });
});

app.get('/api/tasks/recent', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, MAX_HISTORY);
  res.json({ tasks: taskHistory.slice(-limit) });
});

app.get('/api/stats', (req, res) => {
  res.json(getSystemStats());
});

app.get('/api/history/trend', async (req, res) => {
  const hours = Math.min(parseInt(req.query.hours) || 24, 168);
  console.log('[API] Fetching task trend for', hours, 'hours');
  
  try {
    const trendData = await influxDB.getTaskStatusTrend(hours);
    res.json({
      hours,
      data: trendData
    });
  } catch (error) {
    console.error('[API] Error fetching trend data:', error.message);
    res.status(500).json({ error: 'Failed to fetch trend data' });
  }
});

app.get('/api/history/backlog', async (req, res) => {
  const hours = Math.min(parseInt(req.query.hours) || 24, 168);
  console.log('[API] Fetching backlog trend for', hours, 'hours');
  
  try {
    const backlogData = await influxDB.getQueueBacklogTrend(hours);
    res.json({
      hours,
      data: backlogData
    });
  } catch (error) {
    console.error('[API] Error fetching backlog data:', error.message);
    res.status(500).json({ error: 'Failed to fetch backlog data' });
  }
});

const PORT = process.env.PORT || 3000;

process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  redisListener.close();
  influxDB.close();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  redisListener.close();
  influxDB.close();
  server.close();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Initializing services...');
  influxDB.connect();
  redisListener.connect();
});
