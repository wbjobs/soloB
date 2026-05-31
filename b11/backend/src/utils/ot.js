class OTDocument {
  constructor(initialContent = '') {
    this.content = initialContent;
    this.version = 0;
    this.operationQueue = [];
    this.pendingOps = new Map();
  }

  insert(position, character, clientId, opVersion) {
    const pos = Math.max(0, Math.min(position, this.content.length));
    this.content = this.content.slice(0, pos) + character + this.content.slice(pos);
    this.version++;

    const op = {
      type: 'insert',
      position: pos,
      character,
      clientId,
      version: this.version
    };

    this.operationQueue.push(op);
    if (this.operationQueue.length > 1000) {
      this.operationQueue.shift();
    }

    return op;
  }

  delete(position, clientId, opVersion) {
    if (position < 0 || position >= this.content.length) return null;

    const deletedChar = this.content[position];
    this.content = this.content.slice(0, position) + this.content.slice(position + 1);
    this.version++;

    const op = {
      type: 'delete',
      position,
      character: deletedChar,
      clientId,
      version: this.version
    };

    this.operationQueue.push(op);
    if (this.operationQueue.length > 1000) {
      this.operationQueue.shift();
    }

    return op;
  }

  transformAgainst(op1, op2) {
    if (op1.type === 'insert' && op2.type === 'insert') {
      if (op1.position === op2.position) {
        return op1.clientId < op2.clientId
          ? { ...op1, position: op1.position }
          : { ...op1, position: op1.position + 1 };
      }
      if (op1.position < op2.position) {
        return op1;
      }
      return { ...op1, position: op1.position + 1 };
    }

    if (op1.type === 'insert' && op2.type === 'delete') {
      if (op1.position <= op2.position) {
        return op1;
      }
      return { ...op1, position: op1.position - 1 };
    }

    if (op1.type === 'delete' && op2.type === 'insert') {
      if (op1.position < op2.position) {
        return op1;
      }
      return { ...op1, position: op1.position + 1 };
    }

    if (op1.type === 'delete' && op2.type === 'delete') {
      if (op1.position < op2.position) {
        return op1;
      }
      if (op1.position > op2.position) {
        return { ...op1, position: op1.position - 1 };
      }
      return null;
    }

    return op1;
  }

  applyRemoteOperation(remoteOp, clientVersion) {
    if (remoteOp.version <= clientVersion) {
      return { applied: false, reason: 'version_too_old' };
    }

    let transformedOp = { ...remoteOp };
    const startIndex = Math.max(0, clientVersion - (this.operationQueue.length - 1) > 0
      ? 0
      : this.operationQueue.findIndex(op => op.version > clientVersion));

    for (let i = startIndex; i < this.operationQueue.length; i++) {
      const localOp = this.operationQueue[i];
      if (localOp.version >= remoteOp.version) break;

      const newOp = this.transformAgainst(transformedOp, localOp);
      if (!newOp) {
        return { applied: false, reason: 'operation_cancelled' };
      }
      transformedOp = newOp;
    }

    if (transformedOp.type === 'insert') {
      const pos = Math.max(0, Math.min(transformedOp.position, this.content.length));
      this.content = this.content.slice(0, pos) + transformedOp.character + this.content.slice(pos);
      this.version++;
      transformedOp.version = this.version;
      this.operationQueue.push(transformedOp);
    } else if (transformedOp.type === 'delete') {
      if (transformedOp.position >= 0 && transformedOp.position < this.content.length) {
        this.content = this.content.slice(0, transformedOp.position) + this.content.slice(transformedOp.position + 1);
        this.version++;
        transformedOp.version = this.version;
        this.operationQueue.push(transformedOp);
      } else {
        return { applied: false, reason: 'invalid_position' };
      }
    }

    if (this.operationQueue.length > 1000) {
      this.operationQueue.shift();
    }

    return {
      applied: true,
      op: transformedOp,
      currentVersion: this.version
    };
  }

  batchApplyOperations(ops, clientVersion) {
    const results = [];
    let currentVersion = clientVersion;

    for (const op of ops) {
      const result = this.applyRemoteOperation(op, currentVersion);
      results.push(result);
      if (result.applied) {
        currentVersion = result.currentVersion;
      }
    }

    return {
      results,
      finalVersion: this.version,
      finalContent: this.content
    };
  }

  getOperationsSince(sinceVersion) {
    return this.operationQueue.filter(op => op.version > sinceVersion);
  }

  getContent() {
    return this.content;
  }

  getState() {
    return {
      content: this.content,
      version: this.version
    };
  }

  setState(state) {
    this.content = state.content || '';
    this.version = state.version || 0;
    this.operationQueue = [];
  }
}

class OTManager {
  constructor() {
    this.documents = new Map();
  }

  getOrCreateDocument(fileId, initialContent = '') {
    if (!this.documents.has(fileId)) {
      this.documents.set(fileId, new OTDocument(initialContent));
    }
    return this.documents.get(fileId);
  }

  deleteDocument(fileId) {
    this.documents.delete(fileId);
  }

  applyOperation(fileId, op, clientVersion = 0) {
    const doc = this.getOrCreateDocument(fileId);

    if (op.type === 'insert') {
      const result = doc.insert(op.position, op.character, op.clientId, clientVersion);
      return { success: true, op: result, state: doc.getState() };
    } else if (op.type === 'delete') {
      const result = doc.delete(op.position, op.clientId, clientVersion);
      return { success: !!result, op: result, state: doc.getState() };
    }

    return { success: false, error: 'unknown_operation' };
  }

  applyRemoteOperation(fileId, op, clientVersion) {
    const doc = this.getOrCreateDocument(fileId);
    return doc.applyRemoteOperation(op, clientVersion);
  }

  getDocumentState(fileId) {
    const doc = this.documents.get(fileId);
    return doc ? doc.getState() : null;
  }

  getOperationsSince(fileId, sinceVersion) {
    const doc = this.documents.get(fileId);
    return doc ? doc.getOperationsSince(sinceVersion) : [];
  }
}

module.exports = { OTDocument, OTManager };
