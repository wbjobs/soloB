import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager } from './DocumentRoom';
import { WebSocketMessage, JoinRoomMessage, OperationMessage } from './types';
import { v4 as uuidv4 } from 'uuid';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

interface ConnectionInfo {
  ws: WebSocket;
  clientId: string;
  currentRoomId: string | null;
}

const wss = new WebSocketServer({ port: PORT });
const roomManager = new RoomManager();
const connections: Map<string, ConnectionInfo> = new Map();

console.log(`WebSocket server started on port ${PORT}`);

wss.on('connection', (ws: WebSocket) => {
  const connectionId = uuidv4();
  const clientId = connectionId;

  connections.set(connectionId, {
    ws,
    clientId,
    currentRoomId: null,
  });

  console.log(`New connection: ${connectionId}`);

  ws.on('message', (data: string) => {
    try {
      const message: WebSocketMessage = JSON.parse(data.toString());
      const connection = connections.get(connectionId);

      if (!connection) {
        console.error(`Connection not found: ${connectionId}`);
        return;
      }

      handleMessage(connection, message);
    } catch (error) {
      console.error('Error parsing message:', error);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    const connection = connections.get(connectionId);
    if (connection && connection.currentRoomId) {
      const room = roomManager.getRoom(connection.currentRoomId);
      if (room) {
        room.removeClient(connection.clientId);
        if (room.isEmpty()) {
          roomManager.removeEmptyRooms();
        }
      }
    }

    connections.delete(connectionId);
    console.log(`Connection closed: ${connectionId}`);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error: ${connectionId}`, error);
  });
});

function handleMessage(connection: ConnectionInfo, message: WebSocketMessage): void {
  switch (message.type) {
    case 'join':
      handleJoin(connection, message);
      break;
    case 'operation':
      handleOperation(connection, message);
      break;
    default:
      console.warn('Unknown message type:', (message as any).type);
      connection.ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
  }
}

function handleJoin(connection: ConnectionInfo, message: JoinRoomMessage): void {
  const { roomId, clientId: messageClientId } = message;

  if (connection.currentRoomId) {
    const previousRoom = roomManager.getRoom(connection.currentRoomId);
    if (previousRoom) {
      previousRoom.removeClient(connection.clientId);
      if (previousRoom.isEmpty()) {
        roomManager.removeEmptyRooms();
      }
    }
  }

  const actualClientId = messageClientId || connection.clientId;
  connection.clientId = actualClientId;
  connection.currentRoomId = roomId;

  const room = roomManager.getOrCreateRoom(roomId);
  room.addClient(connection.ws, actualClientId);

  console.log(`Client ${actualClientId} joined room ${roomId}. Total clients in room: ${room.getClientCount()}`);
}

function handleOperation(connection: ConnectionInfo, message: OperationMessage): void {
  const { roomId, operation } = message;

  if (!connection.currentRoomId || connection.currentRoomId !== roomId) {
    connection.ws.send(JSON.stringify({ type: 'error', message: 'Not joined to this room' }));
    return;
  }

  const room = roomManager.getRoom(roomId);
  if (!room) {
    connection.ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
    return;
  }

  room.handleOperation(operation, connection.clientId);
}

process.on('SIGINT', () => {
  console.log('Shutting down WebSocket server...');
  wss.close(() => {
    console.log('WebSocket server closed.');
    process.exit(0);
  });
});

console.log('Server ready. Clients can connect to ws://localhost:' + PORT);
