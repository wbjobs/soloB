import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import OpenAI from 'openai';
import prisma from '../utils/prisma';
import { config, paths } from '../utils/config';

ffmpeg.setFfmpegPath(config.ffmpegPath);
ffmpeg.setFfprobePath(config.ffprobePath);

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

export class VideoProcessor {
  private sessionId: string;
  private io: any;
  private driftInfo: { avgDrift: number; trend: string; driftHistory: any[] } | null;

  constructor(sessionId: string, io: any, driftInfo?: any) {
    this.sessionId = sessionId;
    this.io = io;
    this.driftInfo = driftInfo || null;
  }

  private emitProgress(progress: number, status: string) {
    if (this.io) {
      this.io.to(this.sessionId).emit('processing:progress', {
        sessionId: this.sessionId,
        progress,
        status,
      });
    }
  }

  private calculateAVSyncCorrection(): { audioDelay: number; videoDelay: number } {
    if (!this.driftInfo) {
      return { audioDelay: 0, videoDelay: 0 };
    }

    const avgDrift = this.driftInfo.avgDrift || 0;
    
    if (Math.abs(avgDrift) < 100) {
      return { audioDelay: 0, videoDelay: 0 };
    }

    let audioDelay = 0;
    let videoDelay = 0;

    if (avgDrift > 0) {
      audioDelay = Math.min(Math.abs(avgDrift) / 1000, 3);
    } else {
      videoDelay = Math.min(Math.abs(avgDrift) / 1000, 3);
    }

    return { audioDelay, videoDelay };
  }

  private buildSyncFilters(): { videoFilters: string; audioFilters: string } {
    const { audioDelay, videoDelay } = this.calculateAVSyncCorrection();
    
    let videoFilters = 'fps=30';
    let audioFilters = '';

    if (videoDelay > 0) {
      videoFilters += `,tpad=start_duration=${videoDelay.toFixed(3)}:stop=0:start_mode=clone`;
    }

    if (audioDelay > 0) {
      audioFilters = `adelay=${Math.round(audioDelay * 1000)}:all=1`;
    }

    audioFilters += audioFilters ? ',aresample=48000:async=1' : 'aresample=48000:async=1';

    return { videoFilters, audioFilters };
  }

  async mergeSegments(): Promise<string> {
    this.emitProgress(10, 'Merging and synchronizing video segments...');

    const segments = await prisma.videoSegment.findMany({
      where: { sessionId: this.sessionId },
      orderBy: { segmentNumber: 'asc' },
    });

    if (segments.length === 0) {
      throw new Error('No video segments found');
    }

    const outputPath = path.join(paths.processed, `${this.sessionId}_merged.mp4`);
    const { videoFilters, audioFilters } = this.buildSyncFilters();
    
    console.log(`[AVSync] Applying correction: avgDrift=${this.driftInfo?.avgDrift}, videoFilters=${videoFilters}, audioFilters=${audioFilters}`);
    
    return new Promise((resolve, reject) => {
      const command = ffmpeg();
      
      segments.forEach((segment) => {
        command.input(segment.filePath);
      });

      command
        .videoCodec('libx264')
        .audioCodec('aac')
        .videoBitrate('2500k')
        .audioBitrate('128k')
        .audioChannels(2)
        .audioFrequency(48000)
        .outputOptions([
          '-vsync cfr',
          '-async 1',
          '-fflags +genpts',
          '-r 30',
        ]);

      if (videoFilters) {
        command.videoFilter(videoFilters);
      }
      if (audioFilters) {
        command.audioFilter(audioFilters);
      }

      command
        .on('progress', (progress) => {
          this.emitProgress(10 + Math.floor((progress.percent || 0) * 0.2), 'Merging and synchronizing video segments...');
        })
        .on('end', () => resolve(outputPath))
        .on('error', reject)
        .mergeToFile(outputPath, path.join(paths.temp, `${this.sessionId}_concat`));
    });
  }

