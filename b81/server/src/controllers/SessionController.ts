import { Request, Response } from 'express';
import fs from 'fs';
import prisma from '../utils/prisma';
import { videoProcessingQueue } from '../queues';

export const SessionController = {
  async getAll(req: Request, res: Response) {
    try {
      const sessions = await prisma.recordingSession.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { segments: true, subtitles: true },
          },
        },
      });

      res.json({ success: true, data: sessions });
    } catch (error) {
      console.error('Error fetching sessions:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch sessions' });
    }
  },

  async getOne(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const session = await prisma.recordingSession.findUnique({
        where: { id },
        include: {
          segments: { orderBy: { segmentNumber: 'asc' } },
          subtitles: { orderBy: { startTime: 'asc' } },
          processingTasks: { orderBy: { createdAt: 'desc' } },
        },
      });

      if (!session) {
        return res.status(404).json({ success: false, error: 'Session not found' });
      }

      res.json({ success: true, data: session });
    } catch (error) {
      console.error('Error fetching session:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch session' });
    }
  },

  async streamVideo(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const session = await prisma.recordingSession.findUnique({
        where: { id },
        select: { videoPath: true, status: true },
      });

      if (!session || !session.videoPath) {
        return res.status(404).json({ success: false, error: 'Video not found' });
      }

      if (session.status !== 'completed') {
        return res.status(400).json({ success: false, error: 'Video not ready yet' });
      }

      if (!fs.existsSync(session.videoPath)) {
        return res.status(404).json({ success: false, error: 'Video file not found' });
      }

      const stat = fs.statSync(session.videoPath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        const file = fs.createReadStream(session.videoPath, { start, end });
        
        const head = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'video/mp4',
        };

        res.writeHead(206, head);
        file.pipe(res);
      } else {
        const head = {
          'Content-Length': fileSize,
          'Content-Type': 'video/mp4',
        };
        res.writeHead(200, head);
        fs.createReadStream(session.videoPath).pipe(res);
      }
    } catch (error) {
      console.error('Error streaming video:', error);
      res.status(500).json({ success: false, error: 'Failed to stream video' });
    }
  },

  async getSubtitles(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const subtitles = await prisma.subtitle.findMany({
        where: { sessionId: id },
        orderBy: { startTime: 'asc' },
      });

      res.json({ success: true, data: subtitles });
    } catch (error) {
      console.error('Error fetching subtitles:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch subtitles' });
    }
  },

  async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const session = await prisma.recordingSession.findUnique({
        where: { id },
        include: { segments: true },
      });

      if (!session) {
        return res.status(404).json({ success: false, error: 'Session not found' });
      }

      if (session.videoPath && fs.existsSync(session.videoPath)) {
        fs.unlinkSync(session.videoPath);
      }

      session.segments.forEach((segment) => {
        if (fs.existsSync(segment.filePath)) {
          fs.unlinkSync(segment.filePath);
        }
      });

      await prisma.recordingSession.delete({ where: { id } });

      res.json({ success: true, message: 'Session deleted successfully' });
    } catch (error) {
      console.error('Error deleting session:', error);
      res.status(500).json({ success: false, error: 'Failed to delete session' });
    }
  },

  async retryProcessing(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const session = await prisma.recordingSession.findUnique({
        where: { id },
      });

      if (!session) {
        return res.status(404).json({ success: false, error: 'Session not found' });
      }

      await prisma.recordingSession.update({
        where: { id },
        data: { status: 'processing' },
      });

      await videoProcessingQueue.add(
        { sessionId: id },
        { priority: 10 }
      );

      res.json({ success: true, message: 'Processing retry initiated' });
    } catch (error) {
      console.error('Error retrying processing:', error);
      res.status(500).json({ success: false, error: 'Failed to retry processing' });
    }
  },
};
