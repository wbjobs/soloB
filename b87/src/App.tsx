import { useState, useEffect } from 'react';
import { Upload, Settings, Cpu, Play, Pause, X, Check, Clock, Film } from 'lucide-react';
import {
  TranscodeJob,
  TranscodeConfig,
  TranscodeStatus,
  VideoInfo,
  PRESET_CONFIGS,
  HardwareDetectionResult,
} from './types';
import {
  addToQueue,
  startTranscoding,
  getQueueStatus,
  onTranscodingProgress,
  openFileDialog,
  openSaveDialog,
  getVideoInfo,
  detectHardwareAcceleration,
  setMaxParallel,
  cancelTranscoding,
  removeFromQueue,
} from './tauriApi';

const defaultConfig: TranscodeConfig = {
  preset: 'medium',
  crf: 28,
  speed: 6,
  hdr_to_sdr: false,
  hardware_accel: 'None',
  output_format: 'mp4',
};

function getStatusColor(status: TranscodeStatus): string {
  switch (status) {
    case 'Queued':
      return 'bg-yellow-500';
    case 'Running':
      return 'bg-blue-500';
    case 'Paused':
      return 'bg-orange-500';
    case 'Completed':
      return 'bg-green-500';
    case 'Failed':
      return 'bg-red-500';
    case 'Cancelled':
      return 'bg-gray-500';
    default:
      return 'bg-gray-500';
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function JobCard({
  job,
  onCancel,
  onRemove,
}: {
  job: TranscodeJob;
  onCancel: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="bg-gray-800 rounded-lg p-4 mb-3 border border-gray-700">
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1">
          <h3 className="font-medium text-white truncate">
            {job.input_path.split(/[/\\]/).pop()}
          </h3>
          <p className="text-sm text-gray-400 truncate">
            输出: {job.output_path.split(/[/\\]/).pop()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-1 rounded text-xs text-white ${getStatusColor(
              job.status
            )}`}
          >
            {job.status}
          </span>
          {job.status === 'Running' && (
            <button
              onClick={onCancel}
              className="p-1 hover:bg-gray-700 rounded"
              title="取消"
            >
              <X size={16} className="text-red-400" />
            </button>
          )}
          {job.status === 'Completed' ||
          job.status === 'Failed' ||
          job.status === 'Cancelled' ? (
            <button
              onClick={onRemove}
              className="p-1 hover:bg-gray-700 rounded"
              title="移除"
            >
              <X size={16} className="text-gray-400" />
            </button>
          ) : null}
        </div>
      </div>

      {job.status === 'Running' && (
        <>
          <div className="mb-3">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-400">进度</span>
              <span className="text-white">{job.progress.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${job.progress}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="bg-gray-700 rounded p-2">
              <div className="text-gray-400 text-xs">FPS</div>
              <div className="text-white font-medium">
                {job.current_fps.toFixed(1)}
              </div>
            </div>
            <div className="bg-gray-700 rounded p-2">
              <div className="text-gray-400 text-xs">已用时间</div>
              <div className="text-white font-medium">
                {formatDuration(job.elapsed_time)}
              </div>
            </div>
            <div className="bg-gray-700 rounded p-2">
              <div className="text-gray-400 text-xs">剩余时间</div>
              <div className="text-white font-medium">
                {job.remaining_time
                  ? formatDuration(job.remaining_time)
                  : '计算中...'}
              </div>
            </div>
          </div>
        </>
      )}

      {job.status === 'Completed' && job.thumbnail_path && (
        <div className="mt-3">
          <div className="text-sm text-gray-400 mb-2">缩略图预览</div>
          <img
            src={`file://${job.thumbnail_path}`}
            alt="缩略图网格"
            className="w-full rounded-lg border border-gray-600"
          />
        </div>
      )}

      {job.error_message && (
        <div className="mt-2 text-sm text-red-400 bg-red-900/20 p-2 rounded">
          {job.error_message}
        </div>
      )}
    </div>
  );
}

function ConfigPanel({
  config,
  setConfig,
  hardwareInfo,
  maxParallel,
  setMaxParallelValue,
}: {
  config: TranscodeConfig;
  setConfig: (c: TranscodeConfig) => void;
  hardwareInfo: HardwareDetectionResult | null;
  maxParallel: number;
  setMaxParallelValue: (n: number) => void;
}) {
  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Settings size={20} />
        转码设置
      </h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            预设配置
          </label>
          <div className="grid grid-cols-2 gap-2">
            {PRESET_CONFIGS.map((preset) => (
              <button
                key={preset.name}
                onClick={() =>
                  setConfig({ ...config, ...preset.config })
                }
                className="p-2 text-left bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
              >
                <div className="font-medium text-white">{preset.name}</div>
                <div className="text-xs text-gray-400">
                  {preset.description}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            CRF 质量 (0-51)
          </label>
          <input
            type="range"
            min="0"
            max="51"
            value={config.crf}
            onChange={(e) =>
              setConfig({ ...config, crf: parseInt(e.target.value) })
            }
            className="w-full"
          />
          <div className="text-xs text-gray-400 text-center">
            当前值: {config.crf} (越低质量越高)
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            编码预设
          </label>
          <select
            value={config.preset}
            onChange={(e) =>
              setConfig({ ...config, preset: e.target.value })
            }
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

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            分辨率调整
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              placeholder="宽度"
              value={config.target_width || ''}
              onChange={(e) =>
                setConfig({
                  ...config,
                  target_width: e.target.value
                    ? parseInt(e.target.value)
                    : undefined,
                })
              }
              className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
            />
            <input
              type="number"
              placeholder="高度"
              value={config.target_height || ''}
              onChange={(e) =>
                setConfig({
                  ...config,
                  target_height: e.target.value
                    ? parseInt(e.target.value)
                    : undefined,
                })
              }
              className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="hdr_to_sdr"
            checked={config.hdr_to_sdr}
            onChange={(e) =>
              setConfig({ ...config, hdr_to_sdr: e.target.checked })
            }
            className="rounded"
          />
          <label htmlFor="hdr_to_sdr" className="text-sm text-gray-300">
            HDR → SDR 色调映射
          </label>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            硬件加速
          </label>
          <select
            value={config.hardware_accel}
            onChange={(e) =>
              setConfig({
                ...config,
                hardware_accel: e.target.value as any,
              })
            }
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
          >
            {hardwareInfo?.available.map((accel) => (
              <option key={accel} value={accel}>
                {accel === 'None'
                  ? '软件编码 (libx265)'
                  : accel === 'Nvenc'
                  ? 'NVIDIA NVENC'
                  : accel === 'Qsv'
                  ? 'Intel QSV'
                  : 'AMD AMF'}
                {accel === hardwareInfo.recommended && accel !== 'None'
                  ? ' (推荐)'
                  : ''}
              </option>
            ))}
          </select>
          {hardwareInfo?.gpu_info.length! > 0 && (
            <div className="mt-2 text-xs text-gray-400">
              检测到 GPU: {hardwareInfo?.gpu_info[0]?.name}
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            最大并行任务数
          </label>
          <input
            type="number"
            min="1"
            max="8"
            value={maxParallel}
            onChange={(e) =>
              setMaxParallelValue(parseInt(e.target.value) || 1)
            }
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
          />
        </div>
      </div>
    </div>
  );
}

function VideoInfoPanel({ info }: { info: VideoInfo | null }) {
  if (!info) return null;

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 mb-4">
      <h3 className="font-medium text-white mb-3 flex items-center gap-2">
        <Film size={18} />
        视频信息
      </h3>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-gray-400">文件名:</span>
          <span className="text-white ml-1">{info.filename}</span>
        </div>
        <div>
          <span className="text-gray-400">编码:</span>
          <span className="text-white ml-1">{info.codec}</span>
        </div>
        <div>
          <span className="text-gray-400">分辨率:</span>
          <span className="text-white ml-1">
            {info.width}x{info.height}
          </span>
        </div>
        <div>
          <span className="text-gray-400">帧率:</span>
          <span className="text-white ml-1">{info.fps.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-gray-400">时长:</span>
          <span className="text-white ml-1">
            {formatDuration(info.duration)}
          </span>
        </div>
        <div>
          <span className="text-gray-400">大小:</span>
          <span className="text-white ml-1">
            {formatFileSize(info.file_size)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [jobs, setJobs] = useState<TranscodeJob[]>([]);
  const [config, setConfig] = useState<TranscodeConfig>(defaultConfig);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [hardwareInfo, setHardwareInfo] =
    useState<HardwareDetectionResult | null>(null);
  const [maxParallel, setMaxParallelValue] = useState(2);
  const [isTranscoding, setIsTranscoding] = useState(false);

  useEffect(() => {
    detectHardwareAcceleration().then(setHardwareInfo);
  }, []);

  useEffect(() => {
    getQueueStatus().then(setJobs);
  }, []);

  useEffect(() => {
    const unlisten = onTranscodingProgress((progress) => {
      setJobs((prev) =>
        prev.map((job) =>
          job.id === progress.job_id
            ? {
                ...job,
                progress: progress.progress,
                current_fps: progress.fps,
                elapsed_time: progress.elapsed,
                remaining_time: progress.remaining,
              }
            : job
        )
      );
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      getQueueStatus().then(setJobs);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleSelectFile = async () => {
    const file = await openFileDialog();
    if (file) {
      setSelectedFile(file);
      getVideoInfo(file).then(setVideoInfo);
    }
  };

  const handleAddToQueue = async () => {
    if (!selectedFile) return;

    const defaultName = selectedFile.replace(/\.[^/.]+$/, '_hevc.mp4');
    const outputPath = await openSaveDialog(defaultName);

    if (outputPath) {
      await addToQueue(selectedFile, outputPath, config);
      setSelectedFile(null);
      setVideoInfo(null);
      const updated = await getQueueStatus();
      setJobs(updated);
    }
  };

  const handleStartTranscoding = async () => {
    await setMaxParallel(maxParallel);
    await startTranscoding();
    setIsTranscoding(true);
  };

  const handleCancelJob = async (jobId: string) => {
    await cancelTranscoding(jobId);
    const updated = await getQueueStatus();
    setJobs(updated);
  };

  const handleRemoveJob = async (jobId: string) => {
    await removeFromQueue(jobId);
    const updated = await getQueueStatus();
    setJobs(updated);
  };

  const runningCount = jobs.filter((j) => j.status === 'Running').length;
  const queuedCount = jobs.filter((j) => j.status === 'Queued').length;
  const completedCount = jobs.filter((j) => j.status === 'Completed').length;

  return (
    <div className="min-h-screen bg-gray-900">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Cpu className="text-blue-500" />
            HEVC 视频转码工具
          </h1>
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1 text-blue-400">
              <Play size={14} /> 运行中: {runningCount}
            </span>
            <span className="flex items-center gap-1 text-yellow-400">
              <Clock size={14} /> 排队: {queuedCount}
            </span>
            <span className="flex items-center gap-1 text-green-400">
              <Check size={14} /> 完成: {completedCount}
            </span>
          </div>
        </div>
      </header>

      <div className="p-6 grid grid-cols-3 gap-6">
        <div className="col-span-2">
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 mb-4">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Upload size={20} />
              添加视频
            </h2>

            {!selectedFile ? (
              <button
                onClick={handleSelectFile}
                className="w-full py-12 border-2 border-dashed border-gray-600 rounded-lg hover:border-blue-500 hover:bg-gray-700/50 transition-colors flex flex-col items-center gap-2"
              >
                <Upload size={40} className="text-gray-400" />
                <span className="text-gray-300">
                  点击选择视频文件或拖放到此处
                </span>
                <span className="text-sm text-gray-500">
                  支持 MP4, MKV, AVI, MOV, WMV, FLV, WEBM
                </span>
              </button>
            ) : (
              <div>
                <VideoInfoPanel info={videoInfo} />

                <div className="flex gap-3">
                  <button
                    onClick={handleAddToQueue}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <Play size={18} />
                    添加到队列
                  </button>
                  <button
                    onClick={() => {
                      setSelectedFile(null);
                      setVideoInfo(null);
                    }}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">转码队列</h2>
              {!isTranscoding && queuedCount > 0 && (
                <button
                  onClick={handleStartTranscoding}
                  className="bg-green-600 hover:bg-green-700 text-white py-1 px-4 rounded text-sm font-medium flex items-center gap-2 transition-colors"
                >
                  <Play size={16} />
                  开始转码
                </button>
              )}
              {isTranscoding && (
                <span className="text-sm text-green-400 flex items-center gap-2">
                  <Play size={14} className="animate-pulse" />
                  转码进行中...
                </span>
              )}
            </div>

            {jobs.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                队列为空，请添加视频文件
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                {jobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    onCancel={() => handleCancelJob(job.id)}
                    onRemove={() => handleRemoveJob(job.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <ConfigPanel
            config={config}
            setConfig={setConfig}
            hardwareInfo={hardwareInfo}
            maxParallel={maxParallel}
            setMaxParallelValue={setMaxParallelValue}
          />
        </div>
      </div>
    </div>
  );
}
