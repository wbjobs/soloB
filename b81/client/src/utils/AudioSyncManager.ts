export class AudioBufferPool {
  private buffer: Blob[] = [];
  private maxSize: number;
  private baseTimestamp: number = 0;
  private lastAudioTime: number = 0;
  private driftThreshold: number = 500;

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  setBaseTimestamp(timestamp: number): void {
    this.baseTimestamp = timestamp;
  }

  addChunk(blob: Blob, timestamp: number): void {
    const relativeTime = timestamp - this.baseTimestamp;
    
    this.buffer.push({
      blob,
      timestamp: relativeTime,
    } as any);

    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }

    this.lastAudioTime = relativeTime;
  }

  getDrift(videoTime: number): number {
    return this.lastAudioTime - videoTime;
  }

  needsCorrection(videoTime: number): boolean {
    return Math.abs(this.getDrift(videoTime)) > this.driftThreshold;
  }

  getBufferedChunks(): Blob[] {
    return this.buffer.map(item => (item as any).blob);
  }

  clear(): void {
    this.buffer = [];
    this.lastAudioTime = 0;
  }

  getLastAudioTime(): number {
    return this.lastAudioTime;
  }
}

export class AudioVideoSynchronizer {
  private audioContext: AudioContext | null = null;
  private videoTimeBase: number = 0;
  private audioTimeBase: number = 0;
  private driftHistory: number[] = [];
  private maxHistorySize: number = 30;
  private sampleRate: number = 48000;
  private lastCorrectionTime: number = 0;
  private correctionCooldown: number = 5000;

  constructor() {
    this.initAudioContext();
  }

  private async initAudioContext(): Promise<void> {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: this.sampleRate,
        latencyHint: 'interactive',
      });
      await this.audioContext.resume();
    } catch (error) {
      console.warn('AudioContext initialization failed:', error);
    }
  }

  setVideoStartTime(timestamp: number): void {
    this.videoTimeBase = timestamp;
  }

  setAudioStartTime(timestamp: number): void {
    this.audioTimeBase = timestamp;
  }

  getCurrentDrift(): number {
    if (!this.audioContext) return 0;
    const audioTime = this.audioContext.currentTime * 1000 - this.audioTimeBase;
    const videoTime = Date.now() - this.videoTimeBase;
    return audioTime - videoTime;
  }

  recordDrift(drift: number): void {
    this.driftHistory.push(drift);
    if (this.driftHistory.length > this.maxHistorySize) {
      this.driftHistory.shift();
    }
  }

  getAverageDrift(): number {
    if (this.driftHistory.length === 0) return 0;
    return this.driftHistory.reduce((a, b) => a + b, 0) / this.driftHistory.length;
  }

  getTrend(): 'increasing' | 'decreasing' | 'stable' {
    if (this.driftHistory.length < 10) return 'stable';
    
    const recent = this.driftHistory.slice(-5);
    const older = this.driftHistory.slice(-10, -5);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    
    const diff = recentAvg - olderAvg;
    if (diff > 100) return 'increasing';
    if (diff < -100) return 'decreasing';
    return 'stable';
  }

  shouldApplyCorrection(currentDrift: number): boolean {
    const now = Date.now();
    if (now - this.lastCorrectionTime < this.correctionCooldown) {
      return false;
    }
    
    const avgDrift = this.getAverageDrift();
    return Math.abs(avgDrift) > 300;
  }

  applyCorrection(): { type: string; amount: number } | null {
    const avgDrift = this.getAverageDrift();
    const trend = this.getTrend();
    
    if (!this.shouldApplyCorrection(avgDrift)) {
      return null;
    }

    this.lastCorrectionTime = Date.now();
    
    let correctionType = '';
    let correctionAmount = 0;

    if (avgDrift > 500) {
      correctionType = 'audio_delay';
      correctionAmount = Math.min(avgDrift * 0.5, 500);
    } else if (avgDrift < -500) {
      correctionType = 'video_delay';
      correctionAmount = Math.min(Math.abs(avgDrift) * 0.5, 500);
    }

    return { type: correctionType, amount: correctionAmount };
  }

  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  getSampleRate(): number {
    return this.sampleRate;
  }

  reset(): void {
    this.videoTimeBase = 0;
    this.audioTimeBase = 0;
    this.driftHistory = [];
    this.lastCorrectionTime = 0;
  }

  async close(): Promise<void> {
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
  }
}

export function createSyncConstraints(): MediaStreamConstraints {
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000,
      sampleSize: 16,
      channelCount: 2,
    },
    video: false,
  };
}

export function getRecorderOptions(): MediaRecorderOptions {
  return {
    mimeType: 'video/webm;codecs=vp9,opus',
    audioBitsPerSecond: 128000,
    videoBitsPerSecond: 2500000,
  };
}
