import React, { useState, useRef } from 'react';

interface FileUploadProps {
  onFilesSelected: (file1: File, file2: File) => void;
  disabled?: boolean;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFilesSelected, disabled }) => {
  const [file1, setFile1] = useState<File | null>(null);
  const [file2, setFile2] = useState<File | null>(null);
  const input1Ref = useRef<HTMLInputElement>(null);
  const input2Ref = useRef<HTMLInputElement>(null);

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    setFile: (file: File | null) => void
  ) => {
    const file = e.target.files?.[0] || null;
    if (file) {
      const validExtensions = ['.fasta', '.fa', '.fna', '.ffn', '.faa', '.frn'];
      const fileName = file.name.toLowerCase();
      const isValid = validExtensions.some(ext => fileName.endsWith(ext));
      if (!isValid) {
        alert('请上传FASTA格式的文件 (.fasta, .fa, .fna等)');
        return;
      }
    }
    setFile(file);
  };

  const handleSubmit = () => {
    if (file1 && file2) {
      onFilesSelected(file1, file2);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">
        上传FASTA文件
      </h2>
      
      <div className="space-y-6">
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-blue-500 transition-colors bg-gray-50">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            序列文件 1
          </label>
          <input
            ref={input1Ref}
            type="file"
            accept=".fasta,.fa,.fna,.ffn,.faa,.frn"
            onChange={(e) => handleFileChange(e, setFile1)}
            disabled={disabled}
            className="block w-full text-sm text-gray-500
              file:mr-4 file:py-2 file:px-4
              file:rounded-full file:border-0
              file:text-sm file:font-semibold
              file:bg-blue-50 file:text-blue-700
              hover:file:bg-blue-100
              disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {file1 && (
            <p className="mt-2 text-sm text-green-600">
              ✓ 已选择: {file1.name}
            </p>
          )}
        </div>

        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-blue-500 transition-colors bg-gray-50">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            序列文件 2
          </label>
          <input
            ref={input2Ref}
            type="file"
            accept=".fasta,.fa,.fna,.ffn,.faa,.frn"
            onChange={(e) => handleFileChange(e, setFile2)}
            disabled={disabled}
            className="block w-full text-sm text-gray-500
              file:mr-4 file:py-2 file:px-4
              file:rounded-full file:border-0
              file:text-sm file:font-semibold
              file:bg-blue-50 file:text-blue-700
              hover:file:bg-blue-100
              disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {file2 && (
            <p className="mt-2 text-sm text-green-600">
              ✓ 已选择: {file2.name}
            </p>
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={!file1 || !file2 || disabled}
          className="w-full py-3 px-6 bg-blue-600 text-white font-semibold rounded-lg
            hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500
            focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors"
        >
          {disabled ? '处理中...' : '开始比对'}
        </button>
      </div>

      <div className="mt-6 p-4 bg-blue-50 rounded-lg">
        <h3 className="font-semibold text-blue-800 mb-2">使用说明</h3>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• 上传两个FASTA格式的DNA序列文件</li>
          <li>• 支持 .fasta, .fa, .fna 等扩展名</li>
          <li>• 使用 Needleman-Wunsch 全局比对算法</li>
          <li>• 匹配的碱基将以绿色高亮显示</li>
        </ul>
      </div>
    </div>
  );
};

export default FileUpload;
