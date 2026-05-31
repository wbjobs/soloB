import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Play,
  Pause,
  Square,
  Settings,
  Image,
  ChevronRight,
  AlertCircle,
  CheckCircle,
  Clock,
  Cpu,
  Film,
  Upload,
} from 'lucide-react';
import {
  PreviewFrame,
  TranscodeState,
  TranscodeJobStatus,
  SegmentTranscodeConfig,
} from '../types';
import {
  previewTranscoderCreateJob,
  previewTranscoderStart,
  previewTranscoderPause,
  previewTranscoderResume,
  previewTranscoderGetState,
  previewTranscoderCancel,
  onPreviewFrameAvailable,
  onSegmentProgress,
  onTranscodingPaused,
  onTranscodingCompleted,
  openFileDialog,
  openSaveDialog,
  getVideoInfo,
} from '../tauriApi';

const defaultConfig: SegmentTranscodeConfig = {
  crf: 28,
  preset: 'medium',
  hdr_to_sdr: false,
  hardware_accel: 'None',
};

function getStatusColor(status: TranscodeJobStatus): string {
  switch (status) {
    case 'Running':
      return 'bg-blue-500';
    case 'Paused':
      return 'bg-yellow-500';
    case 'Completed':
      return 'bg-green-500';
    case 'Failed':
      return 'bg-red-500';
    case 'Merging':
      return 'bg-purple-500';
    case 'Splitting':
      return 'bg-orange-500';
    default:
      return 'bg-gray-500';
  }
}

