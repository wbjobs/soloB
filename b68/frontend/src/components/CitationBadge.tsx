'use client';

import { CitationSource } from '@/lib/api';

interface CitationBadgeProps {
  refId: string;
  citation: CitationSource | undefined;
  onClick: (citation: CitationSource) => void;
}

export function CitationBadge({ refId, citation, onClick }: CitationBadgeProps) {
  if (!citation) {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 text-xs bg-gray-200 text-gray-600 rounded-full mx-0.5 align-middle cursor-default">
        {refId}
      </span>
    );
  }

  return (
    <button
      onClick={() => onClick(citation)}
      className="inline-flex items-center justify-center w-5 h-5 text-xs bg-primary-500 text-white rounded-full mx-0.5 align-middle hover:bg-primary-600 hover:scale-110 transition-all cursor-pointer"
      title={`来源: ${citation.source_file}${citation.page_number ? ` (第${citation.page_number}页)` : ''}`}
    >
      {refId}
    </button>
  );
}
