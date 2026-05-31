const jwt = require('jsonwebtoken');
const Score = require('../../models/Score');

const rooms = new Map();
const messageCounters = new Map();

const getNextMessageId = (roomId) => {
  if (!messageCounters.has(roomId)) {
    messageCounters.set(roomId, 0);
  }
  const nextId = messageCounters.get(roomId) + 1;
  messageCounters.set(roomId, nextId);
  return nextId;
};

module.exports = (io) => {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('未授权'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      next();
    } catch (error) {
      next(new Error('Token 无效'));
    }
  });

  io.on('connection', (socket) => {
    console.log('用户连接:', socket.userId);

    socket.on('join-room', async ({ scoreId }) => {
      try {
        const score = await Score.findById(scoreId);
        if (!score) return;

        const collaborator = score.collaborators.find(
          c => c.userId.toString() === socket.userId.toString()
        );
        if (!collaborator) return;

        socket.join(scoreId);
        
        if (!rooms.has(scoreId)) {
          rooms.set(scoreId, new Set());
        }
        rooms.get(scoreId).add(socket.userId);

        io.to(scoreId).emit('user-connected', {
          userId: socket.userId,
          users: Array.from(rooms.get(scoreId))
        });

        socket.scoreId = scoreId;
      } catch (error) {
        console.error('加入房间失败:', error);
      }
    });

    socket.on('offer', ({ targetId, offer }) => {
      socket.to(targetId).emit('offer', {
        callerId: socket.userId,
        offer
      });
    });

    socket.on('answer', ({ targetId, answer }) => {
      socket.to(targetId).emit('answer', {
        callerId: socket.userId,
        answer
      });
    });

    socket.on('ice-candidate', ({ targetId, candidate }) => {
      socket.to(targetId).emit('ice-candidate', {
        callerId: socket.userId,
        candidate
      });
    });

    socket.on('annotation-add', (data) => {
      const messageId = getNextMessageId(socket.scoreId);
      const messageWithMeta = {
        ...data,
        messageId,
        timestamp: Date.now()
      };
      socket.to(socket.scoreId).emit('annotation-add', messageWithMeta);
    });

    socket.on('annotation-update', (data) => {
      const messageId = getNextMessageId(socket.scoreId);
      const messageWithMeta = {
        ...data,
        messageId,
        timestamp: Date.now()
      };
      socket.to(socket.scoreId).emit('annotation-update', messageWithMeta);
    });

    socket.on('annotation-delete', (data) => {
      const messageId = getNextMessageId(socket.scoreId);
      const messageWithMeta = {
        ...data,
        messageId,
        timestamp: Date.now()
      };
      socket.to(socket.scoreId).emit('annotation-delete', messageWithMeta);
    });

    socket.on('page-change', (data) => {
      socket.to(socket.scoreId).emit('page-change', data);
    });

    socket.on('disconnect', () => {
      console.log('用户断开连接:', socket.userId);
      
      if (socket.scoreId && rooms.has(socket.scoreId)) {
        rooms.get(socket.scoreId).delete(socket.userId);
        
        io.to(socket.scoreId).emit('user-disconnected', {
          userId: socket.userId,
          users: Array.from(rooms.get(socket.scoreId))
        });

        if (rooms.get(socket.scoreId).size === 0) {
          rooms.delete(socket.scoreId);
        }
      }
    });
  });
};
