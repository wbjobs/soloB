export type ResourceType = 'page' | 'workflow' | 'dataModel';

export type OperationType =
  | 'component_add'
  | 'component_remove'
  | 'component_update'
  | 'component_move'
  | 'page_props_update'
  | 'node_add'
  | 'node_remove'
  | 'node_update'
  | 'edge_add'
  | 'edge_remove'
  | 'field_add'
  | 'field_remove'
  | 'field_update';

export interface CollaborativeSession {
  id: string;
  resourceId: string;
  resourceType: ResourceType;
  organizationId: string;
  isActive: boolean;
  lastActivityAt: Date;
  createdAt: Date;
}

export interface CollaborativeParticipant {
  id: string;
  sessionId: string;
  userId: string;
  cursorX?: number;
  cursorY?: number;
  selection?: string[];
  isOnline: boolean;
  lastSeenAt: Date;
  color: string;
  createdAt: Date;
}

export interface CollaborativeOperation {
  id: string;
  sessionId: string;
  userId: string;
  operationType: OperationType;
  data: any;
  version: number;
  parentId?: string;
  createdAt: Date;
}

export interface CursorPosition {
  x: number;
  y: number;
  elementId?: string;
}

export interface CollaborationMessage {
  type:
    | 'join'
    | 'leave'
    | 'cursor'
    | 'selection'
    | 'operation'
    | 'presence'
    | 'sync'
    | 'ack';
  sessionId: string;
  userId: string;
  timestamp: number;
  payload?: any;
}
