import React, { useState, useEffect } from 'react';
import FileUpload from './FileUpload';
import { apiService } from '../services/api';
import { HealthResponse, UploadResponse } from '../types';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess?: (response: UploadResponse) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, onUploadSuccess }) => {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [lastUpload, setLastUpload] = useState<UploadResponse | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const data = await apiService.getHealth();
        setHealth(data);
      } catch (error) {
        console.error('Failed to fetch health status:', error);
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleClearDocuments = async () => {
    if (!window.confirm('Are you sure you want to clear all documents? This action cannot be undone.')) {
      return;
    }

    setIsClearing(true);
    try {
      await apiService.clearDocuments();
      const updatedHealth = await apiService.getHealth();
      setHealth(updatedHealth);
      setLastUpload(null);
    } catch (error) {
      console.error('Failed to clear documents:', error);
      alert('Failed to clear documents. Please try again.');
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-80 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="h-full flex flex-col">
          <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200">
            <div className="flex items-center space-x-2">
              <svg
                className="w-6 h-6 text-primary-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <h1 className="text-lg font-bold text-gray-900">PDF Q&A</h1>
            </div>
            <button
              onClick={onClose}
              className="lg:hidden p-1 rounded-lg hover:bg-gray-100"
            >
              <svg
                className="w-5 h-5 text-gray-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
                Upload Document
              </h2>
              <FileUpload
                onUploadSuccess={async (response) => {
                  setLastUpload(response);
                  onUploadSuccess?.(response);
                  const updatedHealth = await apiService.getHealth();
                  setHealth(updatedHealth);
                }}
              />
            </div>

            {lastUpload && lastUpload.success && (
              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
                  Last Document
                </h2>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-xs font-medium text-green-800 truncate">
                    {lastUpload.filename}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-green-600">Pages:</span>
                      <span className="ml-1 font-medium text-green-800">
                        {lastUpload.total_pages ?? 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-green-600">Chunks:</span>
                      <span className="ml-1 font-medium text-green-800">
                        {lastUpload.total_chunks}
                      </span>
                    </div>
                    {lastUpload.total_tables !== null && lastUpload.total_tables !== undefined && (
                      <div className="col-span-2">
                        <span className="text-green-600">Tables:</span>
                        <span className="ml-1 font-medium text-green-800">
                          {lastUpload.total_tables} detected
                          {lastUpload.table_chunks ? ` (${lastUpload.table_chunks} table chunks)` : ''}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
                System Status
              </h2>
              <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Backend</span>
                  <div className="flex items-center space-x-1">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        health ? 'bg-green-500' : 'bg-red-500'
                      }`}
                    />
                    <span className="text-xs font-medium">
                      {health ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                </div>

                {health && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Table Extraction</span>
                      <div className="flex items-center space-x-1">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            health.pdfplumber_available ? 'bg-green-500' : 'bg-yellow-500'
                          }`}
                        />
                        <span className={`text-xs font-medium ${
                          health.pdfplumber_available ? 'text-green-700' : 'text-yellow-700'
                        }`}>
                          {health.pdfplumber_available ? 'Enhanced (pdfplumber)' : 'Basic (pypdf)'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Documents</span>
                      <span className="text-xs font-medium text-gray-900">
                        {health.total_documents} uploaded
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Total Chunks</span>
                      <span className="text-xs font-medium text-gray-900">
                        {health.document_count}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Embedding Model</span>
                      <span className="text-xs font-medium text-gray-900 truncate max-w-32">
                        {health.embedding_model.split('/').pop()}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Version</span>
                      <span className="text-xs font-medium text-gray-900">
                        {health.version}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {health && health.document_count > 0 && (
                <button
                  onClick={handleClearDocuments}
                  disabled={isClearing}
                  className="w-full text-xs text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isClearing ? 'Clearing...' : 'Clear All Documents'}
                </button>
              )}
            </div>

            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
                How to Use
              </h2>
              <div className="space-y-2">
                <div className="flex items-start space-x-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary-100 text-primary-600 text-xs flex items-center justify-center font-medium">
                    1
                  </span>
                  <p className="text-xs text-gray-600">
                    Upload a PDF document (with or without tables).
                  </p>
                </div>
                <div className="flex items-start space-x-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary-100 text-primary-600 text-xs flex items-center justify-center font-medium">
                    2
                  </span>
                  <p className="text-xs text-gray-600">
                    Tables are automatically detected and converted to structured Markdown.
                  </p>
                </div>
                <div className="flex items-start space-x-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary-100 text-primary-600 text-xs flex items-center justify-center font-medium">
                    3
                  </span>
                  <p className="text-xs text-gray-600">
                    Ask questions about the document, including questions about table data.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-start space-x-2">
                <svg
                  className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-xs text-blue-800">
                  <strong>Tip:</strong> For best results with tables, ensure pdfplumber is installed (pip install pdfplumber). Tables are preserved as Markdown for better LLM understanding.
                </p>
              </div>
            </div>
          </div>

          <div className="px-4 py-3 border-t border-gray-200">
            <p className="text-xs text-gray-400 text-center">
              Powered by LangChain & ChromaDB
            </p>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
