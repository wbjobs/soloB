const Docker = require('dockerode');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

const docker = new Docker();
const tmpDir = os.tmpdir();

const activeContainers = new Map();
const cleanupInterval = 30000;
const MAX_CONCURRENT_EXECUTIONS = 10;
const executionQueue = [];
let currentExecutions = 0;

const containerCleanup = new EventEmitter();
containerCleanup.setMaxListeners(100);

const LANG_CONFIG = {
  javascript: {
    image: 'node:18-alpine',
    filename: 'main.js',
    command: (file) => ['node', file],
    timeout: 5000,
    memory: 128 * 1024 * 1024
  },
  python: {
    image: 'python:3.11-slim',
    filename: 'main.py',
    command: (file) => ['python', file],
    timeout: 5000,
    memory: 128 * 1024 * 1024
  },
  java: {
    image: 'eclipse-temurin:17-jre-alpine',
    filename: 'Main.java',
    command: (file) => ['sh', '-c', `cd /sandbox && javac ${file} && java Main`],
    timeout: 10000,
    memory: 256 * 1024 * 1024
  }
};

const processQueue = () => {
  while (currentExecutions < MAX_CONCURRENT_EXECUTIONS && executionQueue.length > 0) {
    const { resolve, reject, executionId, language, code, config } = executionQueue.shift();
    currentExecutions++;

    executeSingle(executionId, language, code, config)
      .then(resolve)
      .catch(reject)
      .finally(() => {
        currentExecutions--;
        processQueue();
      });
  }
};

const executeCode = async (executionId, language, code) => {
  const config = LANG_CONFIG[language];
  if (!config) {
    throw new Error('Unsupported language');
  }

  if (currentExecutions >= MAX_CONCURRENT_EXECUTIONS) {
    return new Promise((resolve, reject) => {
      executionQueue.push({ resolve, reject, executionId, language, code, config });
    });
  }

  currentExecutions++;
  try {
    return await executeSingle(executionId, language, code, config);
  } finally {
    currentExecutions--;
    processQueue();
  }
};

const executeSingle = async (executionId, language, code, config) => {
  const execDir = path.join(tmpDir, `sandbox-${executionId}`);
  const filePath = path.join(execDir, config.filename);

  let container = null;
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let memoryError = false;
  let containerId = null;

  try {
    await fs.mkdir(execDir, { recursive: true });
    await fs.writeFile(filePath, code);

    const containerName = `sandbox-${executionId}`;

    const containerOptions = {
      name: containerName,
      Image: config.image,
      Cmd: config.command(config.filename),
      HostConfig: {
        Binds: [`${execDir}:/sandbox:ro`],
        Memory: config.memory,
        MemorySwap: config.memory,
        CpuQuota: 50000,
        CpuPeriod: 100000,
        NetworkMode: 'none',
        AutoRemove: false,
        PidsLimit: 32
      },
      WorkingDir: '/sandbox',
      Tty: false,
      AttachStdout: true,
      AttachStderr: true
    };

    try {
      const existing = await docker.getContainer(containerName);
      await existing.remove({ force: true }).catch(() => {});
    } catch (e) {}

    container = await docker.createContainer(containerOptions);
    containerId = container.id;

    activeContainers.set(executionId, {
      container,
      containerId,
      execDir,
      startTime: Date.now(),
      timeout: config.timeout
    });

    await container.start();

    const timeoutPromise = new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        timedOut = true;
        if (container) {
          container.kill().catch(() => {});
        }
        resolve();
      }, config.timeout);

      containerCleanup.once(`cleanup-${executionId}`, () => {
        clearTimeout(timeoutId);
      });
    });

    const logsPromise = container.wait().then(async () => {
      if (!timedOut && container) {
        try {
          const state = await container.inspect();
          if (state?.State?.OOMKilled) {
            memoryError = true;
          }
        } catch (e) {}

        try {
          const logs = await container.logs({
            stdout: true,
            stderr: true
          });
          stdout = extractLogContent(logs, true);
          stderr = extractLogContent(logs, false);
        } catch (e) {
          stderr = e.message;
        }
      }
      containerCleanup.emit(`cleanup-${executionId}`);
    });

    await Promise.race([logsPromise, timeoutPromise]);

    await cleanupExecution(executionId);

    if (memoryError) {
      return {
        executionId,
        success: false,
        stdout: '',
        stderr: 'Memory limit exceeded (128MB)',
        timedOut: false,
        memoryError: true
      };
    }

    if (timedOut) {
      return {
        executionId,
        success: false,
        stdout: stdout,
        stderr: 'Time limit exceeded (5 seconds)',
        timedOut: true,
        duration: config.timeout
      };
    }

    return {
      executionId,
      success: !memoryError && stderr.length === 0,
      stdout,
      stderr,
      timedOut: false
    };

  } catch (error) {
    await cleanupExecution(executionId);

    if (error.statusCode === 137 || memoryError) {
      return {
        executionId,
        success: false,
        stdout: '',
        stderr: 'Memory limit exceeded (128MB)',
        timedOut: false,
        memoryError: true
      };
    }

    throw error;
  }
};