  async extractAudio(videoPath: string): Promise<string> {
    this.emitProgress(30, 'Extracting audio track...');

    const audioPath = path.join(paths.temp, `${this.sessionId}_audio.mp3`);

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .output(audioPath)
        .noVideo()
        .audioCodec('libmp3lame')
        .on('end', () => resolve(audioPath))
        .on('error', reject)
        .run();
    });
  }

  async generateSubtitles(audioPath: string): Promise<any[]> {
    this.emitProgress(50, 'Generating subtitles with Whisper...');

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });

    const segments = transcription.segments || [];
    const subtitles: any[] = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      
      const translation = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'Translate the following Chinese text to English. Only return the translation, no explanation.' },
          { role: 'user', content: segment.text }
        ]
      });

      subtitles.push({
        startTime: segment.start,
        endTime: segment.end,
        textZh: segment.text,
        textEn: translation.choices[0].message.content || segment.text,
      });

      this.emitProgress(50 + Math.floor((i / segments.length) * 20), 'Translating subtitles...');
    }

    await prisma.subtitle.createMany({
      data: subtitles.map((sub) => ({
        ...sub,
        sessionId: this.sessionId,
      })),
    });

    return subtitles;
  }

  generateAssFile(subtitles: any[]): string {
    this.emitProgress(70, 'Generating ASS subtitle file...');

    const assPath = path.join(paths.temp, `${this.sessionId}_subtitles.ass`);
    
    const assContent = `[Script Info]
Title: Bilingual Subtitles
ScriptType: v4.00+
WrapStyle: 0
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Chinese,微软雅黑,48,&H00FFFFFF,&H000000FF,&H80000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,0,2,10,10,50,1
Style: English,Arial,32,&H00FFFF00,&H000000FF,&H80000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,0,2,10,10,100,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    let events = '';
    subtitles.forEach((sub) => {
      const start = this.formatTime(sub.startTime);
      const end = this.formatTime(sub.endTime);
      
      events += `Dialogue: 0,${start},${end},Chinese,,0,0,0,,${sub.textZh}\n`;
      events += `Dialogue: 0,${start},${end},English,,0,0,0,,${sub.textEn}\n`;
    });

    fs.writeFileSync(assPath, assContent + events);
    return assPath;
  }

  private formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = (seconds % 60).toFixed(2);
    return `${h.toString().padStart(1, '0')}:${m.toString().padStart(2, '0')}:${s.padStart(5, '0')}`;
  }

  async burnSubtitles(videoPath: string, assPath: string): Promise<string> {
    this.emitProgress(80, 'Burning subtitles into video with sync correction...');

    const outputPath = path.join(paths.processed, `${this.sessionId}_final.mp4`);
    const { audioDelay } = this.calculateAVSyncCorrection();

    return new Promise((resolve, reject) => {
      const command = ffmpeg(videoPath);
      
      command
        .videoFilters(`ass='${assPath.replace(/\\/g, '\\\\')}',setpts=N/FRAME_RATE/TB`)
        .audioFilters([
          'aresample=48000:async=1000',
          'asetpts=N/SR/TB',
        ])
        .videoCodec('libx264')
        .audioCodec('aac')
        .videoBitrate('2500k')
        .audioBitrate('128k')
        .audioChannels(2)
        .audioFrequency(48000)
        .outputOptions([
          '-vsync cfr',
          '-async 1',
          '-fflags +genpts',
          '-r 30',
          '-movflags +faststart',
        ]);

      command
        .on('progress', (progress) => {
          this.emitProgress(80 + Math.floor((progress.percent || 0) * 0.15), 'Burning subtitles with sync...');
        })
        .on('end', () => resolve(outputPath))
        .on('error', reject)
        .save(outputPath);
    });
  }

  async process(): Promise<string> {
    try {
      await prisma.processingTask.create({
        data: {
          sessionId: this.sessionId,
          type: 'video_processing',
          status: 'processing',
        },
      });

      const mergedPath = await this.mergeSegments();
      const audioPath = await this.extractAudio(mergedPath);
      const subtitles = await this.generateSubtitles(audioPath);
      const assPath = this.generateAssFile(subtitles);
      const finalPath = await this.burnSubtitles(mergedPath, assPath);

      await prisma.recordingSession.update({
        where: { id: this.sessionId },
        data: {
          videoPath: finalPath,
          status: 'completed',
        },
      });

      await prisma.processingTask.updateMany({
        where: { sessionId: this.sessionId, type: 'video_processing' },
        data: {
          status: 'completed',
          progress: 100,
          completedAt: new Date(),
        },
      });

      this.emitProgress(100, 'Processing completed!');

      if (fs.existsSync(mergedPath) && mergedPath !== finalPath) {
        fs.unlinkSync(mergedPath);
      }
      if (fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }
      if (fs.existsSync(assPath)) {
        fs.unlinkSync(assPath);
      }

      return finalPath;
    } catch (error) {
      console.error('Video processing error:', error);
      
      await prisma.recordingSession.update({
        where: { id: this.sessionId },
        data: { status: 'error' },
      });

      await prisma.processingTask.updateMany({
        where: { sessionId: this.sessionId, type: 'video_processing' },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      throw error;
    }
  }
}
