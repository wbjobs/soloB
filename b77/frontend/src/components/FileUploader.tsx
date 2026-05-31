import React, { useCallback, useState } from 'react';
import { useRenderStore } from '../store/useRenderStore';

export const FileUploader: React.FC = () => {
  const { setObjData, fileName } = useRenderStore();
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith('.obj')) {
      alert('请上传 .obj 格式的文件');
      return;
    }

    setLoading(true);
    const reader = new FileReader();

    reader.onload = (e) => {
      const content = e.target?.result as string;
      setObjData(content, file.name);
      setLoading(false);
    };

    reader.onerror = () => {
      alert('文件读取失败');
      setLoading(false);
    };

    reader.readAsText(file);
  }, [setObjData]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  }, [handleFile]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  }, [handleFile]);

  return (
    <div className="w-full">
      <h3 className="text-lg font-bold text-tech-blue glow-text mb-4">
        上传模型
      </h3>

      <div
        className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-all duration-300 cursor-pointer ${
          isDragging
            ? 'border-tech-blue bg-tech-blue/10 scale-105'
            : 'border-gray-600 hover:border-tech-blue hover:bg-tech-blue/5'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept=".obj"
          onChange={handleInputChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />

        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-tech-blue/20 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-tech-blue"
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
          </div>

          <div>
            <p className="text-lg font-medium text-white">
              {loading ? '加载中...' : '拖拽 OBJ 文件到此处'}
            </p>
            <p className="text-sm text-gray-400 mt-1">
              或点击选择文件
            </p>
          </div>
        </div>
      </div>

      {fileName && (
        <div className="mt-4 p-4 rounded-lg bg-tech-blue/10 border border-tech-blue/30">
          <div className="flex items-center gap-3">
            <svg
              className="w-6 h-6 text-tech-blue"
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
              <p className="text-white font-medium">{fileName}</p>
              <p className="text-sm text-tech-blue">文件已加载 ✓</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
