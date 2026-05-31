import React from 'react';

interface ProgressBarProps {
  step: number;
  total: number;
  message: string;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ step, total, message }) => {
  const percentage = Math.round((step / total) * 100);

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="flex justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">{message}</span>
        <span className="text-sm font-medium text-gray-700">{step}/{total}</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
        <div
          className="bg-gradient-to-r from-blue-500 to-blue-600 h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="text-center mt-2 text-sm text-gray-500">
        {percentage}%
      </div>
    </div>
  );
};

export default ProgressBar;
