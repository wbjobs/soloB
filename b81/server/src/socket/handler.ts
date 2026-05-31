import { Server, Socket } from 'socket.io';
import { streamManager } from '../services/StreamManager';
import { videoProcessingQueue } from '../queues';
import { liveCaptionService } from '../services/LiveCaptionService';

export function setupSocketHandler(io: Server) {
  (global as any).io = io;

  io.on('connection', (socket: Socket) => {
    console.log('Client connected:', socket.id);

    socket.on('recorder:start', async ({ sessionId, title }) => {
      try {
        await streamManager.startSession(sessionId, title);
        socket.join(sessionId);
        io.to(sessionId).emit('recorder:started', { sessionId });
      } catch (error) {
        console.error('Error starting session:', error);
        socket.emit('error', { message: 'Failed to start recording' });
      }
    });

    socket.on('recorder:data', async ({ sessionId, data }) => {
      try {
        const buffer = Buffer.from(data);
        await streamManager.receiveData(sessionId, buffer);
      } catch (error) {
        console.error('Error receiving data:', error);
      }
    });

    socket.on('recorder:segment', async ({ sessionId }) => {
      try {
        await streamManager.startNewSegment(sessionId);
        io.to(sessionId).emit('recorder:segmented', { sessionId });
      } catch (error) {
        console.error('Error creating segment:', error);
      }
    });

    socket.on('recorder:syncInfo', async ({ sessionId, drift, trend, timestamp }) => {
      try {
        streamManager.addSyncInfo(sessionId, drift, trend, timestamp);
      } catch (error) {
        console.error('Error receiving sync info:', error);
      }
    });

    socket.on('recorder:audioChunk', async ({ sessionId, chunkId, startTime, endTime, audioData }) => {
      try {
        const buffer = Buffer.from(audioData);
        await liveCaptionService.saveAudioChunk({
          sessionId,
          chunkId,
          startTime,
          endTime,
          audioData: buffer,
        });
      } catch (error) {
        console.error('Error receiving audio chunk:', error);
      }
    });

    socket.on('caption:edit', async ({ sessionId, captionId, textZh, textEn }) => {
      try {
        await liveCaptionService.editCaption(captionId, sessionId, textZh, textEn);
      } catch (error) {
        console.error('Error editing caption:', error);
        socket.emit('error', { message: 'Failed to edit caption' });
      }
    });

    socket.on('recorder:stop', async ({ sessionId, finalDrift }) => {
      try {
        await streamManager.endSession(sessionId, finalDrift);
        await liveCaptionService.mergeEditedCaptionsToSubtitles(sessionId);
        await liveCaptionService.cleanupSessionChunks(sessionId);
        
        io.to(sessionId).emit('recorder:stopped', { sessionId });

        const driftInfo = streamManager.getSessionDriftInfo(sessionId);
        
        await videoProcessingQueue.add(
          { 
            sessionId, 
            driftInfo: driftInfo || { avgDrift: 0, trend: 'stable', driftHistory: [] } 
          },
          { priority: 10 }
        );

        io.to(sessionId).emit('processing:started', { sessionId });
      } catch (error) {
        console.error('Error stopping session:', error);
        socket.emit('error', { message: 'Failed to stop recording' });
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });
}
