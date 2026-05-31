import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RecordingSession, Subtitle } from '../types';
import { api } from '../services/api';

export function VideoPlayerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    if (id) {
      loadData(id);
    }
  }, [id]);

  const loadData = async (sessionId: string) => {
    try {
      setLoading(true);
      const [sessionData, subtitlesData] = await Promise.all([
        api.getSession(sessionId),
        api.getSubtitles(sessionId),
      ]);
      setSession(sessionData);
      setSubtitles(subtitlesData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const jumpToSubtitle = (subtitle: Subtitle) => {
    if (videoRef.current) {
      videoRef.current.currentTime = subtitle.startTime;
      videoRef.current.play();
    }
  };

  const getCurrentSubtitle = () => {
    return subtitles.find(
      (sub) => currentTime >= sub.startTime && currentTime <= sub.endTime
    );
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const currentSubtitle = getCurrentSubtitle();

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="text-center text-gray-400 py-12">
          <div className="animate-spin text-4xl mb-4">⏳</div>
          加载中...
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="text-center text-gray-400 py-12">
          <div className="text-4xl mb-4">❌</div>
          会话不存在
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      <button
        onClick={() => navigate('/sessions')}
        className="mb-4 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all flex items-center gap-2"
      >
        ← 返回列表
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-2">{session.title}</h1>
        <div className="flex flex-wrap gap-4 text-sm text-gray-400">
          <span>📅 {new Date(session.createdAt).toLocaleString('zh-CN')}</span>
          <span>⏱️ {formatTime(session.duration || 0)}</span>
          <span>💬 {subtitles.length} 条字幕</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-slate-800 rounded-xl p-4 shadow-xl">
            {session.status === 'completed' ? (
              <div className="video-container rounded-lg overflow-hidden">
                <video
                  ref={videoRef}
                  onTimeUpdate={handleTimeUpdate}
                  controls
                  className="w-full aspect-video bg-black"
                  src={api.getVideoUrl(session.id)}
                />
              </div>
            ) : (
              <div className="aspect-video bg-slate-900 rounded-lg flex flex-col items-center justify-center">
                <div className="text-6xl mb-4">
                  {session.status === 'processing' ? '⏳' : '❌'}
                </div>
                <p className="text-gray-400 text-lg">
                  {session.status === 'processing' ? '视频处理中...' : '视频处理失败'}
                </p>
              </div>
            )}

            {currentSubtitle && (
              <div className="mt-4 p-4 bg-gradient-to-r from-blue-900/50 to-indigo-900/50 border border-blue-500/30 rounded-lg">
                <p className="text-white text-lg mb-1">{currentSubtitle.textZh}</p>
                <p className="text-blue-300 text-sm">{currentSubtitle.textEn}</p>
                <p className="text-gray-400 text-xs mt-2">
                  {formatTime(currentSubtitle.startTime)} - {formatTime(currentSubtitle.endTime)}
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 bg-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white font-medium">播放进度</span>
              <span className="text-blue-400 font-mono">
                {formatTime(currentTime)} / {formatTime(session.duration || 0)}
              </span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2 rounded-full transition-all duration-100"
                style={{ width: `${session.duration ? (currentTime / session.duration) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="bg-slate-800 rounded-xl p-4 h-full max-h-[600px] overflow-hidden flex flex-col">
            <h3 className="text-white font-medium mb-4 flex items-center gap-2">
              <span>💬</span>
              字幕时间轴
              <span className="text-gray-400 text-sm">({subtitles.length} 条)</span>
            </h3>

            {subtitles.length === 0 ? (
              <div className="text-center text-gray-400 py-8">
                <p>暂无字幕数据</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                {subtitles.map((subtitle, index) => (
                  <div
                    key={subtitle.id}
                    onClick={() => jumpToSubtitle(subtitle)}
                    className={`timeline-item p-3 rounded-lg cursor-pointer border-l-4 ${
                      currentSubtitle?.id === subtitle.id
                        ? 'bg-blue-600/30 border-blue-500 glow-border'
                        : 'bg-slate-700/50 border-slate-600 hover:border-blue-500'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-1">
                      <span className="text-xs text-blue-400 font-mono bg-blue-900/30 px-2 py-0.5 rounded">
                        {formatTime(subtitle.startTime)}
                      </span>
                      <span className="text-xs text-gray-500">#{index + 1}</span>
                    </div>
                    <p className="text-white text-sm mb-1 line-clamp-2">{subtitle.textZh}</p>
                    <p className="text-gray-400 text-xs line-clamp-1">{subtitle.textEn}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 bg-blue-900/30 border border-blue-500/30 rounded-xl p-4">
            <h4 className="text-blue-300 font-medium mb-2">💡 使用说明</h4>
            <ul className="text-gray-300 text-sm space-y-1">
              <li>• 点击字幕项可跳转到对应播放位置</li>
              <li>• 当前播放的字幕会高亮显示</li>
              <li>• 支持中英文双语字幕</li>
              <li>• 视频支持拖拽进度条跳转</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
