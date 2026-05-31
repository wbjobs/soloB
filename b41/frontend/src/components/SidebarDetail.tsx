import React from 'react';

interface PositionDetail {
  alignmentIndex: number;
  seq1OriginalIndex: number | null;
  seq2OriginalIndex: number | null;
  char1: string;
  char2: string;
  alignmentType: 'match' | 'mismatch' | 'gap1' | 'gap2';
  contextSeq1: string;
  contextSeq2: string;
  contextAlignment: string;
  contextStart: number;
  contextEnd: number;
}

interface SidebarDetailProps {
  isOpen: boolean;
  onClose: () => void;
  detail: PositionDetail | null;
}

const SidebarDetail: React.FC<SidebarDetailProps> = ({ isOpen, onClose, detail }) => {
  if (!detail) return null;

  const getTypeColor = () => {
    switch (detail.alignmentType) {
      case 'match': return 'text-green-600 bg-green-100';
      case 'mismatch': return 'text-orange-600 bg-orange-100';
      case 'gap1':
      case 'gap2': return 'text-gray-600 bg-gray-100';
    }
  };

  const getTypeLabel = () => {
    switch (detail.alignmentType) {
      case 'match': return '匹配';
      case 'mismatch': return '错配';
      case 'gap1': return '序列1空位';
      case 'gap2': return '序列2空位';
    }
  };

  const renderContext = (sequence: string, currentChar: string, centerIdx: number) => {
    const chars = sequence.split('');
    return chars.map((char, idx) => {
      const isCenter = idx === centerIdx;
      let className = 'inline-block text-sm font-mono';
      
      if (isCenter) {
        className += ' bg-yellow-300 text-black font-bold px-1 mx-0.5';
      } else if (char === '-') {
        className += ' text-gray-400';
      } else {
        className += ' text-gray-700';
      }
      
      return <span key={idx} className={className}>{char}</span>;
    });
  };

  const centerIdxInContext = 10;

  return (
    <div className={`fixed right-0 top-0 h-full w-96 bg-white shadow-2xl transform transition-transform duration-300 ease-in-out z-50 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-blue-600 to-blue-700">
          <h3 className="text-lg font-bold text-white">位置详情</h3>
          <button
            onClick={onClose}
            className="text-white hover:text-blue-200 transition-colors p-1 rounded-full hover:bg-white/20"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <div className="bg-blue-50 rounded-lg p-4">
            <p className="text-sm text-blue-600 font-medium mb-1">比对位置索引</p>
            <p className="text-2xl font-bold text-blue-800">{detail.alignmentIndex + 1}</p>
          </div>

          <div>
            <p className="text-sm text-gray-500 mb-2">比对类型</p>
            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${getTypeColor()}`}>
              {getTypeLabel()}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-green-50 rounded-lg p-4">
              <p className="text-sm text-green-600 font-medium mb-1">序列 1</p>
              <p className="text-3xl font-bold text-green-700">{detail.char1 || '-'}</p>
              {detail.seq1OriginalIndex !== null ? (
                <p className="text-sm text-green-600 mt-1">
                  原始索引: <span className="font-semibold">{detail.seq1OriginalIndex + 1}</span>
                </p>
              ) : (
                <p className="text-sm text-gray-500 mt-1">空位</p>
              )}
            </div>
            <div className="bg-purple-50 rounded-lg p-4">
              <p className="text-sm text-purple-600 font-medium mb-1">序列 2</p>
              <p className="text-3xl font-bold text-purple-700">{detail.char2 || '-'}</p>
              {detail.seq2OriginalIndex !== null ? (
                <p className="text-sm text-purple-600 mt-1">
                  原始索引: <span className="font-semibold">{detail.seq2OriginalIndex + 1}</span>
                </p>
              ) : (
                <p className="text-sm text-gray-500 mt-1">空位</p>
              )}
            </div>
          </div>

          <div className="border-t pt-4">
            <h4 className="font-semibold text-gray-700 mb-3">
              上下文信息 (位置 {detail.contextStart + 1} - {detail.contextEnd})
            </h4>
            
            <div className="bg-gray-900 rounded-lg p-4 space-y-2">
              <div className="flex items-center">
                <span className="text-xs text-gray-400 w-20 shrink-0">序列 1:</span>
                <div className="font-mono overflow-x-auto">
                  {renderContext(detail.contextSeq1, detail.char1, centerIdxInContext)}
                </div>
              </div>
              <div className="flex items-center">
                <span className="text-xs text-gray-400 w-20 shrink-0">比对:</span>
                <div className="font-mono overflow-x-auto text-yellow-400">
                  {detail.contextAlignment.split('').map((char, idx) => {
                    const isCenter = idx === centerIdxInContext;
                    return (
                      <span
                        key={idx}
                        className={`inline-block text-sm ${isCenter ? 'bg-yellow-500 text-black font-bold px-1 mx-0.5' : ''}`}
                      >
                        {char === '|' ? '|' : char === '*' ? '*' : ' '}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center">
                <span className="text-xs text-gray-400 w-20 shrink-0">序列 2:</span>
                <div className="font-mono overflow-x-auto">
                  {renderContext(detail.contextSeq2, detail.char2, centerIdxInContext)}
                </div>
              </div>
            </div>

            <p className="text-xs text-gray-500 mt-2">
              * 黄色高亮部分为当前选中位置
            </p>
          </div>

          <div className="border-t pt-4">
            <h4 className="font-semibold text-gray-700 mb-3">碱基类型说明</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded bg-blue-100 text-blue-700 flex items-center justify-center font-bold">A</span>
                <span className="text-gray-600">腺嘌呤</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded bg-green-100 text-green-700 flex items-center justify-center font-bold">T</span>
                <span className="text-gray-600">胸腺嘧啶</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded bg-orange-100 text-orange-700 flex items-center justify-center font-bold">C</span>
                <span className="text-gray-600">胞嘧啶</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded bg-red-100 text-red-700 flex items-center justify-center font-bold">G</span>
                <span className="text-gray-600">鸟嘌呤</span>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t p-4">
          <button
            onClick={onClose}
            className="w-full py-2 px-4 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition-colors font-medium"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};

export default SidebarDetail;
