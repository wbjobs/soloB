import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import {
  VideoInfo,
  TranscodeJob,
  TranscodeConfig,
  TranscodingProgress,
  HardwareDetectionResult,
  MemoryOptimizedConfig,
  SegmentedTranscodeResult,
  SegmentTranscodeConfig,
  TranscodeState,
  PreviewFrame,
  ResumeCheckpoint,
} from './types';

export const getVideoInfo = async (path: string): Promise<VideoInfo> => {
  return invoke<VideoInfo>('get_video_info', { path });
};

export const addToQueue = async (
  inputPath: string,
  outputPath: string,
  config: TranscodeConfig
): Promise<string> => {
  return invoke<string>('add_to_queue', {
    inputPath,
    outputPath,
    config,
  });
};

export const startTranscoding = async (): Promise<void> => {
  return invoke<void>('start_transcoding');
};

export const pauseTranscoding = async (jobId: string): Promise<void> => {
  return invoke<void>('pause_transcoding', { jobId });
};

export const resumeTranscoding = async (jobId: string): Promise<void> => {
  return invoke<void>('resume_transcoding', { jobId });
};

export const cancelTranscoding = async (jobId: string): Promise<void> => {
  return invoke<void>('cancel_transcoding', { jobId });
};

export const removeFromQueue = async (jobId: string): Promise<void> => {
  return invoke<void>('remove_from_queue', { jobId });
};

export const getQueueStatus = async (): Promise<TranscodeJob[]> => {
  return invoke<TranscodeJob[]>('get_queue_status');
};

export const getTranscodingProgress = async (
  jobId: string
): Promise<TranscodeJob | null> => {
  return invoke<TranscodeJob | null>('get_transcoding_progress', { jobId });
};

export const setMaxParallel = async (max: number): Promise<void> => {
  return invoke<void>('set_max_parallel', { max });
};

export const detectHardwareAcceleration =
  async (): Promise<HardwareDetectionResult> => {
    return invoke<HardwareDetectionResult>('detect_hardware_acceleration');
  };

export const generateThumbnailGrid = async (
  videoPath: string
): Promise<string> => {
  return invoke<string>('generate_thumbnail_grid', { videoPath });
};

export const onTranscodingProgress = (
  callback: (progress: TranscodingProgress) => void
) => {
  return listen<TranscodingProgress>('transcoding_progress', (event) => {
    callback(event.payload);
  });
};

export const openFileDialog = async (): Promise<string | null> => {
  const { open } = await import('@tauri-apps/api/dialog');
  const result = await open({
    multiple: false,
    filters: [
      {
        name: 'Video Files',
        extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'],
      },
    ],
  });
  return result as string | null;
};

export const openSaveDialog = async (
  defaultName: string
): Promise<string | null> => {
  const { save } = await import('@tauri-apps/api/dialog');
  const result = await save({
    defaultPath: defaultName,
    filters: [
      {
        name: 'MP4 Video',
        extensions: ['mp4'],
      },
      {
        name: 'MKV Video',
        extensions: ['mkv'],
      },
    ],
  });
  return result as string | null;
};

export const transcodeWithMemoryOptimization = async (
  inputPath: string,
  outputPath: string,
  config: TranscodeConfig,
  memoryConfig: MemoryOptimizedConfig
): Promise<SegmentedTranscodeResult> => {
  return invoke<SegmentedTranscodeResult>('transcode_with_memory_optimization', {
    inputPath,
    outputPath,
    config,
    memoryConfig,
  });
};

export interface SegmentedProgressEvent {
  job_id: string;
  progress: number;
  fps: number;
  elapsed: number;
  remaining?: number;
  current_memory_mb: number;
  peak_memory_mb: number;
  completed_segments: number;
  total_segments: number;
}

export const onSegmentedTranscodingProgress = (
  callback: (progress: SegmentedProgressEvent) => void
) => {
  return listen('segmented_transcoding_progress', (event) => {
    callback(event.payload as SegmentedProgressEvent);
  });
};

export interface PreviewFrameEvent {
  job_id: string;
  preview_frame: PreviewFrame;
}

export interface SegmentProgressEvent {
  job_id: string;
  segment_index: number;
  total_segments: number;
  progress: number;
  peak_memory_mb: number;
}

export interface TranscodingCompletedEvent {
  job_id: string;
  output_path: string;
  total_preview_frames: number;
  peak_memory_mb: number;
}

export const previewTranscoderCreateJob = async (
  inputPath: string,
  outputPath: string,
  config: SegmentTranscodeConfig
): Promise<string> => {
  return invoke<string>('preview_transcoder_create_job', {
    inputPath,
    outputPath,
    config,
  });
};

export const previewTranscoderStart = async (jobId: string): Promise<void> => {
  return invoke<void>('preview_transcoder_start', { jobId });
};

export const previewTranscoderPause = async (jobId: string): Promise<void> => {
  return invoke<void>('preview_transcoder_pause', { jobId });
};

export const previewTranscoderResume = async (
  jobId: string,
  newConfig?: SegmentTranscodeConfig
): Promise<void> => {
  return invoke<void>('preview_transcoder_resume', { jobId, newConfig });
};

export const previewTranscoderUpdateConfig = async (
  jobId: string,
  newConfig: SegmentTranscodeConfig
): Promise<void> => {
  return invoke<void>('preview_transcoder_update_config', { jobId, newConfig });
};

export const previewTranscoderGetState = async (
  jobId: string
): Promise<TranscodeState | null> => {
  return invoke<TranscodeState | null>('preview_transcoder_get_state', { jobId });
};

export const previewTranscoderCancel = async (jobId: string): Promise<void> => {
  return invoke<void>('preview_transcoder_cancel', { jobId });
};

export const previewTranscoderCreateCheckpoint = async (
  jobId: string
): Promise<ResumeCheckpoint> => {
  return invoke<ResumeCheckpoint>('preview_transcoder_create_checkpoint', { jobId });
};

export const onPreviewFrameAvailable = (
  callback: (event: PreviewFrameEvent) => void
) => {
  return listen('preview_frame_available', (event) => {
    callback(event.payload as PreviewFrameEvent);
  });
};

export const onSegmentProgress = (
  callback: (event: SegmentProgressEvent) => void
) => {
  return listen('segment_progress', (event) => {
    callback(event.payload as SegmentProgressEvent);
  });
};

export const onTranscodingPaused = (
  callback: (event: { job_id: string }) => void
) => {
  return listen('transcoding_paused', (event) => {
    callback(event.payload as { job_id: string });
  });
};

export const onTranscodingCompleted = (
  callback: (event: TranscodingCompletedEvent) => void
) => {
  return listen('transcoding_completed', (event) => {
    callback(event.payload as TranscodingCompletedEvent);
  });
};
