class CRDTDocument {
  constructor(initialContent = '') {
    this.content = initialContent;
    this.version = 0;
    this.clock = 0;
    this.listeners = [];
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

  insert(position, character, userId) {
    const pos = Math.max(0, Math.min(position, this.content.length));
    this.content = this.content.slice(0, pos) + character + this.content.slice(pos);
    this.version++;
    this.clock++;

    const op = {
      position: pos,
      character,
      userId,
      clock: this.clock,
      type: 'insert'
    };

    this.emit('change', op);
    return op;
  }

  delete(position, userId) {
    if (position < 0 || position >= this.content.length) return null;

    const deletedChar = this.content[position];
    this.content = this.content.slice(0, position) + this.content.slice(position + 1);
    this.version++;
    this.clock++;

    const op = {
      position,
      character: deletedChar,
      userId,
      clock: this.clock,
      type: 'delete'
    };

    this.emit('change', op);
    return op;
  }

  applyOperation(op) {
    if (op.type === 'insert') {
      this.content = this.content.slice(0, op.position) + op.character + this.content.slice(op.position);
    } else if (op.type === 'delete') {
      if (op.position < this.content.length) {
        this.content = this.content.slice(0, op.position) + this.content.slice(op.position + 1);
      }
    }
    this.version++;
  }

  getContent() {
    return this.content;
  }

  setContent(content) {
    this.content = content;
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

export default CRDTDocument;
