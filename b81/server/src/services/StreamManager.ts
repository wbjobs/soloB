import fs from 'fs';
import path from 'path';
import { paths } from '../utils/config';
import prisma from '../utils/prisma';

interface SyncInfo {
  drift: number;
  trend: string;
  timestamp: number;
}

interface ActiveSession {
  sessionId: string;
  currentSegment: number;
  currentFile: fs.WriteStream | null;
  startTime: number;
  segmentStartTime: number;
  syncInfo: SyncInfo[];
  videoFrameCount: number;
  audioSampleCount: number;
  lastVideoTime: number;
  lastAudioTime: number;
  initialVideoTimeBase: number;
  initialAudioTimeBase: number;
  totalDrift: number;
  segmentDriftLog: { segment: number; drift: number; timestamp: number }[];
}

class StreamManager {
  private sessions: Map<string, ActiveSession> = new Map();

  async startSession(sessionId: string, title: string): Promise<void> {
    const now = Date.now();
    
    await prisma.recordingSession.create({
      data: {
        id: sessionId,
        title,
        startedAt: new Date(),
        status: 'recording',
      },
    });

    const session: ActiveSession = {
      sessionId,
      currentSegment: 1,
      currentFile: null,
      startTime: now,
      segmentStartTime: 0,
      syncInfo: [],
      videoFrameCount: 0,
      audioSampleCount: 0,
      lastVideoTime: 0,
      lastAudioTime: 0,
      initialVideoTimeBase: now,
      initialAudioTimeBase: now,
      totalDrift: 0,
      segmentDriftLog: [],
    };

    this.sessions.set(sessionId, session);
    await this.startNewSegment(sessionId);
  }

  async startNewSegment(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.currentFile) {
      await this.closeCurrentFile(session);
    }

    const segmentNumber = session.currentSegment;
    const fileName = `${sessionId}_segment_${segmentNumber}.webm`;
    const filePath = path.join(paths.temp, fileName);

    session.currentFile = fs.createWriteStream(filePath);
    session.segmentStartTime = Date.now() - session.startTime;

    await prisma.videoSegment.create({
      data: {
        sessionId,
        segmentNumber,
        startTime: session.segmentStartTime,
        filePath,
      },
    });

    session.currentSegment++;
  }

  async receiveData(sessionId: string, data: Buffer): void {
    const session = this.sessions.get(sessionId);
    if (session?.currentFile) {
      session.currentFile.write(data);
    }
  }

  private async closeCurrentFile(session: ActiveSession): Promise<void> {
    if (session.currentFile) {
      session.currentFile.end();
      session.currentFile = null;

      const segment = await prisma.videoSegment.findFirst({
        where: {
          sessionId: session.sessionId,
          segmentNumber: session.currentSegment - 1,
        },
      });

      if (segment) {
        const stats = fs.statSync(segment.filePath);
        const duration = Date.now() - session.startTime - segment.startTime;
        
        await prisma.videoSegment.update({
          where: { id: segment.id },
          data: {
            sizeBytes: stats.size,
            duration: Math.floor(duration),
          },
        });
      }
    }
  }

  addSyncInfo(sessionId: string, drift: number, trend: string, timestamp: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.syncInfo.push({ drift, trend, timestamp });
    session.totalDrift += drift;

    if (session.syncInfo.length > 100) {
      session.syncInfo = session.syncInfo.slice(-50);
    }
  }

  getAverageDrift(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    if (!session || session.syncInfo.length === 0) return 0;
    
    return session.syncInfo.reduce((sum, info) => sum + info.drift, 0) / session.syncInfo.length;
  }

  getDriftTrend(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session || session.syncInfo.length < 5) return 'stable';
    
    const recent = session.syncInfo.slice(-5);
    const recentAvg = recent.reduce((sum, info) => sum + info.drift, 0) / recent.length;
    
    if (recentAvg > 500) return 'increasing';
    if (recentAvg < -500) return 'decreasing';
    return 'stable';
  }

  async endSession(sessionId: string, finalDrift?: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    await this.closeCurrentFile(session);

    const totalDuration = Date.now() - session.startTime;
    const avgDrift = finalDrift ?? this.getAverageDrift(sessionId);
    const trend = this.getDriftTrend(sessionId);

    await prisma.recordingSession.update({
      where: { id: sessionId },
      data: {
        endedAt: new Date(),
        duration: Math.floor(totalDuration),
        status: 'processing',
        metadata: {
          avgDrift,
          trend,
          totalSegments: session.currentSegment,
          driftHistory: session.segmentDriftLog,
        } as any,
      },
    });

    this.sessions.delete(sessionId);
  }

  getSession(sessionId: string): ActiveSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionDriftInfo(sessionId: string): { avgDrift: number; trend: string; driftHistory: any[] } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      avgDrift: this.getAverageDrift(sessionId),
      trend: this.getDriftTrend(sessionId),
      driftHistory: session.segmentDriftLog,
    };
  }
}

export const streamManager = new StreamManager();
