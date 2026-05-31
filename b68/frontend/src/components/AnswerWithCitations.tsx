'use client';

import React from 'react';
import { CitationSource } from '@/lib/api';
import { CitationBadge } from './CitationBadge';

interface AnswerWithCitationsProps {
  content: string;
  answerWithCitations?: string;
  citations?: CitationSource[];
  onCitationClick: (citation: CitationSource) => void;
  isStreaming?: boolean;
}

export function AnswerWithCitations({
  content,
  answerWithCitations,
  citations = [],
  onCitationClick,
  isStreaming,
}: AnswerWithCitationsProps) {
  const displayContent = answerWithCitations || content;

  const citationMap = React.useMemo(() => {
    const map = new Map<string, CitationSource>();
    citations.forEach((c) => map.set(c.ref_id, c));
    return map;
  }, [citations]);

  const parseContentWithCitations = React.useCallback(
    (text: string): React.ReactNode[] => {
      if (!text) return [];

      const parts: React.ReactNode[] = [];
      const regex = /\[(\d+)\]/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      let keyIndex = 0;

      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          parts.push(
            <span key={`text-${keyIndex++}`}>
              {text.slice(lastIndex, match.index)}
            </span>
          );
        }

        const refId = match[0];
        const citation = citationMap.get(refId);

        parts.push(
          <CitationBadge
            key={`citation-${keyIndex++}`}
            refId={match[1]}
            citation={citation}
            onClick={onCitationClick}
          />
        );

        lastIndex = regex.lastIndex;
      }

      if (lastIndex < text.length) {
        parts.push(
          <span key={`text-${keyIndex++}`}>
            {text.slice(lastIndex)}
          </span>
        );
      }

      return parts;
    },
    [citationMap, onCitationClick]
  );

  return (
    <div className="whitespace-pre-wrap">
      {answerWithCitations && citations.length > 0 ? (
        <>{parseContentWithCitations(answerWithCitations)}</>
      ) : (
        <>
          {content}
          {isStreaming && (
            <span className="inline-block w-0.5 h-5 bg-gray-400 ml-1 animate-pulse" />
          )}
        </>
      )}
    </div>
  );
}
