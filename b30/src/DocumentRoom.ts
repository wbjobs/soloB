import WebSocket from 'ws';
import { RGA } from './RGA';
import { Operation } from './types';
import { v4 as uuidv4 } from 'uuid';

interface ClientInfo {
  ws: WebSocket;
  clientId: string;
}

export class DocumentRoom {
  private readonly roomId: string;
  private readonly rga: RGA;
  private readonly clients: Map<string, ClientInfo> = new Map();
  private readonly operationLog: Operation[] = [];

  constructor(roomId: string) {
    this.roomId = roomId;
    this.rga = new RGA(`server-${roomId}`);
  }

  getRoomId(): string {
    return this.roomId;
  }

  addClient(ws: WebSocket, clientId: string): void {
    const existingClient = this.clients.get(clientId);
    if (existingClient) {
      return;
    }

    this.clients.set(clientId, { ws, clientId });

    const syncMessage = {
      type: 'sync',
      roomId: this.roomId,
      documentText: this.rga.getVisibleText(),
    };
    ws.send(JSON.stringify(syncMessage));

    console.log(`Client ${clientId} joined room ${this.roomId}`);
  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId);
    console.log(`Client ${clientId} left room ${this.roomId}`);
  }

  handleOperation(operation: Operation, senderClientId: string): void {
    this.rga.applyOperation(operation);
    this.operationLog.push(operation);

    this.broadcastToOthers(
      {
        type: 'operation',
        roomId: this.roomId,
        operation,
      },
      senderClientId
    );

    console.log(`Operation in room ${this.roomId}:`, operation.type, operation.position);
  }

  private broadcastToOthers(message: object, excludeClientId: string): void {
    const messageStr = JSON.stringify(message);

    for (const [clientId, clientInfo] of this.clients) {
      if (clientId !== excludeClientId && clientInfo.ws.readyState === WebSocket.OPEN) {
        clientInfo.ws.send(messageStr);
      }
    }
  }

  getDocumentText(): string {
    return this.rga.getVisibleText();
  }

  getClientCount(): number {
    return this.clients.size;
  }

  isEmpty(): boolean {
    return this.clients.size === 0;
  }
}

export class RoomManager {
  private readonly rooms: Map<string, DocumentRoom> = new Map();

  getOrCreateRoom(roomId: string): DocumentRoom {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new DocumentRoom(roomId);
      this.rooms.set(roomId, room);
      console.log(`Created new room: ${roomId}`);
    }
    return room;
  }

  getRoom(roomId: string): DocumentRoom | undefined {
    return this.rooms.get(roomId);
  }

  removeEmptyRooms(): void {
    for (const [roomId, room] of this.rooms) {
      if (room.isEmpty()) {
        this.rooms.delete(roomId);
        console.log(`Removed empty room: ${roomId}`);
      }
    }
  }

  getTotalRooms(): number {
    return this.rooms.size;
  }

  generateRoomId(): string {
    return uuidv4();
  }
}
