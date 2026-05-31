'use client';

import { CitationSource } from '@/lib/api';

interface CitationListProps {
  citations: CitationSource[];
  onCitationClick: (citation: CitationSource) => void;
}

export function CitationList({ citations, onCitationClick }: CitationListProps) {
  if (citations.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-gray-200">
      <p className="text-xs text-gray-500 mb-2 font-medium">引用来源 ({citations.length})</p>
      <div className="flex flex-wrap gap-2">
        {citations.map((citation) => (
          <button
            key={citation.ref_id}
            onClick={() => onCitationClick(citation)}
            className="group flex items-center space-x-1.5 px-2 py-1 bg-gray-100 hover:bg-primary-50 rounded-md transition-colors"
          >
            <span className="inline-flex items-center justify-center w-4 h-4 text-xs bg-primary-500 text-white rounded-full font-medium group-hover:bg-primary-600">
              {citation.ref_id.replace('[', '').replace(']', '')}
            </span>
            <span className="text-xs text-gray-600 max-w-[120px] truncate">
              {citation.source_file}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
