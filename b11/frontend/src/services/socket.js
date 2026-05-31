import { io } from 'socket.io-client';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:3001';

class SocketService {
  constructor() {
    this.socket = null;
    this.listeners = new Map();
  }

  connect() {
    const token = localStorage.getItem('token');
    if (!token) return null;

    this.socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling']
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  on(event, callback) {
    if (!this.socket) return;
    this.socket.on(event, callback);
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  }

  off(event, callback) {
    if (!this.socket) return;
    this.socket.off(event, callback);
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  emit(event, data) {
    if (!this.socket) return;
    this.socket.emit(event, data);
  }

  joinRoom(roomId) {
    this.emit('join-room', { roomId });
  }

  leaveRoom() {
    this.emit('leave-room');
  }

  sendOperation(fileId, operation) {
    this.emit('operation', { fileId, operation });
  }

  sendCursorUpdate(fileId, position, selection) {
    this.emit('cursor-update', { fileId, position, selection });
  }

  sendFileOperation(action, payload) {
    this.emit('file-operation', { action, payload });
  }

  requestFile(fileId) {
    this.emit('request-file', { fileId });
  }
}

export const socketService = new SocketService();
