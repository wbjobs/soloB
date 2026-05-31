import {
  OperationType,
  validateOperation,
  generateTimestamp,
  compareTimestamps,
  createInverseOperation,
} from './types.js';

export class LWWElementSet {
  constructor() {
    this.addMap = new Map();
    this.removeMap = new Map();
  }

  add(id, timestamp) {
    const existing = this.addMap.get(id);
    if (!existing || compareTimestamps(timestamp, existing) > 0) {
      this.addMap.set(id, timestamp);
      return true;
    }
    return false;
  }

  remove(id, timestamp) {
    const existing = this.removeMap.get(id);
    if (!existing || compareTimestamps(timestamp, existing) > 0) {
      this.removeMap.set(id, timestamp);
      return true;
    }
    return false;
  }

  contains(id) {
    const addTs = this.addMap.get(id);
    if (!addTs) return false;
    const removeTs = this.removeMap.get(id);
    if (!removeTs) return true;
    return compareTimestamps(addTs, removeTs) > 0;
  }

  getState() {
    return {
      addMap: Array.from(this.addMap.entries()),
      removeMap: Array.from(this.removeMap.entries()),
    };
  }

  static fromState(state) {
    const set = new LWWElementSet();
    state.addMap.forEach(([id, ts]) => set.addMap.set(id, ts));
    state.removeMap.forEach(([id, ts]) => set.removeMap.set(id, ts));
    return set;
  }

  merge(otherState) {
    const other = LWWElementSet.fromState(otherState);
    for (const [id, ts] of other.addMap) {
      this.add(id, ts);
    }
    for (const [id, ts] of other.removeMap) {
      this.remove(id, ts);
    }
  }
}

export class LWWRegister {
  constructor(initialValue = null) {
    this.value = initialValue;
    this.timestamp = '';
    this.replicaId = '';
    this.history = [];
  }

  set(value, timestamp, replicaId) {
    if (this.value !== null) {
      this.history.push({
        value: this.value,
        timestamp: this.timestamp,
        replicaId: this.replicaId,
      });
    }
    if (!this.timestamp || compareTimestamps(timestamp, this.timestamp) > 0) {
      this.value = value;
      this.timestamp = timestamp;
      this.replicaId = replicaId;
      return true;
    }
    this.history.pop();
    return false;
  }

  get() {
    return this.value;
  }

  getState() {
    return {
      value: this.value,
      timestamp: this.timestamp,
      replicaId: this.replicaId,
      history: this.history,
    };
  }

  static fromState(state) {
    const reg = new LWWRegister();
    reg.value = state.value;
    reg.timestamp = state.timestamp;
    reg.replicaId = state.replicaId;
    reg.history = state.history || [];
    return reg;
  }

  merge(otherState) {
    const other = LWWRegister.fromState(otherState);
    this.set(other.value, other.timestamp, other.replicaId);
  }
}

export class FlowchartCRDT {
  constructor(replicaId) {
    this.replicaId = replicaId;
    this.nodes = new LWWElementSet();
    this.edges = new LWWElementSet();
    this.nodeRegisters = new Map();
    this.edgeRegisters = new Map();
    this.operationLog = [];
    this.operationIds = new Set();
    this.checkpoints = [];
    this.checkpointIdCounter = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.snapshotMap = new Map();
  }

  capturePriorState(op) {
    let priorData = null;
    if (op.type === OperationType.UPDATE_NODE) {
      const reg = this.nodeRegisters.get(op.entityId);
      if (reg) {
        priorData = reg.get() ? { ...reg.get() } : null;
      }
    } else if (op.type === OperationType.UPDATE_EDGE) {
      const reg = this.edgeRegisters.get(op.entityId);
      if (reg) {
        priorData = reg.get() ? { ...reg.get() } : null;
      }
    } else if (op.type === OperationType.REMOVE_NODE) {
      const reg = this.nodeRegisters.get(op.entityId);
      if (reg) {
        priorData = reg.get() ? { ...reg.get() } : null;
      }
    } else if (op.type === OperationType.REMOVE_EDGE) {
      const reg = this.edgeRegisters.get(op.entityId);
      if (reg) {
        priorData = reg.get() ? { ...reg.get() } : null;
      }
    }
    return priorData;
  }

