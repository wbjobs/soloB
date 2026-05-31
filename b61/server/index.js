import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import Redis from 'ioredis';
import cors from 'cors';
import { FlowchartCRDT, MessageType } from 'shared';

const PORT = process.env.PORT || 3001;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const DOCUMENT_KEY = 'flowchart:document:default';
const FULL_STATE_KEY = 'flowchart:document:full:default';

const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ server });

const pub = new Redis(REDIS_URL);
const sub = new Redis(REDIS_URL);

const clients = new Map();
const nodeCrdt = new FlowchartCRDT('server');

async function loadDocument() {
  try {
    const saved = await pub.get(FULL_STATE_KEY);
    if (saved) {
      const state = JSON.parse(saved);
      nodeCrdt.merge(state);
      console.log('Full document loaded from Redis');
    } else {
      const legacy = await pub.get(DOCUMENT_KEY);
      if (legacy) {
        const state = JSON.parse(legacy);
        nodeCrdt.merge(state);
        console.log('Legacy document loaded from Redis');
      }
    }
  } catch (err) {
    console.error('Failed to load document:', err);
  }
}

async function saveDocument() {
  try {
    const state = nodeCrdt.getState();
    await pub.set(DOCUMENT_KEY, JSON.stringify(state));
    const fullState = nodeCrdt.getFullState();
    await pub.set(FULL_STATE_KEY, JSON.stringify(fullState));
  } catch (err) {
    console.error('Failed to save document:', err);
  }
}

function generateClientId() {
  return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function broadcastToLocalClients(message, excludeId = null) {
  for (const [clientId, ws] of clients) {
    if (clientId !== excludeId && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}

async function broadcastWithRedis(message) {
  await pub.publish('flowchart:operations', JSON.stringify(message));
}

sub.subscribe('flowchart:operations', (err) => {
  if (err) {
    console.error('Failed to subscribe to Redis channel:', err);
  } else {
    console.log('Subscribed to Redis channel: flowchart:operations');
  }
});

sub.on('message', (channel, message) => {
  if (channel === 'flowchart:operations') {
    try {
      const parsed = JSON.parse(message);
      broadcastToLocalClients(parsed, parsed.excludeClientId);
    } catch (err) {
      console.error('Failed to parse Redis message:', err);
    }
  }
});

wss.on('connection', (ws, req) => {
  const clientId = generateClientId();
  clients.set(clientId, ws);
  console.log(`Client connected: ${clientId}. Total: ${clients.size}`);

  ws.send(
    JSON.stringify({
      type: 'init',
      clientId,
      state: nodeCrdt.getState(),
      checkpoints: nodeCrdt.getCheckpoints(),
      history: nodeCrdt.getHistory(100),
    })
  );

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case MessageType.OPERATION: {
          const applied = nodeCrdt.applyOperation(message.operation);
          if (applied) {
            await saveDocument();
            const broadcastMsg = {
              type: MessageType.OPERATION,
              operation: message.operation,
              senderClientId: clientId,
              excludeClientId: clientId,
            };
            await broadcastWithRedis(broadcastMsg);
          }
          break;
        }

        case MessageType.UNDO: {
          const inverseOp = nodeCrdt.undo();
          if (inverseOp) {
            await saveDocument();
            const broadcastMsg = {
              type: MessageType.OPERATION,
              operation: inverseOp,
              isUndo: true,
              senderClientId: clientId,
            };
            await broadcastWithRedis(broadcastMsg);
            ws.send(
              JSON.stringify({
                type: MessageType.UNDO,
                success: true,
                operation: inverseOp,
              })
            );
          }
          break;
        }

        case MessageType.REDO: {
          const redoOp = nodeCrdt.redo();
          if (redoOp) {
            await saveDocument();
            const broadcastMsg = {
              type: MessageType.OPERATION,
              operation: redoOp,
              isRedo: true,
              senderClientId: clientId,
            };
            await broadcastWithRedis(broadcastMsg);
            ws.send(
              JSON.stringify({
                type: MessageType.REDO,
                success: true,
                operation: redoOp,
              })
            );
          }
          break;
        }

        case MessageType.CHECKPOINT: {
          const checkpoint = nodeCrdt.createCheckpoint(message.label || '');
          await saveDocument();
          const broadcastMsg = {
            type: MessageType.CHECKPOINT,
            checkpoint,
            senderClientId: clientId,
          };
          await broadcastWithRedis(broadcastMsg);
          ws.send(
            JSON.stringify({
              type: MessageType.CHECKPOINT,
              success: true,
              checkpoint,
            })
          );
          break;
        }

        case MessageType.REVERT_TO_CHECKPOINT: {
          const reverted = nodeCrdt.revertToCheckpoint(message.checkpointId);
          if (reverted) {
            await saveDocument();
            const broadcastMsg = {
              type: MessageType.REVERT_TO_CHECKPOINT,
              checkpoint: reverted,
              state: nodeCrdt.getState(),
              senderClientId: clientId,
            };
            await broadcastWithRedis(broadcastMsg);
            ws.send(
              JSON.stringify({
                type: MessageType.REVERT_TO_CHECKPOINT,
                success: true,
                checkpoint: reverted,
                state: nodeCrdt.getState(),
              })
            );
          }
          break;
        }

        case MessageType.HISTORY_REQUEST: {
          ws.send(
            JSON.stringify({
              type: MessageType.HISTORY_RESPONSE,
              history: nodeCrdt.getHistory(message.limit || 50),
              checkpoints: nodeCrdt.getCheckpoints(),
            })
          );
          break;
        }

        case MessageType.SYNC_REQUEST: {
          ws.send(
            JSON.stringify({
              type: MessageType.SYNC_RESPONSE,
              state: nodeCrdt.getState(),
              checkpoints: nodeCrdt.getCheckpoints(),
            })
          );
          break;
        }

        case MessageType.HEARTBEAT: {
          ws.send(JSON.stringify({ type: 'heartbeat_ack', timestamp: Date.now() }));
          break;
        }
      }
    } catch (err) {
      console.error('Failed to handle message:', err);
    }
  });

  ws.on('close', () => {
    clients.delete(clientId);
    console.log(`Client disconnected: ${clientId}. Total: ${clients.size}`);
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error for ${clientId}:`, err);
    clients.delete(clientId);
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    connectedClients: clients.size,
    nodeCount: nodeCrdt.getNodes().length,
    edgeCount: nodeCrdt.getEdges().length,
    checkpointCount: nodeCrdt.getCheckpoints().length,
    historyCount: nodeCrdt.getHistory(1000).length,
  });
});

app.get('/api/document', (req, res) => {
  res.json({
    state: nodeCrdt.getState(),
    nodes: nodeCrdt.getNodes(),
    edges: nodeCrdt.getEdges(),
  });
});

app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  res.json({
    history: nodeCrdt.getHistory(limit),
    checkpoints: nodeCrdt.getCheckpoints(),
  });
});

app.post('/api/checkpoints', express.json(), async (req, res) => {
  try {
    const checkpoint = nodeCrdt.createCheckpoint(req.body.label || '');
    await saveDocument();
    const broadcastMsg = {
      type: MessageType.CHECKPOINT,
      checkpoint,
      senderClientId: 'api',
    };
    await broadcastWithRedis(broadcastMsg);
    res.json({ success: true, checkpoint });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

server.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket server running on ws://localhost:${PORT}`);
  await loadDocument();
});
