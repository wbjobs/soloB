import { io } from 'socket.io-client';

class SyncManager {
  constructor() {
    this.socket = null;
    this.documentId = null;
    this.callbacks = {};
    this.pendingOperations = [];
    this.isProcessing = false;
    this.localChanges = [];
    this.isApplyingRemote = false;
  }

  connect(documentId, callbacks = {}) {
    this.documentId = documentId;
    this.callbacks = {
      onContentChange: callbacks.onContentChange || (() => {}),
      onUserJoined: callbacks.onUserJoined || (() => {}),
      onUserLeft: callbacks.onUserLeft || (() => {}),
      onHistoryReceived: callbacks.onHistoryReceived || (() => {}),
      onVersionRestored: callbacks.onVersionRestored || (() => {}),
      onError: callbacks.onError || (() => {})
    };

    this.socket = io('http://localhost:3001', {
      transports: ['websocket', 'polling']
    });

    this.socket.on('connect', () => {
      console.log('Connected to server');
      this.socket.emit('join-document', { documentId });
    });

    this.socket.on('document-joined', (data) => {
      console.log('Document joined:', data);
      this.callbacks.onContentChange(data.content);
    });

    this.socket.on('operation', async (data) => {
      console.log('Received operation:', data);
      await this.processRemoteOperation(data);
    });

    this.socket.on('user-joined', (data) => {
      console.log('User joined:', data);
      this.callbacks.onUserJoined(data);
    });

    this.socket.on('user-left', (data) => {
      console.log('User left:', data);
      this.callbacks.onUserLeft(data);
    });

    this.socket.on('history', (data) => {
      console.log('History received:', data);
      this.callbacks.onHistoryReceived(data);
    });

    this.socket.on('version-restored', (data) => {
      console.log('Version restored:', data);
      this.callbacks.onVersionRestored(data);
    });

    this.socket.on('restore-error', (data) => {
      console.error('Restore error:', data);
      this.callbacks.onError(data.message);
    });

    this.socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      this.callbacks.onError('Connection error');
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from server');
    });
  }

  async processRemoteOperation(data) {
    this.isApplyingRemote = true;
    try {
      const { operation, from } = data;
      this.pendingOperations.push({ operation, isLocal: false, fromUserId: from });
      await this.processPendingOperations();
    } finally {
      this.isApplyingRemote = false;
    }
  }

  async processPendingOperations() {
    if (this.isProcessing || this.pendingOperations.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.pendingOperations.length > 0) {
      const { operation, isLocal, fromUserId } = this.pendingOperations.shift();
      await this.applyOperation(operation, isLocal, fromUserId);
    }

    this.isProcessing = false;
  }

  async applyOperation(operation, isLocal, fromUserId) {
    return new Promise((resolve) => {
      if (operation.type === 'insert') {
        this.insertCharacter(operation, isLocal, fromUserId, resolve);
      } else if (operation.type === 'delete') {
        this.deleteCharacter(operation, isLocal, fromUserId, resolve);
      } else {
        resolve();
      }
    });
  }

  insertCharacter(operation, isLocal, fromUserId, callback) {
    if (isLocal) {
      callback();
      return;
    }

    this.callbacks.onContentChange(null, {
      type: 'insert',
      operation
    }, fromUserId);
    callback();
  }

  deleteCharacter(operation, isLocal, fromUserId, callback) {
    if (isLocal) {
      callback();
      return;
    }

    this.callbacks.onContentChange(null, {
      type: 'delete',
      operation
    }, fromUserId);
    callback();
  }

  sendOperation(operation) {
    if (!this.socket || !this.socket.connected) {
      this.localChanges.push(operation);
      return;
    }

    this.socket.emit('operation', {
      documentId: this.documentId,
      operation
    });
  }

  getHistory() {
    if (this.socket && this.socket.connected) {
      this.socket.emit('get-history', { documentId: this.documentId });
    }
  }

  restoreVersion(version) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('restore-version', {
        documentId: this.documentId,
        version
      });
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  isRemoteApplying() {
    return this.isApplyingRemote;
  }
}

export default SyncManager;