  applyOperation(operation, isUndoRedo = false) {
    if (!validateOperation(operation)) {
      return false;
    }

    if (this.operationIds.has(operation.id)) {
      return false;
    }

    const priorData = this.capturePriorState(operation);

    this.operationIds.add(operation.id);
    this.operationLog.push(operation);

    const { type, entityType, entityId, data, replicaId, timestamp } = operation;
    const effectiveTs = timestamp || generateTimestamp(replicaId);

    if (entityType === 'node') {
      this.applyNodeOperation(type, entityId, data, replicaId, effectiveTs);
    } else if (entityType === 'edge') {
      this.applyEdgeOperation(type, entityId, data, replicaId, effectiveTs);
    }

    if (!isUndoRedo && !operation.originalOpId) {
      const inverse = createInverseOperation(operation, priorData);
      if (inverse) {
        this.undoStack.push({ op: operation, inverse, priorData });
        this.redoStack = [];
      }
    }

    return true;
  }

  applyNodeOperation(type, entityId, data, replicaId, timestamp) {
    switch (type) {
      case OperationType.ADD_NODE:
        this.nodes.add(entityId, timestamp);
        const nodeReg = this.getOrCreateNodeRegister(entityId);
        nodeReg.set(data, timestamp, replicaId);
        break;

      case OperationType.REMOVE_NODE:
        this.nodes.remove(entityId, timestamp);
        break;

      case OperationType.UPDATE_NODE:
        if (this.nodes.contains(entityId)) {
          const existing = this.getOrCreateNodeRegister(entityId);
          const currentValue = existing.get() || {};
          const newValue = { ...currentValue, ...data };
          existing.set(newValue, timestamp, replicaId);
        }
        break;
    }
  }

  applyEdgeOperation(type, entityId, data, replicaId, timestamp) {
    switch (type) {
      case OperationType.ADD_EDGE:
        this.edges.add(entityId, timestamp);
        const edgeReg = this.getOrCreateEdgeRegister(entityId);
        edgeReg.set(data, timestamp, replicaId);
        break;

      case OperationType.REMOVE_EDGE:
        this.edges.remove(entityId, timestamp);
        break;

      case OperationType.UPDATE_EDGE:
        if (this.edges.contains(entityId)) {
          const existing = this.getOrCreateEdgeRegister(entityId);
          const currentValue = existing.get() || {};
          const newValue = { ...currentValue, ...data };
          existing.set(newValue, timestamp, replicaId);
        }
        break;
    }
  }

  undo() {
    if (this.undoStack.length === 0) {
      return null;
    }

    const entry = this.undoStack.pop();
    const applied = this.applyOperation(entry.inverse, true);
    if (applied) {
      this.redoStack.push(entry);
      return entry.inverse;
    }
    this.undoStack.push(entry);
    return null;
  }

