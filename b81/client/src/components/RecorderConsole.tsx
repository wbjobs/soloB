import React, { useState, useRef, useEffect } from 'react';
import { useRecorder } from '../hooks/useRecorder';
import { useLiveCaptions } from '../hooks/useLiveCaptions';
import { LiveCaptions } from './LiveCaptions';

export function RecorderConsole() {
  const {
    recordingState,
    processingState,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    formatDuration,
    mediaStream,
    audioStream,
  } = useRecorder();

  const {
    captions,
    editingCaptionId,
    setEditingCaptionId,
    editCaption,
    startAudioCapture,
    stopAudioCapture,
  } = useLiveCaptions(recordingState.sessionId);

  const [title, setTitle] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && mediaStream) {
      videoRef.current.srcObject = mediaStream;
    }
  }, [mediaStream]);

  const audioRecorderRef = useRef<MediaRecorder | null>(null);

  const handleStart = async () => {
    if (!title.trim()) {
      alert('请输入录制标题');
      return;
    }
    try {
      await startRecording(title);
    } catch (error) {
      console.error('Failed to start recording:', error);
      alert('开始录制失败，请确保已授权麦克风和屏幕共享权限');
    }
  };

  useEffect(() => {
    if (recordingState.isRecording && audioStream && !audioRecorderRef.current) {
      audioRecorderRef.current = startAudioCapture(audioStream);
    }
    if (!recordingState.isRecording && audioRecorderRef.current) {
      if (audioRecorderRef.current.state === 'recording') {
        audioRecorderRef.current.stop();
      }
      audioRecorderRef.current = null;
      stopAudioCapture();
    }
  }, [recordingState.isRecording, audioStream, startAudioCapture, stopAudioCapture]);

  const getStatusBadge = () => {
    if (processingState.isProcessing) {
      return (
        <span className="px-3 py-1 bg-yellow-600 text-white rounded-full text-sm font-medium flex items-center gap-2">
          <span className="w-2 h-2 bg-yellow-300 rounded-full animate-pulse"></span>
          处理中 {processingState.progress}%
        </span>
      );
    }

    if (recordingState.isRecording) {
      if (recordingState.isPaused) {
        return (
          <span className="px-3 py-1 bg-orange-600 text-white rounded-full text-sm font-medium flex items-center gap-2">
            <span className="w-2 h-2 bg-orange-300 rounded-full"></span>
            已暂停
          </span>
        );
      }
      return (
        <span className="px-3 py-1 bg-red-600 text-white rounded-full text-sm font-medium flex items-center gap-2">
          <span className="w-2 h-2 bg-red-300 rounded-full recording-pulse"></span>
          录制中
        </span>
      );
    }

    return (
      <span className="px-3 py-1 bg-slate-600 text-white rounded-full text-sm font-medium flex items-center gap-2">
        <span className="w-2 h-2 bg-slate-300 rounded-full"></span>
        待机中
      </span>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">录制控制台</h2>
        {getStatusBadge()}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-slate-800 rounded-xl p-4 shadow-xl">
            <div className="video-container rounded-lg overflow-hidden aspect-video relative">
              {recordingState.isRecording ? (
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-contain bg-black"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900">
                  <div className="text-6xl mb-4">🎬</div>
                  <p className="text-gray-400 text-lg">准备开始录制</p>
                  <p className="text-gray-500 text-sm mt-2">
                    将同时捕获屏幕共享和麦克风音频
                  </p>
                </div>
              )}

              {recordingState.isRecording && (
                <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center">
                  <div className="bg-black/70 px-4 py-2 rounded-lg text-white font-mono text-lg">
                    {formatDuration(recordingState.duration)}
                  </div>
                  <div className="bg-black/70 px-4 py-2 rounded-lg text-white text-sm">
                    分段 {recordingState.currentSegment}
                  </div>
                </div>
              )}
            </div>
          </div>

          {recordingState.isRecording && (
            <div className="mt-4 bg-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-medium flex items-center gap-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                  实时字幕预览
                </h3>
                <span className="text-xs text-gray-400">
                  共 {captions.length} 条字幕
                </span>
              </div>
              <LiveCaptions
                captions={captions}
                onEdit={editCaption}
                editingCaptionId={editingCaptionId}
                setEditingCaptionId={setEditingCaptionId}
                maxDisplayCount={8}
              />
              <p className="text-xs text-gray-500 mt-3">
                💡 提示：悬停字幕后点击"编辑"可修正识别错误，编辑后的内容将用于最终视频字幕
              </p>
            </div>
          )}

          {processingState.isProcessing && (
            <div className="mt-4 bg-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white font-medium">视频处理进度</span>
                <span className="text-blue-400 font-mono">{processingState.progress}%</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${processingState.progress}%` }}
                />
              </div>
              <p className="text-gray-400 text-sm mt-2">{processingState.status}</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-slate-800 rounded-xl p-4">
            <label className="block text-gray-300 text-sm font-medium mb-2">
              录制标题
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={recordingState.isRecording}
              placeholder="请输入录制标题..."
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          <div className="bg-slate-800 rounded-xl p-4">
            <h3 className="text-white font-medium mb-4">控制按钮</h3>
            <div className="grid grid-cols-2 gap-3">
              {!recordingState.isRecording ? (
                <button
                  onClick={handleStart}
                  className="col-span-2 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-bold py-4 px-6 rounded-lg transition-all transform hover:scale-105 flex items-center justify-center gap-2"
                >
                  <span className="w-3 h-3 bg-white rounded-full"></span>
                  开始录制
                </button>
              ) : (
                <>
                  {recordingState.isPaused ? (
                    <button
                      onClick={resumeRecording}
                      className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-3 px-4 rounded-lg transition-all flex items-center justify-center gap-2"
                    >
                      ▶️ 继续
                    </button>
                  ) : (
                    <button
                      onClick={pauseRecording}
                      className="bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-white font-bold py-3 px-4 rounded-lg transition-all flex items-center justify-center gap-2"
                    >
                      ⏸️ 暂停
                    </button>
                  )}
                  <button
                    onClick={stopRecording}
                    className="bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-700 hover:to-slate-800 text-white font-bold py-3 px-4 rounded-lg transition-all flex items-center justify-center gap-2"
                  >
                    ⏹️ 停止
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="bg-slate-800 rounded-xl p-4">
            <h3 className="text-white font-medium mb-3">录制信息</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">标题</span>
                <span className="text-white">{recordingState.title || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">录制时长</span>
                <span className="text-white font-mono">
                  {formatDuration(recordingState.duration)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">当前分段</span>
                <span className="text-white">第 {recordingState.currentSegment} 段</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">分段时长</span>
                <span className="text-white">每 5 分钟</span>
              </div>
            </div>
          </div>

          <div className="bg-blue-900/30 border border-blue-500/30 rounded-xl p-4">
            <h3 className="text-blue-300 font-medium mb-2">💡 提示</h3>
            <ul className="text-gray-300 text-sm space-y-1">
              <li>• 首次录制需授权麦克风和屏幕共享权限</li>
              <li>• 视频每 5 分钟自动分段保存</li>
              <li>• 录制完成后将自动生成双语字幕</li>
              <li>• 处理完成后可在历史会话中查看</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
