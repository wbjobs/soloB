import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

export interface SyncAnalysisResult {
  videoFps: number;
  audioSampleRate: number;
  videoDuration: number;
  audioDuration: number;
  driftMs: number;
  driftPerMinute: number;
  timestampOffsets: { video: number; audio: number }[];
  recommendation: string;
}

export class AVSyncChecker {
  private ffprobePath: string;

  constructor(ffprobePath: string = 'ffprobe') {
    this.ffprobePath = ffprobePath;
  }

  async analyzeVideo(videoPath: string): Promise<SyncAnalysisResult> {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    const videoInfo = await this.getStreamInfo(videoPath, 'v:0');
    const audioInfo = await this.getStreamInfo(videoPath, 'a:0');

    const videoDuration = parseFloat(videoInfo.duration);
    const audioDuration = parseFloat(audioInfo.duration);
    const driftMs = (audioDuration - videoDuration) * 1000;
    const driftPerMinute = driftMs / (videoDuration / 60);

    const timestampOffsets = await this.analyzeTimestamps(videoPath);

    let recommendation = 'No sync correction needed';
    if (Math.abs(driftMs) > 500) {
      recommendation = `Significant drift detected: ${driftMs.toFixed(1)}ms. Apply ${driftMs > 0 ? 'audio delay' : 'video delay'} of ${Math.abs(driftMs).toFixed(0)}ms`;
    } else if (Math.abs(driftMs) > 100) {
      recommendation = `Minor drift detected: ${driftMs.toFixed(1)}ms. Consider small correction`;
    }

    return {
      videoFps: this.parseFps(videoInfo.r_frame_rate),
      audioSampleRate: parseInt(audioInfo.sample_rate, 10),
      videoDuration,
      audioDuration,
      driftMs,
      driftPerMinute,
      timestampOffsets,
      recommendation,
    };
  }

  private async getStreamInfo(videoPath: string, streamSpec: string): Promise<any> {
    const cmd = `"${this.ffprobePath}" -v quiet -select_streams ${streamSpec} -print_format json -show_format -show_streams "${videoPath}"`;
    
    const { stdout } = await execAsync(cmd);
    const data = JSON.parse(stdout);
    
    return data.streams[0] || {};
  }

  private parseFps(fpsStr: string): number {
    if (!fpsStr) return 30;
    const [num, den] = fpsStr.split('/').map(Number);
    return num / den;
  }

  private async analyzeTimestamps(videoPath: string): Promise<{ video: number; audio: number }[]> {
    const offsets: { video: number; audio: number }[] = [];
    
    try {
      const cmd = `"${this.ffprobePath}" -v quiet -select_streams v:0 -show_entries frame=pkt_pts_time -of csv=p=0 -read_intervals "%+#10" "${videoPath}"`;
      const { stdout: videoTimestamps } = await execAsync(cmd);
      
      const cmd2 = `"${this.ffprobePath}" -v quiet -select_streams a:0 -show_entries frame=pkt_pts_time -of csv=p=0 -read_intervals "%+#100" "${videoPath}"`;
      const { stdout: audioTimestamps } = await execAsync(cmd2);

      const videoTs = videoTimestamps.trim().split('\n').filter(Boolean).map(parseFloat).slice(0, 5);
      const audioTs = audioTimestamps.trim().split('\n').filter(Boolean).map(parseFloat).slice(0, 5);

      for (let i = 0; i < Math.min(videoTs.length, audioTs.length); i++) {
        offsets.push({
          video: videoTs[i],
          audio: audioTs[i],
        });
      }
    } catch (error) {
      console.warn('Timestamp analysis failed:', error);
    }

    return offsets;
  }

  calculateCorrectionFactors(analysis: SyncAnalysisResult): { audioDelay: number; videoDelay: number } {
    let audioDelay = 0;
    let videoDelay = 0;

    if (Math.abs(analysis.driftMs) > 100) {
      if (analysis.driftMs > 0) {
        audioDelay = Math.min(analysis.driftMs / 1000, 5);
      } else {
        videoDelay = Math.min(Math.abs(analysis.driftMs) / 1000, 5);
      }
    }

    return { audioDelay, videoDelay };
  }

  generateFFmpegFilter(analysis: SyncAnalysisResult): string {
    const { audioDelay, videoDelay } = this.calculateCorrectionFactors(analysis);
    const filters: string[] = [];

    if (videoDelay > 0) {
      filters.push(`[0:v]tpad=start_duration=${videoDelay.toFixed(3)}:stop=0:start_mode=clone[v]`);
    }

    if (audioDelay > 0) {
      filters.push(`[0:a]adelay=${Math.round(audioDelay * 1000)}:all=1[a]`);
    }

    filters.push(`[0:v]fps=30,setpts=N/FRAME_RATE/TB[v]`);
    filters.push(`[0:a]aresample=48000:async=1000,asetpts=N/SR/TB[a]`);

    return filters.join(';');
  }

  async verifySync(outputPath: string): Promise<SyncAnalysisResult> {
    return this.analyzeVideo(outputPath);
  }
}

export const avSyncChecker = new AVSyncChecker();
