import fs from 'fs';
import path from 'path';
import { OpenAI } from 'openai';
import prisma from '../utils/prisma';
import { paths, config } from '../utils/config';
import { liveCaptionQueue } from '../queues';

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

export interface AudioChunkData {
  sessionId: string;
  chunkId: string;
  startTime: number;
  endTime: number;
  audioData: Buffer;
}

export class LiveCaptionService {
  private static instance: LiveCaptionService;

  private constructor() {}

  static getInstance(): LiveCaptionService {
    if (!LiveCaptionService.instance) {
      LiveCaptionService.instance = new LiveCaptionService();
    }
    return LiveCaptionService.instance;
  }

  async saveAudioChunk(data: AudioChunkData): Promise<string> {
    const audioDir = path.join(paths.temp, data.sessionId, 'audio');
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }

    const filePath = path.join(audioDir, `${data.chunkId}.webm`);
    fs.writeFileSync(filePath, data.audioData);

    const audioChunk = await prisma.audioChunk.create({
      data: {
        id: data.chunkId,
        sessionId: data.sessionId,
        filePath,
        startTime: data.startTime,
        endTime: data.endTime,
        duration: data.endTime - data.startTime,
        sizeBytes: data.audioData.length,
      },
    });

    await liveCaptionQueue.add(
      {
        chunkId: audioChunk.id,
        sessionId: data.sessionId,
        filePath,
      },
      { priority: 10, removeOnComplete: true }
    );

    return audioChunk.id;
  }

  async processAudioChunk(chunkId: string, sessionId: string, filePath: string): Promise<void> {
    await prisma.audioChunk.update({
      where: { id: chunkId },
      data: { status: 'processing' },
    });

    try {
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['word', 'segment'],
        language: 'zh',
      });

      await prisma.audioChunk.update({
        where: { id: chunkId },
        data: {
          status: 'completed',
          transcription: JSON.stringify(transcription),
          processedAt: new Date(),
        },
      });

      if (transcription.segments && transcription.segments.length > 0) {
        for (const segment of transcription.segments) {
          const chunk = await prisma.audioChunk.findUnique({ where: { id: chunkId } });
          if (!chunk) continue;

          const startTime = chunk.startTime + segment.start;
          const endTime = chunk.startTime + segment.end;

          await this.createLiveCaption({
            sessionId,
            audioChunkId: chunkId,
            startTime,
            endTime,
            textZh: segment.text.trim(),
            confidence: segment.confidence || 0,
          });
        }
      }
    } catch (error) {
      console.error('Error processing audio chunk:', error);
      await prisma.audioChunk.update({
        where: { id: chunkId },
        data: { status: 'failed' },
      });
      throw error;
    }
  }

  private async createLiveCaption(params: {
    sessionId: string;
    audioChunkId: string;
    startTime: number;
    endTime: number;
    textZh: string;
    confidence: number;
  }): Promise<void> {
    const liveCaption = await prisma.liveCaption.create({
      data: {
        sessionId: params.sessionId,
        audioChunkId: params.audioChunkId,
        startTime: params.startTime,
        endTime: params.endTime,
        textZh: params.textZh,
        confidence: params.confidence,
        status: 'completed',
        completedAt: new Date(),
      },
    });

    const io = (global as any).io;
    if (io) {
      io.to(params.sessionId).emit('caption:new', {
        id: liveCaption.id,
        startTime: liveCaption.startTime,
        endTime: liveCaption.endTime,
        textZh: liveCaption.textZh,
        isEdited: false,
      });
    }
  }

  async editCaption(
    captionId: string,
    sessionId: string,
    editedTextZh: string,
    editedTextEn?: string
  ): Promise<void> {
    const caption = await prisma.liveCaption.findUnique({
      where: { id: captionId, sessionId },
    });

    if (!caption) {
      throw new Error('Caption not found');
    }

    await prisma.captionEdit.create({
      data: {
        sessionId,
        liveCaptionId: captionId,
        originalTextZh: caption.textZh,
        editedTextZh,
        originalTextEn: caption.textEn,
        editedTextEn,
      },
    });

    await prisma.liveCaption.update({
      where: { id: captionId },
      data: {
        textZh: editedTextZh,
        textEn: editedTextEn,
        isEdited: true,
      },
    });

    const io = (global as any).io;
    if (io) {
      io.to(sessionId).emit('caption:updated', {
        id: captionId,
        textZh: editedTextZh,
        textEn: editedTextEn,
        isEdited: true,
      });
    }
  }

  async getSessionCaptions(sessionId: string): Promise<any[]> {
    return prisma.liveCaption.findMany({
      where: { sessionId },
      orderBy: { startTime: 'asc' },
      include: { edits: true },
    });
  }

  async getEditedCaptions(sessionId: string): Promise<any[]> {
    return prisma.liveCaption.findMany({
      where: { sessionId, isEdited: true },
      orderBy: { startTime: 'asc' },
    });
  }

  async mergeEditedCaptionsToSubtitles(sessionId: string): Promise<void> {
    const editedCaptions = await this.getEditedCaptions(sessionId);

    for (const edited of editedCaptions) {
      const existingSubtitle = await prisma.subtitle.findFirst({
        where: {
          sessionId,
          startTime: { gte: edited.startTime - 0.5, lte: edited.startTime + 0.5 },
        },
      });

      if (existingSubtitle) {
        await prisma.subtitle.update({
          where: { id: existingSubtitle.id },
          data: {
            textZh: edited.textZh,
            textEn: edited.textEn || existingSubtitle.textEn,
            isEdited: true,
            source: 'user_edit',
          },
        });

        await prisma.captionEdit.create({
          data: {
            sessionId,
            subtitleId: existingSubtitle.id,
            originalTextZh: existingSubtitle.textZh,
            editedTextZh: edited.textZh,
            originalTextEn: existingSubtitle.textEn,
            editedTextEn: edited.textEn,
          },
        });
      } else {
        await prisma.subtitle.create({
          data: {
            sessionId,
            startTime: edited.startTime,
            endTime: edited.endTime,
            textZh: edited.textZh,
            textEn: edited.textEn || '',
            isEdited: true,
            source: 'user_edit',
          },
        });
      }
    }
  }

  async cleanupSessionChunks(sessionId: string): Promise<void> {
    const chunks = await prisma.audioChunk.findMany({
      where: { sessionId },
      select: { filePath: true },
    });

    for (const chunk of chunks) {
      if (fs.existsSync(chunk.filePath)) {
        try {
          fs.unlinkSync(chunk.filePath);
        } catch (e) {
          console.warn('Failed to delete audio chunk:', e);
        }
      }
    }
  }
}

export const liveCaptionService = LiveCaptionService.getInstance();
