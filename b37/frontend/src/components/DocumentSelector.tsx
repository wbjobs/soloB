import React, { useState, useEffect } from 'react';
import { DocumentInfo } from '../types';
import { apiService } from '../services/api';

interface DocumentSelectorProps {
  selectedDocumentIds: string[];
  onSelectionChange: (documentIds: string[]) => void;
}

const DocumentSelector: React.FC<DocumentSelectorProps> = ({
  selectedDocumentIds,
  onSelectionChange,
}) => {
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      const response = await apiService.getDocuments();
      setDocuments(response.documents);
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const handleToggle = (documentId: string) => {
    if (selectedDocumentIds.includes(documentId)) {
      onSelectionChange(selectedDocumentIds.filter(id => id !== documentId));
    } else {
      onSelectionChange([...selectedDocumentIds, documentId]);
    }
  };

  const handleSelectAll = () => {
    if (selectedDocumentIds.length === documents.length && documents.length > 0) {
      onSelectionChange([]);
    } else {
      onSelectionChange(documents.map(d => d.document_id));
    }
  };

  const handleDelete = async (documentId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const doc = documents.find(d => d.document_id === documentId);
    if (!doc) return;

    if (!window.confirm(`Are you sure you want to delete "${doc.filename}"? This action cannot be undone.`)) {
      return;
    }

    setDeletingId(documentId);
    try {
      await apiService.deleteDocument(documentId);
      
      onSelectionChange(selectedDocumentIds.filter(id => id !== documentId));
      
      await fetchDocuments();
    } catch (error) {
      console.error('Failed to delete document:', error);
      alert('Failed to delete document. Please try again.');
    } finally {
      setDeletingId(null);
    }
  };

  const formatFileSize = (kb: number | null): string => {
    if (!kb) return 'N/A';
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  };

  const formatDate = (isoString: string): string => {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString();
    } catch {
      return 'N/A';
    }
  };

  const allSelected = documents.length > 0 && selectedDocumentIds.length === documents.length;
  const someSelected = selectedDocumentIds.length > 0 && selectedDocumentIds.length < documents.length;

  return (
    <div className="space-y-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <div className="flex items-center space-x-2">
          <svg
            className="w-4 h-4 text-gray-600"
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
          <span className="text-sm font-medium text-gray-700">
            {selectedDocumentIds.length === 0
              ? 'Search all documents'
              : selectedDocumentIds.length === 1
              ? 'Searching 1 document'
              : `Searching ${selectedDocumentIds.length} documents`}
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-4 text-center">
              <div className="animate-spin w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full mx-auto" />
              <p className="text-xs text-gray-500 mt-2">Loading documents...</p>
            </div>
          ) : documents.length === 0 ? (
            <div className="p-4 text-center">
              <svg
                className="w-8 h-8 text-gray-300 mx-auto"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <p className="text-xs text-gray-500 mt-2">No documents uploaded yet</p>
            </div>
          ) : (
            <>
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={handleSelectAll}
                    className="rounded text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-xs font-medium text-gray-700">
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </span>
                </label>
                <button
                  onClick={fetchDocuments}
                  className="text-xs text-gray-500 hover:text-gray-700"
                  title="Refresh"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </button>
              </div>

              <div className="max-h-60 overflow-y-auto">
                {documents.map((doc) => (
                  <div
                    key={doc.document_id}
                    className={`flex items-start px-3 py-2 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors ${
                      deletingId === doc.document_id ? 'opacity-50' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedDocumentIds.includes(doc.document_id)}
                      onChange={() => handleToggle(doc.document_id)}
                      disabled={deletingId === doc.document_id}
                      className="mt-1 rounded text-primary-600 focus:ring-primary-500"
                    />
                    <div className="flex-1 ml-3 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate" title={doc.filename}>
                        {doc.filename}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-gray-500">
                        <span>{formatFileSize(doc.file_size_kb)}</span>
                        <span>·</span>
                        <span>{doc.total_pages || '?'} p</span>
                        <span>·</span>
                        <span>{doc.total_chunks} chunks</span>
                        {doc.total_tables !== null && doc.total_tables > 0 && (
                          <>
                            <span>·</span>
                            <span className="text-green-600">{doc.total_tables} tables</span>
                          </>
                        )}
                        <span>·</span>
                        <span>{formatDate(doc.uploaded_at)}</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDelete(doc.document_id, e)}
                      disabled={deletingId === doc.document_id}
                      className="ml-2 p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                      title="Delete document"
                    >
                      {deletingId === doc.document_id ? (
                        <div className="animate-spin w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full" />
                      ) : (
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      )}
                    </button>
                  </div>
                ))}
              </div>

              {selectedDocumentIds.length > 0 && (
                <div className="px-3 py-2 bg-primary-50 border-t border-primary-100">
                  <p className="text-xs text-primary-700">
                    {selectedDocumentIds.length === documents.length
                      ? 'Searching all documents'
                      : `Searching ${selectedDocumentIds.length} of ${documents.length} documents`}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default DocumentSelector;
