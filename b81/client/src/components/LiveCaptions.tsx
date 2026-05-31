import React, { useState, useCallback } from 'react';
import { LiveCaption } from '../types';

interface LiveCaptionsProps {
  captions: LiveCaption[];
  onEdit: (captionId: string, textZh: string, textEn?: string) => void;
  editingCaptionId: string | null;
  setEditingCaptionId: (id: string | null) => void;
  maxDisplayCount?: number;
}

export const LiveCaptions: React.FC<LiveCaptionsProps> = ({
  captions,
  onEdit,
  editingCaptionId,
  setEditingCaptionId,
  maxDisplayCount = 5,
}) => {
  const [editTextZh, setEditTextZh] = useState('');
  const [editTextEn, setEditTextEn] = useState('');

  const displayCaptions = captions.slice(-maxDisplayCount);

  const handleEditClick = useCallback((caption: LiveCaption) => {
    setEditTextZh(caption.textZh);
    setEditTextEn(caption.textEn || '');
    setEditingCaptionId(caption.id);
  }, [setEditingCaptionId]);

  const handleSave = useCallback(() => {
    if (editingCaptionId) {
      onEdit(editingCaptionId, editTextZh, editTextEn);
    }
  }, [editingCaptionId, editTextZh, editTextEn, onEdit]);

  const handleCancel = useCallback(() => {
    setEditingCaptionId(null);
    setEditTextZh('');
    setEditTextEn('');
  }, [setEditingCaptionId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  }, [handleSave, handleCancel]);

  if (captions.length === 0) {
    return (
      <div className="w-full px-4 py-3 text-center text-gray-400 text-sm bg-gray-800 bg-opacity-50 rounded-lg">
        等待语音转文字...
      </div>
    );
  }

  return (
    <div className="w-full space-y-2">
      {displayCaptions.map((caption) => (
        <div
          key={caption.id}
          className={`px-4 py-3 rounded-lg transition-all duration-300 ${
            caption.isEdited
              ? 'bg-green-900 bg-opacity-40 border border-green-600'
              : 'bg-gray-800 bg-opacity-70'
          } ${caption.id === editingCaptionId ? 'ring-2 ring-blue-500' : ''}`}
        >
          {editingCaptionId === caption.id ? (
            <div className="space-y-2">
              <input
                type="text"
                value={editTextZh}
                onChange={(e) => setEditTextZh(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="中文翻译"
                autoFocus
              />
              <input
                type="text"
                value={editTextEn}
                onChange={(e) => setEditTextEn(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="英文翻译（可选）"
              />
              <div className="flex justify-end space-x-2">
                <button
                  onClick={handleCancel}
                  className="px-3 py-1 text-sm text-gray-400 hover:text-white transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  保存
                </button>
              </div>
            </div>
          ) : (
            <div className="group relative">
              <p className="text-white text-base leading-relaxed">{caption.textZh}</p>
              {caption.textEn && (
                <p className="text-gray-400 text-sm mt-1">{caption.textEn}</p>
              )}
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-gray-500">
                  {Math.floor(caption.startTime / 60)}:{String(Math.floor(caption.startTime % 60)).padStart(2, '0')}
                  {caption.isEdited && (
                    <span className="ml-2 text-green-400">已编辑</span>
                  )}
                </span>
                <button
                  onClick={() => handleEditClick(caption)}
                  className="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-all"
                >
                  编辑
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
