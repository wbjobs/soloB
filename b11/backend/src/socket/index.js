const { authenticateSocket } = require('../middleware/auth');
const roomService = require('../services/roomService');
const fileService = require('../services/fileService');
const { OTManager } = require('../utils/ot');

const otManager = new OTManager();
const userVersions = new Map();
const operationBuffer = new Map();
const MAX_BUFFER_SIZE = 100;

const setupSocket = (io) => {
  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user.id}`);
    let currentRoomId = null;
    let reconnecting = false;

    socket.on('join-room', ({ roomId, reconnect = false, lastVersions = {} }) => {
      const room = roomService.getRoom(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      if (currentRoomId && currentRoomId !== roomId) {
        socket.leave(currentRoomId);
        roomService.leaveRoom(currentRoomId, socket.user.id);
        broadcastUserLeave(io, currentRoomId, socket.user.id);
      }

      socket.join(roomId);
      currentRoomId = roomId;
      reconnecting = reconnect;

      if (!room.users.has(socket.user.id)) {
        roomService.joinRoom(roomId, socket.user.id);
      }

      const users = roomService.getRoomUsers(roomId);
      const structure = fileService.getStructure(room);
      const cursors = roomService.getRoomCursors(roomId);

      socket.emit('room-state', {
        users,
        structure,
        cursors,
        self: {
          id: socket.user.id,
          color: room.users.get(socket.user.id)?.color
        },
        reconnect
      });

      Object.entries(lastVersions).forEach(([fileId, version]) => {
        const ops = otManager.getOperationsSince(fileId, version);
        if (ops.length > 0) {
          socket.emit('catchup-operations', {
            fileId,
            operations: ops,
            fromVersion: version
          });
        }
      });

      if (!reconnecting) {
        broadcastUserJoin(io, roomId, socket.user);
      } else {
        io.to(roomId).emit('user-reconnected', {
          userId: socket.user.id
        });
      }
    });

    socket.on('leave-room', () => {
      if (currentRoomId) {
        roomService.leaveRoom(currentRoomId, socket.user.id);
        socket.leave(currentRoomId);
        broadcastUserLeave(io, currentRoomId, socket.user.id);
        currentRoomId = null;
      }
    });

    socket.on('cursor-update', ({ fileId, position, selection }) => {
      if (!currentRoomId) return;

      roomService.updateCursor(currentRoomId, socket.user.id, {
        fileId,
        position,
        selection,
        updatedAt: Date.now()
      });

      socket.to(currentRoomId).emit('cursor-update', {
        userId: socket.user.id,
        fileId,
        position,
        selection
      });
    });

    socket.on('operation', ({ fileId, operation, clientVersion }) => {
      if (!currentRoomId) return;

      if (!roomService.canEdit(currentRoomId, socket.user.id)) {
        socket.emit('error', { message: 'Permission denied' });
        return;
      }

      const room = roomService.getRoom(currentRoomId);
      const fileData = fileService.getFileContent(room, fileId);

      if (!fileData) {
        socket.emit('error', { message: 'File not found' });
        return;
      }

      const opWithClientId = {
        ...operation,
        clientId: socket.user.id
      };

      const result = otManager.applyOperation(fileId, opWithClientId, clientVersion);

      if (result.success) {
        fileService.updateFileContent(room, fileId, result.state.content);

        const bufferKey = `${currentRoomId}-${fileId}`;
        if (!operationBuffer.has(bufferKey)) {
          operationBuffer.set(bufferKey, []);
        }
        const buffer = operationBuffer.get(bufferKey);
        buffer.push({
          op: result.op,
          timestamp: Date.now()
        });
        if (buffer.length > MAX_BUFFER_SIZE) {
          buffer.shift();
        }

        socket.emit('operation-ack', {
          fileId,
          serverVersion: result.state.version,
          op: result.op
        });

        socket.to(currentRoomId).emit('operation', {
          userId: socket.user.id,
          fileId,
          operation: result.op,
          state: result.state
        });
      } else {
        socket.emit('operation-error', {
          fileId,
          error: result.error,
          state: otManager.getDocumentState(fileId)
        });
      }
    });

    socket.on('batch-operations', ({ fileId, operations, clientVersion }) => {
      if (!currentRoomId) return;
      if (!roomService.canEdit(currentRoomId, socket.user.id)) {
        socket.emit('error', { message: 'Permission denied' });
        return;
      }

      const room = roomService.getRoom(currentRoomId);
      const fileData = fileService.getFileContent(room, fileId);
      if (!fileData) return;

      for (const op of operations) {
        const opWithClientId = { ...op, clientId: socket.user.id };
        otManager.applyOperation(fileId, opWithClientId, clientVersion);
      }

      const finalState = otManager.getDocumentState(fileId);
      fileService.updateFileContent(room, fileId, finalState.content);

      socket.emit('batch-ack', { fileId, finalState });
      socket.to(currentRoomId).emit('operation', {
        userId: socket.user.id,
        fileId,
        operation: operations[operations.length - 1],
        state: finalState
      });
    });

    socket.on('sync-request', ({ fileId, clientVersion }) => {
      if (!currentRoomId) return;

      const room = roomService.getRoom(currentRoomId);
      const fileData = fileService.getFileContent(room, fileId);

      if (!fileData) {
        socket.emit('error', { message: 'File not found' });
        return;
      }

      const state = otManager.getOrCreateDocument(fileId, fileData.content).getState();
      const missingOps = otManager.getOperationsSince(fileId, clientVersion);

      socket.emit('sync-response', {
        fileId,
        serverState: state,
        missingOperations: missingOps
      });
    });

    socket.on('file-operation', ({ action, payload, timestamp, expectedVersion }) => {
      if (!currentRoomId) return;

      if (['create', 'delete', 'rename', 'move', 'reorder'].includes(action)) {
        if (!roomService.canEdit(currentRoomId, socket.user.id)) {
          socket.emit('error', { message: 'Permission denied' });
          return;
        }
      }

      const room = roomService.getRoom(currentRoomId);
      let result;

      const options = expectedVersion !== undefined ? { expectedVersion } : {};

      switch (action) {
        case 'create':
          result = fileService.createFile(room, currentRoomId, payload.parentId, payload.name, payload.type, '', options);
          break;
        case 'delete':
          result = fileService.deleteNode(room, currentRoomId, payload.nodeId, options);
          break;
        case 'rename':
          result = fileService.renameNode(room, currentRoomId, payload.nodeId, payload.newName, options);
          break;
        case 'move':
          result = fileService.moveNode(room, currentRoomId, payload.nodeId, payload.newParentId, payload.targetIndex, options);
          break;
        case 'reorder':
          result = fileService.reorderNode(room, currentRoomId, payload.nodeId, payload.newOrder, options);
          break;
        case 'open':
          result = fileService.getFileContent(room, payload.fileId);
          if (result) {
            socket.emit('file-opened', {
              fileId: payload.fileId,
              content: result.content,
              language: result.language,
              serverState: otManager.getOrCreateDocument(payload.fileId, result.content).getState(),
              structureVersion: fileService.getStructureVersion(currentRoomId)
            });
          }
          return;
        default:
          return;
      }

      if (result && result.error) {
        if (result.retry) {
          socket.emit('file-operation-error', {
            error: result.error,
            action,
            currentVersion: result.currentVersion,
            latestStructure: fileService.getStructure(room)
          });
        } else {
          socket.emit('error', { message: result.error });
        }
        return;
      }

      io.to(currentRoomId).emit('file-operation', {
        userId: socket.user.id,
        action,
        payload,
        structure: result.structure || fileService.getStructure(room),
        version: result.version,
        timestamp: timestamp || Date.now()
      });

      socket.emit('file-op-ack', {
        action,
        structure: result.structure || fileService.getStructure(room),
        version: result.version
      });
    });

    socket.on('request-file', ({ fileId }) => {
      if (!currentRoomId) return;

      const room = roomService.getRoom(currentRoomId);
      const fileData = fileService.getFileContent(room, fileId);

      if (fileData) {
        const doc = otManager.getOrCreateDocument(fileId, fileData.content);
        socket.emit('file-state', {
          fileId,
          state: doc.getState()
        });
      }
    });

    socket.on('request-full-state', ({ roomId }) => {
      const room = roomService.getRoom(roomId);
      if (!room) return;

      const fileStates = {};
      room.files.forEach((data, fileId) => {
        const doc = otManager.getOrCreateDocument(fileId, data.content);
        fileStates[fileId] = doc.getState();
      });

      socket.emit('full-state', {
        structure: fileService.getStructure(room),
        fileStates,
        users: roomService.getRoomUsers(roomId),
        cursors: roomService.getRoomCursors(roomId)
      });
    });

    socket.on('disconnect', (reason) => {
      console.log(`User disconnected: ${socket.user.id}, reason: ${reason}`);
      if (currentRoomId) {
        const userData = roomService.getRoom(currentRoomId)?.users?.get(socket.user.id);
        if (userData) {
          if (reason === 'client namespace disconnect' || reason === 'server namespace disconnect') {
            roomService.leaveRoom(currentRoomId, socket.user.id);
            broadcastUserLeave(io, currentRoomId, socket.user.id);
          } else {
            io.to(currentRoomId).emit('user-disconnected-temporarily', {
              userId: socket.user.id
            });
            setTimeout(() => {
              const room = roomService.getRoom(currentRoomId);
              if (room && room.users.has(socket.user.id)) {
                roomService.leaveRoom(currentRoomId, socket.user.id);
                broadcastUserLeave(io, currentRoomId, socket.user.id);
              }
            }, 30000);
          }
        }
      }
    });
  });
};

const broadcastUserJoin = (io, roomId, user) => {
  const room = roomService.getRoom(roomId);
  if (!room) return;

  const userData = room.users.get(user.id);
  if (userData) {
    io.to(roomId).emit('user-joined', {
      id: user.id,
      role: userData.role,
      color: userData.color
    });
  }
};

const broadcastUserLeave = (io, roomId, userId) => {
  io.to(roomId).emit('user-left', { userId });
};

module.exports = { setupSocket };
