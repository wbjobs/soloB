let _counter = 0;

export function generateTimestamp(replicaId) {
  const ms = Date.now();
  _counter = (_counter + 1) % 10000;
  return `${ms.toString().padStart(13, '0')}-${_counter.toString().padStart(4, '0')}-${replicaId}`;
}

export function compareTimestamps(a, b) {
  if (a === b) return 0;
  if (a > b) return 1;
  return -1;
}

export function parseTimestamp(ts) {
  const parts = ts.split('-');
  return {
    ms: parseInt(parts[0], 10),
    counter: parseInt(parts[1], 10),
    replicaId: parts.slice(2).join('-'),
  };
}

export const NodeType = {
  START: 'start',
  END: 'end',
  PROCESS: 'process',
  DECISION: 'decision',
  INPUT: 'input',
  OUTPUT: 'output',
};

export const MessageType = {
  OPERATION: 'operation',
  SYNC_REQUEST: 'sync_request',
  SYNC_RESPONSE: 'sync_response',
  HEARTBEAT: 'heartbeat',
  UNDO: 'undo',
  REDO: 'redo',
  CHECKPOINT: 'checkpoint',
  HISTORY_REQUEST: 'history_request',
  HISTORY_RESPONSE: 'history_response',
  REVERT_TO_CHECKPOINT: 'revert_to_checkpoint',
};

export const OperationType = {
  ADD_NODE: 'add_node',
  REMOVE_NODE: 'remove_node',
  UPDATE_NODE: 'update_node',
  ADD_EDGE: 'add_edge',
  REMOVE_EDGE: 'remove_edge',
  UPDATE_EDGE: 'update_edge',
};

export const OperationLabelMap = {
  [OperationType.ADD_NODE]: '添加节点',
  [OperationType.REMOVE_NODE]: '删除节点',
  [OperationType.UPDATE_NODE]: '更新节点',
  [OperationType.ADD_EDGE]: '添加连线',
  [OperationType.REMOVE_EDGE]: '删除连线',
  [OperationType.UPDATE_EDGE]: '更新连线',
};

export function createNode(id, type, x, y, label = '') {
  return {
    id,
    type,
    x,
    y,
    width: 120,
    height: 60,
    label,
    properties: {
      color: '#ffffff',
      textColor: '#333333',
      fontSize: 14,
    },
  };
}

export function createEdge(id, sourceId, targetId, label = '') {
  return {
    id,
    sourceId,
    targetId,
    label,
    properties: {
      color: '#333333',
      lineWidth: 2,
    },
  };
}

export function createOperation(
  type,
  entityType,
  entityId,
  data,
  replicaId,
  timestamp = null
) {
  const ts = timestamp || generateTimestamp(replicaId);
  return {
    id: `${replicaId}-${ts}-${Math.random().toString(36).substr(2, 9)}`,
    type,
    entityType,
    entityId,
    data,
    replicaId,
    timestamp: ts,
  };
}

export function createInverseOperation(op, priorData) {
  let inverseType;
  let inverseData;

  switch (op.type) {
    case OperationType.ADD_NODE:
      inverseType = OperationType.REMOVE_NODE;
      inverseData = null;
      break;

    case OperationType.REMOVE_NODE:
      inverseType = OperationType.ADD_NODE;
      inverseData = priorData || op.data;
      break;

    case OperationType.UPDATE_NODE:
      inverseType = OperationType.UPDATE_NODE;
      inverseData = priorData;
      break;

    case OperationType.ADD_EDGE:
      inverseType = OperationType.REMOVE_EDGE;
      inverseData = null;
      break;

    case OperationType.REMOVE_EDGE:
      inverseType = OperationType.ADD_EDGE;
      inverseData = priorData || op.data;
      break;

    case OperationType.UPDATE_EDGE:
      inverseType = OperationType.UPDATE_EDGE;
      inverseData = priorData;
      break;

    default:
      return null;
  }

  return {
    id: `inv-${op.id}`,
    type: inverseType,
    entityType: op.entityType,
    entityId: op.entityId,
    data: inverseData,
    replicaId: op.replicaId,
    timestamp: generateTimestamp(op.replicaId),
    originalOpId: op.id,
  };
}

export function createCheckpoint(id, crdtState, label = '') {
  return {
    id,
    timestamp: generateTimestamp('checkpoint'),
    state: crdtState,
    label,
  };
}

export function validateOperation(op) {
  if (!op || typeof op !== 'object') return false;
  if (!op.id || !op.type || !op.entityType || !op.entityId) return false;
  if (!Object.values(OperationType).includes(op.type)) return false;
  if (!['node', 'edge'].includes(op.entityType)) return false;
  return true;
}
