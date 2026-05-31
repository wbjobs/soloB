class OTDocument {
  constructor(initialContent = '') {
    this.content = initialContent;
    this.version = 0;
    this.pendingOps = [];
    this.acknowledgedOps = [];
    this.listeners = [];
    this.isApplyingRemote = false;
    this.opBuffer = [];
  }

  on(event, callback) {
    if (event === 'change') {
      this.listeners.push(callback);
    }
  }

  off(event, callback) {
    if (event === 'change') {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    }
  }

  emit(event, data) {
    if (event === 'change') {
      this.listeners.forEach(cb => cb(data));
    }
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

  insert(position, character, clientId) {
    const pos = Math.max(0, Math.min(position, this.content.length));
    this.content = this.content.slice(0, pos) + character + this.content.slice(pos);
    this.version++;

    const op = {
      type: 'insert',
      position: pos,
      character,
      clientId,
      version: this.version,
      timestamp: Date.now()
    };

    this.pendingOps.push(op);
    this.emit('change', op);
    return op;
  }

  delete(position, clientId) {
    if (position < 0 || position >= this.content.length) return null;

    const deletedChar = this.content[position];
    this.content = this.content.slice(0, position) + this.content.slice(position + 1);
    this.version++;

    const op = {
      type: 'delete',
      position,
      character: deletedChar,
      clientId,
      version: this.version,
      timestamp: Date.now()
    };

    this.pendingOps.push(op);
    this.emit('change', op);
    return op;
  }

  applyRemoteOperation(remoteOp, clientId) {
    this.isApplyingRemote = true;

    let transformedRemote = { ...remoteOp };
    for (const pending of this.pendingOps) {
      const newOp = this.transformAgainst(transformedRemote, pending);
      if (!newOp) {
        this.isApplyingRemote = false;
        return { applied: false, reason: 'cancelled' };
      }
      transformedRemote = newOp;
    }

    const transformedPendings = [];
    for (const pending of this.pendingOps) {
      const newOp = this.transformAgainst(pending, transformedRemote);
      if (newOp) {
        transformedPendings.push(newOp);
      }
    }
    this.pendingOps = transformedPendings;

    let editorTransform = transformedRemote;
    for (const ack of this.acknowledgedOps) {
      if (ack.clientId !== clientId) {
        const newOp = this.transformAgainst(editorTransform, ack);
        if (!newOp) {
          this.isApplyingRemote = false;
          return { applied: false, reason: 'cancelled' };
        }
        editorTransform = newOp;
      }
    }

    if (transformedRemote.type === 'insert') {
      const pos = Math.max(0, Math.min(transformedRemote.position, this.content.length));
      this.content = this.content.slice(0, pos) + transformedRemote.character + this.content.slice(pos);
      this.version++;
    } else if (transformedRemote.type === 'delete') {
      if (transformedRemote.position >= 0 && transformedRemote.position < this.content.length) {
        this.content = this.content.slice(0, transformedRemote.position) + this.content.slice(transformedRemote.position + 1);
        this.version++;
      } else {
        this.isApplyingRemote = false;
        return { applied: false, reason: 'invalid_position' };
      }
    }

    this.acknowledgedOps.push(transformedRemote);
    if (this.acknowledgedOps.length > 100) {
      this.acknowledgedOps.shift();
    }

    this.isApplyingRemote = false;
    return { applied: true, op: editorTransform };
  }

  acknowledgeOp(opVersion) {
    const index = this.pendingOps.findIndex(op => op.version === opVersion);
    if (index !== -1) {
      const acknowledged = this.pendingOps.splice(index, 1)[0];
      this.acknowledgedOps.push(acknowledged);
      if (this.acknowledgedOps.length > 100) {
        this.acknowledgedOps.shift();
      }
    }
  }

  getPendingOps() {
    return [...this.pendingOps];
  }

  getContent() {
    return this.content;
  }

  setContent(content) {
    this.content = content;
    this.pendingOps = [];
    this.acknowledgedOps = [];
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
    this.pendingOps = [];
    this.acknowledgedOps = [];
  }

  isInRemoteApply() {
    return this.isApplyingRemote;
  }
}

export default OTDocument;
