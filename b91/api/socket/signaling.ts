import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server } from 'http';

interface ClientToServerEvents {
  'join-room': (roomId: string, userId: string) => void;
  'leave-room': (roomId: string, userId: string) => void;
  'offer': (data: { target: string; offer: RTCSessionDescriptionInit }) => void;
  'answer': (data: { target: string; answer: RTCSessionDescriptionInit }) => void;
  'ice-candidate': (data: { target: string; candidate: RTCIceCandidateInit }) => void;
  'toggle-video': (roomId: string, userId: string, enabled: boolean) => void;
  'toggle-audio': (roomId: string, userId: string, enabled: boolean) => void;
}

interface ServerToClientEvents {
  'user-joined': (userId: string) => void;
  'user-left': (userId: string) => void;
  'offer': (data: { from: string; offer: RTCSessionDescriptionInit }) => void;
  'answer': (data: { from: string; answer: RTCSessionDescriptionInit }) => void;
  'ice-candidate': (data: { from: string; candidate: RTCIceCandidateInit }) => void;
  'participants': (userIds: string[]) => void;
  'video-toggled': (userId: string, enabled: boolean) => void;
  'audio-toggled': (userId: string, enabled: boolean) => void;
}

const roomParticipants: Map<string, Set<string>> = new Map();

export const setupSignaling = (httpServer: Server) => {
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket: Socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', (roomId: string, userId: string) => {
      socket.join(roomId);
      
      if (!roomParticipants.has(roomId)) {
        roomParticipants.set(roomId, new Set());
      }
      const participants = roomParticipants.get(roomId)!;
      
      participants.add(userId);
      
      socket.to(roomId).emit('user-joined', userId);
      
      socket.emit('participants', Array.from(participants));
      
      console.log(`User ${userId} joined room ${roomId}`);
    });

    socket.on('leave-room', (roomId: string, userId: string) => {
      socket.leave(roomId);
      
      const participants = roomParticipants.get(roomId);
      if (participants) {
        participants.delete(userId);
        if (participants.size === 0) {
          roomParticipants.delete(roomId);
        }
      }
      
      socket.to(roomId).emit('user-left', userId);
      
      console.log(`User ${userId} left room ${roomId}`);
    });

    socket.on('offer', (data: { target: string; offer: RTCSessionDescriptionInit }) => {
      socket.to(data.target).emit('offer', {
        from: socket.id,
        offer: data.offer
      });
    });

    socket.on('answer', (data: { target: string; answer: RTCSessionDescriptionInit }) => {
      socket.to(data.target).emit('answer', {
        from: socket.id,
        answer: data.answer
      });
    });

    socket.on('ice-candidate', (data: { target: string; candidate: RTCIceCandidateInit }) => {
      socket.to(data.target).emit('ice-candidate', {
        from: socket.id,
        candidate: data.candidate
      });
    });

    socket.on('toggle-video', (roomId: string, userId: string, enabled: boolean) => {
      socket.to(roomId).emit('video-toggled', userId, enabled);
    });

    socket.on('toggle-audio', (roomId: string, userId: string, enabled: boolean) => {
      socket.to(roomId).emit('audio-toggled', userId, enabled);
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });

  return io;
};
