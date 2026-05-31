import React, { useState, useRef, DragEvent, ChangeEvent } from 'react';
import { UploadState } from '../types';
import { apiService } from '../services/api';

interface FileUploadProps {
  onUploadSuccess?: (response: any) => void;
}

const FileUpload: React.FC<FileUploadProps> = ({ onUploadSuccess }) => {
  const [state, setState] = useState<UploadState>({
    file: null,
    uploading: false,
    progress: 0,
    error: null,
    success: false,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setState(prev => ({
        ...prev,
        error: 'Please select a PDF file',
        success: false,
      }));
      return;
    }

    setState({
      file,
      uploading: false,
      progress: 0,
      error: null,
      success: false,
    });
  };

  const handleUpload = async () => {
    if (!state.file) return;

    setState(prev => ({
      ...prev,
      uploading: true,
      progress: 0,
      error: null,
      success: false,
    }));

    try {
      setState(prev => ({ ...prev, progress: 30 }));
      
      const response = await apiService.uploadPDF(state.file);
      
      setState(prev => ({
        ...prev,
        uploading: false,
        progress: 100,
        success: true,
        error: null,
      }));

      onUploadSuccess?.(response);
    } catch (error) {
      setState(prev => ({
        ...prev,
        uploading: false,
        progress: 0,
        error: error instanceof Error ? error.message : 'Upload failed',
        success: false,
      }));
    }
  };

  const handleClear = () => {
    setState({
      file: null,
      uploading: false,
      progress: 0,
      error: null,
      success: false,
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="w-full">
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
          isDragging
            ? 'border-primary-500 bg-primary-50'
            : state.error
            ? 'border-red-300 bg-red-50'
            : state.success
            ? 'border-green-300 bg-green-50'
            : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'
        }`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={handleFileChange}
          className="hidden"
        />

        <div className="space-y-3">
          {!state.file && (
            <>
              <svg
                className="mx-auto h-12 w-12 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-gray-700">
                  Click to upload or drag and drop
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Only PDF files are supported
                </p>
              </div>
            </>
          )}

          {state.file && !state.uploading && !state.success && (
            <>
              <svg
                className="mx-auto h-12 w-12 text-primary-500"
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
              <div>
                <p className="text-sm font-medium text-gray-900 truncate max-w-xs mx-auto">
                  {state.file.name}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {formatFileSize(state.file.size)}
                </p>
              </div>
            </>
          )}

          {state.uploading && (
            <>
              <svg
                className="mx-auto h-12 w-12 text-primary-500 animate-spin"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-primary-600">
                  Processing PDF...
                </p>
                <div className="w-48 mx-auto mt-2 bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${state.progress}%` }}
                  />
                </div>
              </div>
            </>
          )}

          {state.success && (
            <>
              <svg
                className="mx-auto h-12 w-12 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-green-700">
                  Document processed successfully!
                </p>
                <p className="text-xs text-green-600 mt-1">
                  You can now ask questions about this document
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {state.error && (
        <p className="mt-2 text-sm text-red-600">{state.error}</p>
      )}

      {state.file && !state.uploading && (
        <div className="mt-4 flex space-x-3">
          {!state.success && (
            <button
              onClick={handleUpload}
              className="flex-1 bg-primary-600 hover:bg-primary-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              Upload and Process
            </button>
          )}
          <button
            onClick={handleClear}
            className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-2 px-4 rounded-lg transition-colors"
          >
            {state.success ? 'Upload Another' : 'Cancel'}
          </button>
        </div>
      )}
    </div>
  );
};

export default FileUpload;
