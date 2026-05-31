export interface VectorClock {
  [site: string]: number;
}

export interface PositionIdentifier {
  site: string;
  clock: number;
}

export interface RGAElement {
  id: PositionIdentifier;
  value: string | null;
  next: PositionIdentifier | null;
  isTombstone: boolean;
}

export interface InsertOperation {
  type: 'insert';
  position: number;
  char: string;
  insertAfterId: PositionIdentifier | null;
  newElementId: PositionIdentifier;
  clientId: string;
  timestamp: number;
  vectorClock: VectorClock;
}

export interface BatchInsertOperation {
  type: 'batchInsert';
  position: number;
  text: string;
  insertAfterId: PositionIdentifier | null;
  newElementIds: PositionIdentifier[];
  clientId: string;
  timestamp: number;
  vectorClock: VectorClock;
}

export interface DeleteOperation {
  type: 'delete';
  position: number;
  elementId: PositionIdentifier;
  clientId: string;
  timestamp: number;
  vectorClock: VectorClock;
}

export interface BatchDeleteOperation {
  type: 'batchDelete';
  position: number;
  count: number;
  elementIds: PositionIdentifier[];
  clientId: string;
  timestamp: number;
  vectorClock: VectorClock;
}

export type Operation = InsertOperation | BatchInsertOperation | DeleteOperation | BatchDeleteOperation;

export interface JoinRoomMessage {
  type: 'join';
  roomId: string;
  clientId: string;
}

export interface OperationMessage {
  type: 'operation';
  roomId: string;
  operation: Operation;
}

export interface SyncMessage {
  type: 'sync';
  roomId: string;
  documentText: string;
}

export type WebSocketMessage = JoinRoomMessage | OperationMessage | SyncMessage;
