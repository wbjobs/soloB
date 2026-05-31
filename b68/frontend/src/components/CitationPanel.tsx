'use client';

import { CitationSource } from '@/lib/api';

interface CitationPanelProps {
  citation: CitationSource | null;
  onClose: () => void;
}

export function CitationPanel({ citation, onClose }: CitationPanelProps) {
  if (!citation) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center space-x-3">
            <span className="inline-flex items-center justify-center w-7 h-7 text-sm bg-primary-500 text-white rounded-full font-semibold">
              {citation.ref_id}
            </span>
            <div>
              <h3 className="font-semibold text-gray-800">引用来源</h3>
              <p className="text-sm text-gray-500">
                {citation.source_file}
                {citation.page_number && <span className="ml-2">第 {citation.page_number} 页</span>}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-blue-50 p-3 rounded-lg">
                <p className="text-xs text-blue-600 font-medium mb-1">向量距离</p>
                <p className="text-lg font-semibold text-blue-800">{citation.distance.toFixed(4)}</p>
              </div>
              <div className="bg-green-50 p-3 rounded-lg">
                <p className="text-xs text-green-600 font-medium mb-1">相似度</p>
                <p className="text-lg font-semibold text-green-800">{(citation.similarity * 100).toFixed(1)}%</p>
              </div>
              <div className="bg-purple-50 p-3 rounded-lg">
                <p className="text-xs text-purple-600 font-medium mb-1">LLM 重排分数</p>
                <p className="text-lg font-semibold text-purple-800">
                  {citation.rerank_score ?? 'N/A'}
                </p>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">内容预览</p>
              <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap">
                {citation.full_content}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">文件路径</p>
              <p className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3 font-mono text-xs break-all">
                {citation.source_path}
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
