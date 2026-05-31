class CRDTDocument {
  constructor(initialContent = '') {
    this.content = initialContent;
    this.version = 0;
    this.clock = 0;
  }

  insert(position, character, userId, clock) {
    const pos = Math.max(0, Math.min(position, this.content.length));
    this.content = this.content.slice(0, pos) + character + this.content.slice(pos);
    this.version++;
    this.clock = Math.max(this.clock, clock) + 1;
    return { position: pos, character, userId, clock: this.clock, type: 'insert' };
  }

  delete(position, userId, clock) {
    if (position < 0 || position >= this.content.length) return null;
    const deletedChar = this.content[position];
    this.content = this.content.slice(0, position) + this.content.slice(position + 1);
    this.version++;
    this.clock = Math.max(this.clock, clock) + 1;
    return { position, character: deletedChar, userId, clock: this.clock, type: 'delete' };
  }

  applyOperation(op) {
    if (op.type === 'insert') {
      this.insert(op.position, op.character, op.userId, op.clock);
    } else if (op.type === 'delete') {
      this.delete(op.position, op.userId, op.clock);
    }
  }

  getContent() {
    return this.content;
  }

  getState() {
    return {
      content: this.content,
      version: this.version,
      clock: this.clock
    };
  }

  setState(state) {
    this.content = state.content || '';
    this.version = state.version || 0;
    this.clock = state.clock || 0;
  }
}

class CRDTManager {
  constructor() {
    this.documents = new Map();
  }

  getOrCreateDocument(fileId, initialContent = '') {
    if (!this.documents.has(fileId)) {
      this.documents.set(fileId, new CRDTDocument(initialContent));
    }
    return this.documents.get(fileId);
  }

  deleteDocument(fileId) {
    this.documents.delete(fileId);
  }

  applyOperation(fileId, op) {
    const doc = this.getOrCreateDocument(fileId);
    doc.applyOperation(op);
    return doc.getState();
  }

  getDocumentState(fileId) {
    const doc = this.documents.get(fileId);
    return doc ? doc.getState() : null;
  }
}

module.exports = { CRDTDocument, CRDTManager };
