export interface RecordingSession {
  id: string;
  title: string;
  startedAt: string;
  endedAt?: string;
  duration?: number;
  status: 'recording' | 'processing' | 'completed' | 'error';
  videoPath?: string;
  createdAt: string;
  segments?: VideoSegment[];
  subtitles?: Subtitle[];
  processingTasks?: ProcessingTask[];
  _count?: {
    segments: number;
    subtitles: number;
  };
}

export interface VideoSegment {
  id: string;
  sessionId: string;
  segmentNumber: number;
  startTime: number;
  duration?: number;
  filePath: string;
  sizeBytes?: number;
  createdAt: string;
}

export interface Subtitle {
  id: string;
  sessionId: string;
  segmentId?: string;
  startTime: number;
  endTime: number;
  textZh: string;
  textEn: string;
  isEdited: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface LiveCaption {
  id: string;
  sessionId: string;
  audioChunkId?: string;
  startTime: number;
  endTime: number;
  textZh: string;
  textEn?: string;
  confidence?: number;
  isEdited: boolean;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
}

export interface CaptionEdit {
  id: string;
  sessionId: string;
  subtitleId?: string;
  liveCaptionId?: string;
  originalTextZh: string;
  editedTextZh: string;
  originalTextEn?: string;
  editedTextEn?: string;
  editedAt: string;
}

export interface ProcessingTask {
  id: string;
  sessionId: string;
  type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}

export interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  sessionId: string | null;
  title: string;
  duration: number;
  currentSegment: number;
}

export interface ProcessingState {
  isProcessing: boolean;
  progress: number;
  status: string;
}
