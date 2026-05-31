class ConflictManager {
  constructor(siteId, options = {}) {
    this.siteId = siteId;
    this.conflictWindowMs = options.conflictWindowMs || 3000;
    this.conflictRangeThreshold = options.conflictRangeThreshold || 10;
    this.localOperations = [];
    this.remoteOperations = [];
    this.activeConflicts = new Map();
    this.conflictIdCounter = 0;
    this.onConflictDetected = options.onConflictDetected || (() => {});
    this.onConflictResolved = options.onConflictResolved || (() => {});
  }

  recordLocalOperation(operation, position, timestamp = Date.now()) {
    if (!operation || !operation.id) return null;
    
    const localOp = {
      ...operation,
      position,
      timestamp,
      isLocal: true
    };
    
    this.localOperations.push(localOp);
    
    const conflict = this.detectConflict(localOp);
    if (conflict) {
      this.activeConflicts.set(conflict.id, conflict);
      this.onConflictDetected(conflict);
      return conflict;
    }
    
    this.cleanupOldOperations();
    return null;
  }

  recordRemoteOperation(operation, position, fromUserId, timestamp = Date.now()) {
    if (!operation || !operation.id) return null;
    
    const remoteOp = {
      ...operation,
      position,
      fromUserId,
      timestamp,
      isLocal: false
    };
    
    this.remoteOperations.push(remoteOp);
    
    const conflict = this.detectConflict(remoteOp);
    if (conflict) {
      this.activeConflicts.set(conflict.id, conflict);
      this.onConflictDetected(conflict);
      return conflict;
    }
    
    this.cleanupOldOperations();
    return null;
  }

  detectConflict(newOperation) {
    const now = Date.now();
    const operations = newOperation.isLocal ? this.remoteOperations : this.localOperations;
    
    for (const existingOp of operations) {
      if (this.isInConflictRange(newOperation, existingOp, now)) {
        return this.createConflict(newOperation, existingOp);
      }
    }
    
    return null;
  }

  isInConflictRange(op1, op2, now) {
    if (Math.abs(now - op1.timestamp) > this.conflictWindowMs ||
        Math.abs(now - op2.timestamp) > this.conflictWindowMs) {
      return false;
    }
    
    if (op1.type !== op2.type) {
      return false;
    }
    
    const distance = Math.abs(op1.position - op2.position);
    return distance <= this.conflictRangeThreshold;
  }

  createConflict(localOp, remoteOp) {
    this.conflictIdCounter++;
    const conflictId = `conflict-${this.conflictIdCounter}`;
    
    const localOperation = localOp.isLocal ? localOp : remoteOp;
    const remoteOperation = localOp.isLocal ? remoteOp : localOp;
    
    const startPosition = Math.min(localOperation.position, remoteOperation.position);
    const endPosition = Math.max(
      localOperation.position + (localOperation.value ? localOperation.value.length : 1),
      remoteOperation.position + (remoteOperation.value ? remoteOperation.value.length : 1)
    );
    
    return {
      id: conflictId,
      timestamp: Date.now(),
      startPosition,
      endPosition,
      localOperation: {
        ...localOperation,
        preview: this.getOperationPreview(localOperation)
      },
      remoteOperation: {
        ...remoteOperation,
        preview: this.getOperationPreview(remoteOperation),
        fromUserId: remoteOperation.fromUserId
      },
      resolved: false
    };
  }

  getOperationPreview(operation) {
    if (operation.type === 'insert') {
      return `Insert: "${operation.value}"`;
    } else if (operation.type === 'delete') {
      return `Delete at position ${operation.position}`;
    }
    return operation.type;
  }

  cleanupOldOperations() {
    const now = Date.now();
    const cutoff = now - this.conflictWindowMs * 2;
    
    this.localOperations = this.localOperations.filter(op => op.timestamp >= cutoff);
    this.remoteOperations = this.remoteOperations.filter(op => op.timestamp >= cutoff);
  }

  getActiveConflicts() {
    return Array.from(this.activeConflicts.values()).filter(c => !c.resolved);
  }

  resolveConflict(conflictId, choice) {
    const conflict = this.activeConflicts.get(conflictId);
    if (!conflict) {
      return null;
    }
    
    conflict.resolved = true;
    conflict.resolvedChoice = choice;
    conflict.resolvedAt = Date.now();
    
    this.onConflictResolved(conflict);
    
    return conflict;
  }

  resolveAllConflicts(choice) {
    const resolved = [];
    for (const [id, conflict] of this.activeConflicts) {
      if (!conflict.resolved) {
        this.resolveConflict(id, choice);
        resolved.push(conflict);
      }
    }
    return resolved;
  }

  clearConflicts() {
    this.activeConflicts.clear();
    this.localOperations = [];
    this.remoteOperations = [];
  }
}

export default ConflictManager;