const cleanupExecution = async (executionId) => {
  const info = activeContainers.get(executionId);
  if (!info) return;

  const { container, containerId, execDir } = info;
  activeContainers.delete(executionId);

  try {
    if (container) {
      try {
        await container.stop({ t: 0 }).catch(() => {});
      } catch (e) {}

      try {
        await container.remove({ force: true }).catch(() => {});
      } catch (e) {}
    }
  } catch (e) {
    console.error(`Failed to clean container ${containerId}:`, e.message);
  }

  try {
    await fs.rm(execDir, { recursive: true, force: true });
  } catch (e) {
    console.error(`Failed to clean directory ${execDir}:`, e.message);
  }
};

const cleanupOrphanedContainers = async () => {
  console.log('Running orphaned container cleanup...');

  const now = Date.now();
  const containersToCleanup = [];

  activeContainers.forEach((info, executionId) => {
    const elapsed = now - info.startTime;
    if (elapsed > info.timeout * 2) {
      containersToCleanup.push(executionId);
    }
  });

  for (const executionId of containersToCleanup) {
    console.log(`Cleaning up orphaned execution: ${executionId}`);
    await cleanupExecution(executionId);
  }

  try {
    const containers = await docker.listContainers({
      all: true,
      filters: { name: ['sandbox-'] }
    });

    for (const containerInfo of containers) {
      const name = containerInfo.Names[0];
      const executionId = name.replace('/sandbox-', '');

      if (!activeContainers.has(executionId)) {
        console.log(`Removing orphaned container: ${name}`);
        try {
          const container = docker.getContainer(containerInfo.Id);
          await container.stop({ t: 0 }).catch(() => {});
          await container.remove({ force: true }).catch(() => {});
        } catch (e) {
          console.error(`Failed to remove container ${name}:`, e.message);
        }
      }
    }
  } catch (e) {
    console.error('Failed to list containers:', e.message);
  }

  try {
    const files = await fs.readdir(tmpDir);
    for (const file of files) {
      if (file.startsWith('sandbox-')) {
        const execDir = path.join(tmpDir, file);
        const executionId = file.replace('sandbox-', '');

        if (!activeContainers.has(executionId)) {
          try {
            const stats = await fs.stat(execDir);
            const age = now - stats.mtimeMs;

            if (age > cleanupInterval) {
              console.log(`Removing orphaned directory: ${execDir}`);
              await fs.rm(execDir, { recursive: true, force: true });
            }
          } catch (e) {}
        }
      }
    }
  } catch (e) {
    console.error('Failed to clean temp directories:', e.message);
  }

  console.log(`Cleanup complete. Active executions: ${activeContainers.size}, Queue: ${executionQueue.length}`);
};

setInterval(cleanupOrphanedContainers, cleanupInterval);

const extractLogContent = (logsBuffer, isStdout) => {
  if (!logsBuffer) return '';

  let result = '';
  let i = 0;

  while (i < logsBuffer.length) {
    const streamType = logsBuffer[i];
    i += 4;
    const length = logsBuffer.readUInt32BE(i);
    i += 4;

    if (i + length > logsBuffer.length) break;

    const content = logsBuffer.slice(i, i + length).toString('utf-8');
    i += length;

    if ((isStdout && streamType === 1) || (!isStdout && streamType === 2)) {
      result += content;
    }
  }

  return result;
};

const getStats = () => ({
  activeExecutions: activeContainers.size,
  queuedExecutions: executionQueue.length,
  currentConcurrency: currentExecutions,
  maxConcurrency: MAX_CONCURRENT_EXECUTIONS
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, cleaning up...');
  for (const executionId of activeContainers.keys()) {
    await cleanupExecution(executionId);
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, cleaning up...');
  for (const executionId of activeContainers.keys()) {
    await cleanupExecution(executionId);
  }
  process.exit(0);
});

module.exports = { executeCode, getStats };
