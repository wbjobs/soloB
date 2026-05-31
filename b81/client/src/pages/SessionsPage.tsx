import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { RecordingSession } from '../types';
import { api } from '../services/api';

export function SessionsPage() {
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      setLoading(true);
      const data = await api.getSessions();
      setSessions(data);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('确定要删除这个录制会话吗？')) {
      try {
        await api.deleteSession(id);
        loadSessions();
      } catch (error) {
        console.error('Failed to delete session:', error);
      }
    }
  };

  const handleRetry = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.retryProcessing(id);
      alert('已重新开始处理');
    } catch (error) {
      console.error('Failed to retry processing:', error);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { color: string; label: string }> = {
      recording: { color: 'bg-red-600', label: '录制中' },
      processing: { color: 'bg-yellow-600', label: '处理中' },
      completed: { color: 'bg-green-600', label: '已完成' },
      error: { color: 'bg-red-700', label: '处理失败' },
    };

    const config = statusConfig[status] || { color: 'bg-gray-600', label: status };

    return (
      <span className={`${config.color} px-2 py-1 text-white text-xs rounded-full font-medium`}>
        {config.label}
      </span>
    );
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('zh-CN');
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

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

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">历史会话</h2>
        <button
          onClick={loadSessions}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all flex items-center gap-2"
        >
          🔄 刷新
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="bg-slate-800 rounded-xl p-12 text-center">
          <div className="text-6xl mb-4">📁</div>
          <h3 className="text-xl font-semibold text-white mb-2">暂无录制会话</h3>
          <p className="text-gray-400">开始您的第一次录制吧！</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => navigate(`/sessions/${session.id}`)}
              className="bg-slate-800 rounded-xl p-4 hover:bg-slate-700 transition-all cursor-pointer group"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-white group-hover:text-blue-400 transition-colors">
                      {session.title}
                    </h3>
                    {getStatusBadge(session.status)}
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm text-gray-400">
                    <span>📅 {formatDate(session.createdAt)}</span>
                    <span>⏱️ {formatDuration(session.duration)}</span>
                    {session._count && (
                      <>
                        <span>📹 {session._count.segments} 个分段</span>
                        <span>💬 {session._count.subtitles} 条字幕</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {session.status === 'error' && (
                    <button
                      onClick={(e) => handleRetry(session.id, e)}
                      className="px-3 py-1 bg-yellow-600 hover:bg-yellow-500 text-white text-sm rounded-lg transition-all"
                    >
                      重试处理
                    </button>
                  )}
                  <button
                    onClick={(e) => handleDelete(session.id, e)}
                    className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg transition-all"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