  redo() {
    if (this.redoStack.length === 0) {
      return null;
    }

    const entry = this.redoStack.pop();
    const applied = this.applyOperation(entry.op, true);
    if (applied) {
      this.undoStack.push(entry);
      return entry.op;
    }
    this.redoStack.push(entry);
    return null;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  createCheckpoint(label = '') {
    const checkpoint = {
      id: `cp-${Date.now()}-${++this.checkpointIdCounter}`,
      timestamp: generateTimestamp(this.replicaId),
      state: this.getState(),
      label: label || `检查点 ${this.checkpoints.length + 1}`,
      operationCount: this.operationLog.length,
    };
    this.checkpoints.push(checkpoint);
    this.snapshotMap.set(checkpoint.id, this.getState());
    return checkpoint;
  }

  revertToCheckpoint(checkpointId) {
    const checkpoint = this.checkpoints.find((cp) => cp.id === checkpointId);
    if (!checkpoint) {
      return null;
    }

    const snapshot = this.snapshotMap.get(checkpointId);
    if (!snapshot) {
      return null;
    }

    this.nodes = LWWElementSet.fromState(snapshot.nodes);
    this.edges = LWWElementSet.fromState(snapshot.edges);

    this.nodeRegisters = new Map();
    for (const [id, regState] of Object.entries(snapshot.nodeRegisters)) {
      this.nodeRegisters.set(id, LWWRegister.fromState(regState));
    }

    this.edgeRegisters = new Map();
    for (const [id, regState] of Object.entries(snapshot.edgeRegisters)) {
      this.edgeRegisters.set(id, LWWRegister.fromState(regState));
    }

    this.operationIds = new Set(snapshot.operationIds || []);
    this.operationLog = snapshot.operationLog || [];

    this.undoStack = [];
    this.redoStack = [];

    return checkpoint;
  }

  getCheckpoints() {
    return [...this.checkpoints].sort((a, b) =>
      compareTimestamps(b.timestamp, a.timestamp)
    );
  }

  getHistory(limit = 50) {
    const log = [...this.operationLog].sort((a, b) =>
      compareTimestamps(b.timestamp, a.timestamp)
    );
    return log.slice(0, limit);
  }

  getOrCreateNodeRegister(nodeId) {
    if (!this.nodeRegisters.has(nodeId)) {
      this.nodeRegisters.set(nodeId, new LWWRegister());
    }
    return this.nodeRegisters.get(nodeId);
  }

  getOrCreateEdgeRegister(edgeId) {
    if (!this.edgeRegisters.has(edgeId)) {
      this.edgeRegisters.set(edgeId, new LWWRegister());
    }
    return this.edgeRegisters.get(edgeId);
  }

  getNodes() {
    const result = [];
    for (const [id, reg] of this.nodeRegisters) {
      if (this.nodes.contains(id)) {
        const node = reg.get();
        if (node) {
          result.push(node);
        }
      }
    }
    return result;
  }

  getEdges() {
    const result = [];
    for (const [id, reg] of this.edgeRegisters) {
      if (this.edges.contains(id)) {
        const edge = reg.get();
        if (edge) {
          result.push(edge);
        }
      }
    }
    return result;
  }

  getNode(nodeId) {
    if (!this.nodes.contains(nodeId)) return null;
    const reg = this.nodeRegisters.get(nodeId);
    return reg ? reg.get() : null;
  }

  getEdge(edgeId) {
    if (!this.edges.contains(edgeId)) return null;
    const reg = this.edgeRegisters.get(edgeId);
    return reg ? reg.get() : null;
  }

  getState() {
    const nodeStates = {};
    this.nodeRegisters.forEach((reg, id) => {
      nodeStates[id] = reg.getState();
    });

    const edgeStates = {};
    this.edgeRegisters.forEach((reg, id) => {
      edgeStates[id] = reg.getState();
    });

    return {
      replicaId: this.replicaId,
      nodes: this.nodes.getState(),
      edges: this.edges.getState(),
      nodeRegisters: nodeStates,
      edgeRegisters: edgeStates,
      operationLog: this.operationLog,
      operationIds: Array.from(this.operationIds),
    };
  }

  getFullState() {
    return {
      ...this.getState(),
      checkpoints: this.checkpoints,
      snapshots: Object.fromEntries(this.snapshotMap),
    };
  }

  static fromState(state) {
    const crdt = new FlowchartCRDT(state.replicaId);
    crdt.nodes = LWWElementSet.fromState(state.nodes);
    crdt.edges = LWWElementSet.fromState(state.edges);

    for (const [id, regState] of Object.entries(state.nodeRegisters)) {
      crdt.nodeRegisters.set(id, LWWRegister.fromState(regState));
    }

    for (const [id, regState] of Object.entries(state.edgeRegisters)) {
      crdt.edgeRegisters.set(id, LWWRegister.fromState(regState));
    }

    crdt.operationLog = state.operationLog || [];
    crdt.operationIds = new Set(state.operationIds || []);
    crdt.checkpoints = state.checkpoints || [];

    if (state.snapshots) {
      for (const [id, snapState] of Object.entries(state.snapshots)) {
        crdt.snapshotMap.set(id, snapState);
      }
    }

    return crdt;
  }

  merge(otherState) {
    this.nodes.merge(otherState.nodes);
    this.edges.merge(otherState.edges);

    for (const [id, regState] of Object.entries(otherState.nodeRegisters)) {
      const myReg = this.getOrCreateNodeRegister(id);
      myReg.merge(regState);
    }

    for (const [id, regState] of Object.entries(otherState.edgeRegisters)) {
      const myReg = this.getOrCreateEdgeRegister(id);
      myReg.merge(regState);
    }

    for (const op of otherState.operationLog || []) {
      if (!this.operationIds.has(op.id)) {
        this.operationIds.add(op.id);
        this.operationLog.push(op);
      }
    }

    if (otherState.checkpoints) {
      for (const cp of otherState.checkpoints) {
        const existing = this.checkpoints.find((c) => c.id === cp.id);
        if (!existing) {
          this.checkpoints.push(cp);
        }
      }
    }

    if (otherState.snapshots) {
      for (const [id, snapState] of Object.entries(otherState.snapshots)) {
        if (!this.snapshotMap.has(id)) {
          this.snapshotMap.set(id, snapState);
        }
      }
    }
  }
}