function getStatusText(status: TranscodeJobStatus): string {
  switch (status) {
    case 'Initialized':
      return '初始化';
    case 'Splitting':
      return '分片处理中';
    case 'Queued':
      return '等待中';
    case 'Running':
      return '转码中';
    case 'Paused':
      return '已暂停';
    case 'Merging':
      return '合并中';
    case 'Completed':
      return '已完成';
    case 'Failed':
      return '失败';
    case 'Cancelled':
      return '已取消';
    default:
      return status;
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface PreviewFrameCardProps {
  frame: PreviewFrame;
  isLatest: boolean;
}

function PreviewFrameCard({ frame, isLatest }: PreviewFrameCardProps) {
  return (
    <div className={`relative rounded-lg overflow-hidden border-2 transition-all ${
      isLatest ? 'border-blue-500 shadow-lg shadow-blue-500/30' : 'border-gray-700'
    }`}>
      <img
        src={`file://${frame.image_path}`}
        alt={`预览帧 ${frame.segment_index}`}
        className="w-full h-auto"
        style={{ aspectRatio: '16/9', objectFit: 'cover' }}
      />
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
        <div className="text-xs text-white font-medium">
          进度 {frame.progress_percent.toFixed(0)}%
        </div>
        <div className="text-xs text-gray-300">
          分片 {frame.segment_index + 1}
        </div>
      </div>
      {isLatest && (
        <div className="absolute top-2 right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full">
          最新
        </div>
      )}
    </div>
  );
}

interface ConfigPanelProps {
  config: SegmentTranscodeConfig;
  setConfig: (c: SegmentTranscodeConfig) => void;
  disabled: boolean;
}

function ConfigPanel({ config, setConfig, disabled }: ConfigPanelProps) {
  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
        <Settings size={18} />
        编码参数
      </h3>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-gray-300 mb-2">
            CRF 质量: {config.crf}
          </label>
          <input
            type="range"
            min={0}
            max={51}
            value={config.crf}
            onChange={(e) => setConfig({ ...config, crf: parseInt(e.target.value) })}
            disabled={disabled}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>高质量</span>
            <span>低质量</span>
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-2">
            编码预设
          </label>
          <select
            value={config.preset}
            onChange={(e) => setConfig({ ...config, preset: e.target.value })}
            disabled={disabled}
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
          >
            <option value="ultrafast">超快 (ultrafast)</option>
            <option value="superfast">极快 (superfast)</option>
            <option value="veryfast">很快 (veryfast)</option>
            <option value="faster">较快 (faster)</option>
            <option value="fast">快 (fast)</option>
            <option value="medium">中等 (medium)</option>
            <option value="slow">慢 (slow)</option>
            <option value="slower">较慢 (slower)</option>
            <option value="veryslow">很慢 (veryslow)</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="hdr_to_sdr_preview"
            checked={config.hdr_to_sdr}
            onChange={(e) => setConfig({ ...config, hdr_to_sdr: e.target.checked })}
            disabled={disabled}
            className="rounded"
          />
          <label htmlFor="hdr_to_sdr_preview" className="text-sm text-gray-300">
            HDR → SDR 色调映射
          </label>
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-2">
            硬件加速
          </label>
          <select
            value={config.hardware_accel}
            onChange={(e) => setConfig({ ...config, hardware_accel: e.target.value })}
            disabled={disabled}
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
          >
            <option value="None">软件编码 (libx265)</option>
            <option value="Nvenc">NVIDIA NVENC</option>
            <option value="Qsv">Intel QSV</option>
            <option value="Amf">AMD AMF</option>
          </select>
        </div>
      </div>
    </div>
  );
}

export default function PreviewTranscoder() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [state, setState] = useState<TranscodeState | null>(null);
  const [config, setConfig] = useState<SegmentTranscodeConfig>(defaultConfig);
  const [inputPath, setInputPath] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [previewFrames, setPreviewFrames] = useState<PreviewFrame[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<any>(null);

  const unlistenRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    const setupListeners = async () => {
      const unlisten1 = await onPreviewFrameAvailable((event) => {
        if (event.job_id === jobId) {
          setPreviewFrames((prev) => {
            const exists = prev.find((f) => f.frame_id === event.preview_frame.frame_id);
            if (exists) return prev;
            return [...prev, event.preview_frame].sort(
              (a, b) => a.progress_percent - b.progress_percent
            );
          });
        }
      });

      const unlisten2 = await onSegmentProgress((event) => {
        if (event.job_id === jobId) {
          setState((prev) =>
            prev
              ? {
                  ...prev,
                  current_segment_index: event.segment_index,
                  total_segments: event.total_segments,
                  overall_progress: event.progress,
                  peak_memory_mb: Math.max(prev.peak_memory_mb, event.peak_memory_mb),
                }
              : null
          );
        }
      });

      const unlisten3 = await onTranscodingPaused((event) => {
        if (event.job_id === jobId) {
          setState((prev) => (prev ? { ...prev, status: 'Paused' } : null));
        }
      });

      const unlisten4 = await onTranscodingCompleted((event) => {
        if (event.job_id === jobId) {
          setState((prev) =>
            prev
              ? {
                  ...prev,
                  status: 'Completed',
                  overall_progress: 100,
                  peak_memory_mb: event.peak_memory_mb,
                }
              : null
          );
        }
      });

      unlistenRef.current = [unlisten1, unlisten2, unlisten3, unlisten4];
    };

    if (jobId) {
      setupListeners();
    }

    return () => {
      unlistenRef.current.forEach((unlisten) => unlisten());
    };
  }, [jobId]);

  useEffect(() => {
    const interval = setInterval(async () => {
      if (jobId && state && ['Running', 'Paused'].includes(state.status)) {
        const newState = await previewTranscoderGetState(jobId);
        if (newState) {
          setState(newState);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [jobId, state]);

  const handleSelectInput = async () => {
    const path = await openFileDialog();
    if (path) {
      setInputPath(path);
      const info = await getVideoInfo(path);
      setVideoInfo(info);
    }
  };

  const handleSelectOutput = async () => {
    if (!inputPath) return;
    const defaultName = inputPath.replace(/\.[^/.]+$/, '_encoded.mp4');
    const path = await openSaveDialog(defaultName);
    if (path) {
      setOutputPath(path);
    }
  };

  const handleStartTranscoding = async () => {
    if (!inputPath || !outputPath) {
      setError('请选择输入和输出文件');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const id = await previewTranscoderCreateJob(inputPath, outputPath, {
        ...config,
        target_width: config.target_width,
        target_height: config.target_height,
      });
      setJobId(id);
      await previewTranscoderStart(id);
      
      const initialState = await previewTranscoderGetState(id);
      setState(initialState);
    } catch (err: any) {
      setError(err.message || '启动转码失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePauseTranscoding = async () => {
    if (!jobId) return;
    try {
      await previewTranscoderPause(jobId);
    } catch (err: any) {
      setError(err.message || '暂停失败');
    }
  };

  const handleResumeTranscoding = async () => {
    if (!jobId) return;
    try {
      await previewTranscoderResume(jobId, config);
    } catch (err: any) {
      setError(err.message || '恢复失败');
    }
  };

  const handleCancelTranscoding = async () => {
    if (!jobId) return;
    try {
      await previewTranscoderCancel(jobId);
      setJobId(null);
      setState(null);
      setPreviewFrames([]);
    } catch (err: any) {
      setError(err.message || '取消失败');
    }
  };

  const handleApplyNewConfig = async () => {
    if (!jobId) return;
    try {
      await previewTranscoderResume(jobId, config);
    } catch (err: any) {
      setError(err.message || '应用配置失败');
    }
  };

  const canStart = !jobId && inputPath && outputPath;
  const isRunning = state?.status === 'Running';
  const isPaused = state?.status === 'Paused';
  const isFinished = state?.status === 'Completed' || state?.status === 'Failed';

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
          <Film className="text-blue-500" />
          预览转码器
        </h1>

        {error && (
          <div className="mb-4 bg-red-900/30 border border-red-500 rounded-lg p-4 flex items-center gap-2 text-red-300">
            <AlertCircle size={20} />
            {error}
          </div>
        )}

        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 space-y-6">
            {!jobId && (
              <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Upload size={20} />
                  选择视频文件
                </h2>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-300 mb-2">
                      输入文件
                    </label>
                    <button
                      onClick={handleSelectInput}
                      className="w-full p-4 border-2 border-dashed border-gray-600 rounded-lg hover:border-blue-500 hover:bg-gray-700/50 transition-colors text-left"
                    >
                      {inputPath ? (
                        <div>
                          <div className="text-white font-medium truncate">
                            {inputPath.split(/[/\\]/).pop()}
                          </div>
                          <div className="text-gray-400 text-sm truncate">
                            {inputPath}
                          </div>
                        </div>
                      ) : (
                        <div className="text-gray-400 text-center">
                          点击选择输入视频文件
                        </div>
                      )}
                    </button>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-300 mb-2">
                      输出文件
                    </label>
                    <button
                      onClick={handleSelectOutput}
                      disabled={!inputPath}
                      className="w-full p-4 border-2 border-dashed border-gray-600 rounded-lg hover:border-blue-500 hover:bg-gray-700/50 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {outputPath ? (
                        <div>
                          <div className="text-white font-medium truncate">
                            {outputPath.split(/[/\\]/).pop()}
                          </div>
                          <div className="text-gray-400 text-sm truncate">
                            {outputPath}
                          </div>
                        </div>
                      ) : (
                        <div className="text-gray-400 text-center">
                          点击选择输出文件路径
                        </div>
                      )}
                    </button>
                  </div>

                  {videoInfo && (
                    <div className="bg-gray-700/50 rounded-lg p-4">
                      <h3 className="text-white font-medium mb-2">视频信息</h3>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="text-gray-400">分辨率:</div>
                        <div className="text-white">
                          {videoInfo.width}x{videoInfo.height}
                        </div>
                        <div className="text-gray-400">时长:</div>
                        <div className="text-white">
                          {formatDuration(videoInfo.duration)}
                        </div>
                        <div className="text-gray-400">编码:</div>
                        <div className="text-white">{videoInfo.codec}</div>
                        <div className="text-gray-400">文件大小:</div>
                        <div className="text-white">
                          {(videoInfo.file_size / 1024 / 1024 / 1024).toFixed(2)} GB
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleStartTranscoding}
                    disabled={!canStart || isLoading}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white py-3 px-6 rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors"
                  >
                    {isLoading ? (
                      <>正在启动...</>
                    ) : (
                      <>
                        <Play size={20} />
                        开始转码
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {jobId && state && (
              <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg font-semibold text-white">转码进度</h2>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`px-2 py-1 rounded text-xs text-white ${getStatusColor(
                          state.status
                        )}`}
                      >
                        {getStatusText(state.status)}
                      </span>
                      <span className="text-gray-400 text-sm">
                        分片 {state.current_segment_index + 1} / {state.total_segments}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isRunning && (
                      <button
                        onClick={handlePauseTranscoding}
                        className="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
                      >
                        <Pause size={18} />
                        暂停
                      </button>
                    )}
                    {isPaused && (
                      <button
                        onClick={handleResumeTranscoding}
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
                      >
                        <Play size={18} />
                        继续
                      </button>
                    )}
                    {!isFinished && (
                      <button
                        onClick={handleCancelTranscoding}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
                      >
                        <Square size={18} />
                        取消
                      </button>
                    )}
                  </div>
                </div>

                <div className="mb-6">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-400">总体进度</span>
                    <span className="text-white font-medium">
                      {state.overall_progress.toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-3">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-green-500 h-3 rounded-full transition-all duration-300"
                      style={{ width: `${state.overall_progress}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-4 mb-6">
                  <div className="bg-gray-700/50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-white">
                      {formatDuration(state.elapsed_seconds)}
                    </div>
                    <div className="text-xs text-gray-400 flex items-center justify-center gap-1">
                      <Clock size={12} />
                      已用时间
                    </div>
                  </div>
                  <div className="bg-gray-700/50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-white">
                      {formatDuration(state.estimated_remaining_seconds)}
                    </div>
                    <div className="text-xs text-gray-400 flex items-center justify-center gap-1">
                      <Clock size={12} />
                      剩余时间
                    </div>
                  </div>
                  <div className="bg-gray-700/50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-white">
                      {state.peak_memory_mb.toFixed(0)}
                    </div>
                    <div className="text-xs text-gray-400 flex items-center justify-center gap-1">
                      <Cpu size={12} />
                      峰值内存 (MB)
                    </div>
                  </div>
                  <div className="bg-gray-700/50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-white">
                      {state.completed_segments}
                    </div>
                    <div className="text-xs text-gray-400 flex items-center justify-center gap-1">
                      <Film size={12} />
                      已完成分片
                    </div>
                  </div>
                </div>

                {isPaused && (
                  <div className="mb-6">
                    <div className="bg-yellow-900/30 border border-yellow-600 rounded-lg p-4 mb-4">
                      <div className="flex items-center gap-2 text-yellow-400 mb-2">
                        <AlertCircle size={18} />
                        <span className="font-medium">转码已暂停</span>
                      </div>
                      <p className="text-sm text-yellow-200/80">
                        您可以在下方调整编码参数，然后点击"应用配置并继续"，新参数将从下一个分片开始生效。
                      </p>
                    </div>
                    
                    <div className="flex gap-2">
                      <button
                        onClick={handleApplyNewConfig}
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
                      >
                        <Play size={18} />
                        应用配置并继续
                      </button>
                    </div>
                  </div>
                )}

                {state.status === 'Completed' && (
                  <div className="bg-green-900/30 border border-green-600 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-green-400 mb-2">
                      <CheckCircle size={20} />
                      <span className="font-medium">转码完成!</span>
                    </div>
                    <p className="text-sm text-green-200/80">
                      输出文件: {state.output_path}
                    </p>
                    <p className="text-sm text-green-200/80 mt-1">
                      共生成 {previewFrames.length} 张预览帧
                    </p>
                  </div>
                )}
              </div>
            )}

            {jobId && (
              <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Image size={20} />
                  实时预览帧
                  <span className="text-sm font-normal text-gray-400 ml-2">
                    (每完成 10% 自动抽取一帧)
                  </span>
                </h2>

                {previewFrames.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Image size={48} className="mx-auto mb-4 opacity-50" />
                    <p>转码开始后将自动生成预览帧</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-5 gap-4">
                    {previewFrames.map((frame, index) => (
                      <PreviewFrameCard
                        key={frame.frame_id}
                        frame={frame}
                        isLatest={index === previewFrames.length - 1 && isRunning}
                      />
                    ))}
                  </div>
                )}

                {previewFrames.length > 0 && (
                  <div className="mt-4 flex items-center gap-2 text-sm text-gray-400">
                    <ChevronRight size={14} />
                    <span>
                      共生成 {previewFrames.length} 张预览帧，覆盖 {
                        (previewFrames[previewFrames.length - 1]?.progress_percent || 0).toFixed(0)
                      }% 的视频内容
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <ConfigPanel
              config={config}
              setConfig={setConfig}
              disabled={isRunning}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
