export type TranscodeStatus = 'Pending' | 'Queued' | 'Running' | 'Paused' | 'Completed' | 'Failed' | 'Cancelled';

export type HardwareAcceleration = 'None' | 'Qsv' | 'Nvenc' | 'Amf';

export interface VideoInfo {
  path: string;
  filename: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  codec: string;
  file_size: number;
}

export interface TranscodeConfig {
  preset: string;
  crf: number;
  speed: number;
  target_width?: number;
  target_height?: number;
  hdr_to_sdr: boolean;
  hardware_accel: HardwareAcceleration;
  output_format: string;
}

export interface TranscodeJob {
  id: string;
  input_path: string;
  output_path: string;
  config: TranscodeConfig;
  status: TranscodeStatus;
  progress: number;
  current_fps: number;
  elapsed_time: number;
  remaining_time?: number;
  error_message?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  thumbnail_path?: string;
}

export interface TranscodingProgress {
  job_id: string;
  progress: number;
  fps: number;
  elapsed: number;
  remaining?: number;
  frame: number;
}

export interface GpuInfo {
  name: string;
  vendor: string;
  memory?: number;
}

export interface HardwareDetectionResult {
  available: HardwareAcceleration[];
  recommended: HardwareAcceleration;
  gpu_info: GpuInfo[];
}

export interface PresetConfig {
  name: string;
  description: string;
  config: Partial<TranscodeConfig>;
}

export const PRESET_CONFIGS: PresetConfig[] = [
  {
    name: '4K → 1080p',
    description: '将4K视频降采样到1080p分辨率',
    config: {
      target_width: 1920,
      target_height: 1080,
    },
  },
  {
    name: 'HDR → SDR',
    description: '将HDR视频色调映射到SDR',
    config: {
      hdr_to_sdr: true,
    },
  },
  {
    name: '快速编码',
    description: '使用较快的编码速度',
    config: {
      preset: 'fast',
      crf: 28,
    },
  },
  {
    name: '高质量编码',
    description: '使用较慢的速度获得更高质量',
    config: {
      preset: 'slow',
      crf: 24,
    },
  },
  {
    name: '小体积输出',
    description: '优先考虑文件大小',
    config: {
      preset: 'medium',
      crf: 32,
    },
  },
];

export interface MemoryOptimizedConfig {
  enable_segmented_transcoding: boolean;
  max_segment_duration_seconds: number;
  memory_limit_mb: number;
  max_concurrent_segments: number;
  auto_cleanup_segments: boolean;
}

export const defaultMemoryConfig: MemoryOptimizedConfig = {
  enable_segmented_transcoding: true,
  max_segment_duration_seconds: 30.0,
  memory_limit_mb: 1500.0,
  max_concurrent_segments: 1,
  auto_cleanup_segments: true,
};

export interface SegmentedTranscodeResult {
  success: boolean;
  output_path: string;
  total_segments: number;
  peak_memory_mb: number;
  estimated_memory_savings_mb: number;
  total_duration_seconds: number;
  error_message?: string;
}

export type TranscodeJobStatus = 'Initialized' | 'Splitting' | 'Queued' | 'Running' | 'Paused' | 'Merging' | 'Completed' | 'Failed' | 'Cancelled';

export interface SegmentTranscodeConfig {
  crf: number;
  preset: string;
  target_width?: number;
  target_height?: number;
  hdr_to_sdr: boolean;
  hardware_accel: string;
}

export interface PreviewFrame {
  frame_id: string;
  segment_index: number;
  timestamp_seconds: number;
  image_path: string;
  progress_percent: number;
  width: number;
  height: number;
  created_at: string;
}

export interface TranscodeState {
  job_id: string;
  status: TranscodeJobStatus;
  total_segments: number;
  completed_segments: number;
  current_segment_index: number;
  overall_progress: number;
  peak_memory_mb: number;
  elapsed_seconds: number;
  estimated_remaining_seconds: number;
  preview_frames: PreviewFrame[];
  current_config: SegmentTranscodeConfig;
  work_dir: string;
  input_path: string;
  output_path: string;
}

export interface ResumeCheckpoint {
  job_id: string;
  completed_segment_indices: number[];
  pending_segment_indices: number[];
  last_config: SegmentTranscodeConfig;
  work_dir: string;
  created_at: string;
}
