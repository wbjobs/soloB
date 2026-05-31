const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379')
});

const channel = process.env.REDIS_CHANNEL || 'celery-task-monitor';

const workers = [
  { id: 'worker-1', name: 'Worker Alpha', queue: 'default' },
  { id: 'worker-2', name: 'Worker Beta', queue: 'default' },
  { id: 'worker-3', name: 'Worker Gamma', queue: 'priority' },
  { id: 'worker-4', name: 'Worker Delta', queue: 'slow-tasks' }
];

const taskNames = [
  'process_image',
  'send_email',
  'generate_report',
  'sync_data',
  'cleanup_files',
  'analyze_metrics',
  'backup_database',
  'update_cache'
];

function generateTaskId() {
  return 'task-' + Math.random().toString(36).substr(2, 12);
}

function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function randomRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function publish(event) {
  await redis.publish(channel, JSON.stringify(event));
  console.log('Published:', event.type || event.status, '-', event.taskId || event.workerId);
}

async function simulateWorkerOnline() {
  for (const worker of workers) {
    await publish({
      type: 'worker-online',
      workerId: worker.id,
      workerName: worker.name,
      queue: worker.queue,
      timestamp: Date.now()
    });
  }
}

async function simulateTask() {
  const worker = randomChoice(workers);
  const taskId = generateTaskId();
  const taskName = randomChoice(taskNames);
  const duration = randomRange(500, 5000);
  const willFail = Math.random() < 0.15;

  await publish({
    status: 'PENDING',
    taskId,
    taskName,
    queue: worker.queue,
    timestamp: Date.now()
  });

  await new Promise(resolve => setTimeout(resolve, randomRange(100, 500)));

  await publish({
    status: 'STARTED',
    taskId,
    taskName,
    workerId: worker.id,
    workerName: worker.name,
    queue: worker.queue,
    timestamp: Date.now()
  });

  await publish({
    type: 'worker-heartbeat',
    workerId: worker.id,
    timestamp: Date.now()
  });

  await new Promise(resolve => setTimeout(resolve, duration));

  if (willFail) {
    await publish({
      status: 'FAILURE',
      taskId,
      taskName,
      workerId: worker.id,
      workerName: worker.name,
      queue: worker.queue,
      duration,
      error: 'Task execution failed: Timeout error',
      timestamp: Date.now()
    });
  } else {
    await publish({
      status: 'SUCCESS',
      taskId,
      taskName,
      workerId: worker.id,
      workerName: worker.name,
      queue: worker.queue,
      duration,
      timestamp: Date.now()
    });
  }
}

async function simulateWorkerHeartbeats() {
  setInterval(async () => {
    for (const worker of workers) {
      if (Math.random() > 0.3) {
        await publish({
          type: 'worker-heartbeat',
          workerId: worker.id,
          timestamp: Date.now()
        });
      }
    }
  }, 5000);
}

async function startSimulation() {
  console.log('Starting mock data simulation...');
  console.log('Connecting to Redis...');

  redis.on('connect', async () => {
    console.log('Redis connected, starting simulation...');
    
    await simulateWorkerOnline();
    simulateWorkerHeartbeats();

    setInterval(async () => {
      const taskCount = randomRange(1, 3);
      for (let i = 0; i < taskCount; i++) {
        setTimeout(() => simulateTask(), i * randomRange(200, 800));
      }
    }, 3000);
  });

  redis.on('error', (error) => {
    console.error('Redis error:', error.message);
  });
}

startSimulation();
