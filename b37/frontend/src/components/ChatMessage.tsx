import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatMessage as ChatMessageType, RetrievedDocument } from '../types';

interface ChatMessageProps {
  message: ChatMessageType;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const [showSources, setShowSources] = useState(false);

  const isUser = message.role === 'user';

  const getTableCount = (sources: RetrievedDocument[] | undefined): number => {
    if (!sources) return 0;
    return sources.filter(s => s.is_table_chunk).length;
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-3xl ${isUser ? 'order-2' : 'order-1'}`}>
        <div className="flex items-start space-x-3">
          {!isUser && (
            <div className="flex-shrink-0">
              <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-primary-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </div>
            </div>
          )}

          <div
            className={`rounded-2xl px-4 py-3 ${
              isUser
                ? 'bg-primary-600 text-white rounded-br-sm'
                : 'bg-gray-100 text-gray-900 rounded-bl-sm'
            }`}
          >
            <div className={`message-content text-sm leading-relaxed ${
              isUser ? 'prose-invert' : ''
            }`}>
              {isUser ? (
                <p>{message.content}</p>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
              )}
            </div>
          </div>

          {isUser && (
            <div className="flex-shrink-0">
              <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
              </div>
            </div>
          )}
        </div>

        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="mt-2 ml-11">
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setShowSources(!showSources)}
                className="text-xs text-gray-500 hover:text-gray-700 flex items-center space-x-1"
              >
                <svg
                  className={`w-4 h-4 transition-transform ${showSources ? 'rotate-90' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
                <span>Sources ({message.sources.length})</span>
              </button>
              
              {getTableCount(message.sources) > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                  <svg
                    className="w-3 h-3 mr-1"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                  {getTableCount(message.sources)} table reference{getTableCount(message.sources) > 1 ? 's' : ''}
                </span>
              )}
            </div>

            {showSources && (
              <div className="mt-2 space-y-2">
                {message.sources.map((source: RetrievedDocument, index: number) => (
                  <div
                    key={index}
                    className={`bg-white border rounded-lg p-3 ${
                      source.is_table_chunk 
                        ? 'border-green-300 bg-green-50' 
                        : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-medium text-primary-600">
                          {source.source}
                        </span>
                        {source.is_table_chunk && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-200 text-green-800">
                            TABLE
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">
                        Chunk {source.chunk_index + 1}
                        {source.score !== null && ` · Score: ${(source.score * 100).toFixed(1)}%`}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 line-clamp-4">
                      {source.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className={`mt-1 text-xs text-gray-400 ${isUser ? 'text-right mr-11' : 'ml-11'}`}>
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
    </div>
  );
};

export default ChatMessage;
