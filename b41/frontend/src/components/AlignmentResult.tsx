import React, { useState, useMemo } from 'react';
import { AlignmentResult } from '../types';
import SidebarDetail from './SidebarDetail';

interface AlignmentResultProps {
  result: AlignmentResult;
  taskId: string;
  fileName1: string;
  fileName2: string;
}

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

const AlignmentResultComponent: React.FC<AlignmentResultProps> = ({
  result,
  taskId,
  fileName1,
  fileName2,
}) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<PositionDetail | null>(null);

  const originalIndices = useMemo(() => {
    const seq1Indices: (number | null)[] = [];
    const seq2Indices: (number | null)[] = [];
    
    let idx1 = 0;
    let idx2 = 0;
    
    for (let i = 0; i < result.aligned_a.length; i++) {
      if (result.aligned_a[i] === '-') {
        seq1Indices.push(null);
      } else {
        seq1Indices.push(idx1);
        idx1++;
      }
      
      if (result.aligned_b[i] === '-') {
        seq2Indices.push(null);
      } else {
        seq2Indices.push(idx2);
        idx2++;
      }
    }
    
    return { seq1Indices, seq2Indices };
  }, [result]);

  const getPositionDetail = (alignmentIndex: number): PositionDetail => {
    const char1 = result.aligned_a[alignmentIndex];
    const char2 = result.aligned_b[alignmentIndex];
    const alignChar = result.alignment_string[alignmentIndex];
    
    let alignmentType: 'match' | 'mismatch' | 'gap1' | 'gap2';
    if (alignChar === '|') {
      alignmentType = 'match';
    } else if (alignChar === '*') {
      alignmentType = 'mismatch';
    } else if (char1 === '-') {
      alignmentType = 'gap1';
    } else {
      alignmentType = 'gap2';
    }
    
    const seq1OriginalIndex = originalIndices.seq1Indices[alignmentIndex];
    const seq2OriginalIndex = originalIndices.seq2Indices[alignmentIndex];
    
    const contextSize = 10;
    const contextStart = Math.max(0, alignmentIndex - contextSize);
    const contextEnd = Math.min(result.aligned_a.length - 1, alignmentIndex + contextSize);
    
    const contextSeq1 = result.aligned_a.slice(contextStart, contextEnd + 1);
    const contextSeq2 = result.aligned_b.slice(contextStart, contextEnd + 1);
    const contextAlignment = result.alignment_string.slice(contextStart, contextEnd + 1);
    
    return {
      alignmentIndex,
      seq1OriginalIndex,
      seq2OriginalIndex,
      char1,
      char2,
      alignmentType,
      contextSeq1,
      contextSeq2,
      contextAlignment,
      contextStart,
      contextEnd
    };
  };

  const handlePositionClick = (alignmentIndex: number, isMatch: boolean) => {
    if (isMatch) {
      const detail = getPositionDetail(alignmentIndex);
      setSelectedDetail(detail);
      setSidebarOpen(true);
    }
  };

  const handleCloseSidebar = () => {
    setSidebarOpen(false);
  };

  const renderMatchPosition = (
    char: string,
    alignmentIndex: number,
    isMatch: boolean,
    isGap: boolean
  ) => {
    let baseClassName = '';
    
    if (isGap) {
      baseClassName = 'gap-char';
    } else if (isMatch) {
      baseClassName = 'match-char';
    } else {
      baseClassName = 'mismatch-char';
    }
    
    const className = `${baseClassName} ${isMatch ? 'cursor-pointer hover:scale-125 hover:shadow-lg transition-all duration-200 select-none' : ''}`;
    
    return (
      <span
        key={alignmentIndex}
        className={className}
        onClick={() => handlePositionClick(alignmentIndex, isMatch)}
        title={isMatch ? `点击查看位置 ${alignmentIndex + 1} 的详细信息` : ''}
      >
        {char}
      </span>
    );
  };

  const renderSequenceLine = (
    sequence: string,
    alignmentString: string,
    label: string,
    startOffset: number
  ) => {
    const seqElements: React.ReactNode[] = [];
    
    for (let j = 0; j < sequence.length; j++) {
      const char = sequence[j];
      const alignChar = alignmentString[j];
      const isMatch = alignChar === '|';
      const isGap = char === '-';
      const actualIndex = startOffset + j;
      
      seqElements.push(
        renderMatchPosition(char, actualIndex, isMatch, isGap)
      );
    }
    
    return seqElements;
  };

  const renderAllLines = () => {
    const lines: React.ReactNode[] = [];
    const lineLength = 60;
    
    for (let i = 0; i < result.aligned_a.length; i += lineLength) {
      const end = Math.min(i + lineLength, result.aligned_a.length);
      const seq1Chunk = result.aligned_a.slice(i, end);
      const seq2Chunk = result.aligned_b.slice(i, end);
      const alignChunk = result.alignment_string.slice(i, end);
      
      lines.push(
        <div key={i} className="mb-4">
          <div className="flex items-center">
            <span className="w-32 text-sm font-medium text-gray-600 shrink-0">
              序列 1 {i + 1}-{end}
            </span>
            <div className="alignment-line text-lg overflow-x-auto">
              {renderSequenceLine(seq1Chunk, alignChunk, '序列 1', i)}
            </div>
          </div>
          <div className="flex items-center">
            <span className="w-32 shrink-0"></span>
            <div className="alignment-line text-lg overflow-x-auto">
              {alignChunk.split('').map((char, idx) => {
                let className = '';
                const actualIndex = i + idx;
                const isMatch = char === '|';
                
                if (char === '|') className = 'connector-match';
                else if (char === '*') className = 'connector-mismatch';
                else className = 'connector-gap';
                
                return (
                  <span
                    key={idx}
                    className={`${className} ${isMatch ? 'cursor-pointer' : ''}`}
                    onClick={() => handlePositionClick(actualIndex, isMatch)}
                    title={isMatch ? `点击查看位置 ${actualIndex + 1} 的详细信息` : ''}
                  >
                    {char}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="flex items-center">
            <span className="w-32 text-sm font-medium text-gray-600 shrink-0">
              序列 2 {i + 1}-{end}
            </span>
            <div className="alignment-line text-lg overflow-x-auto">
              {renderSequenceLine(seq2Chunk, alignChunk, '序列 2', i)}
            </div>
          </div>
        </div>
      );
    }
    
    return lines;
  };

  return (
    <>
      <div className={`w-full max-w-5xl mx-auto p-6 transition-all duration-300 ${sidebarOpen ? 'pr-96' : ''}`}>
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
            <h2 className="text-2xl font-bold text-white">比对结果</h2>
            <p className="text-blue-100 text-sm mt-1">任务ID: {taskId}</p>
          </div>
          
          <div className="p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-sm text-blue-600 font-medium">文件 1</p>
                <p className="text-sm text-gray-700 mt-1 truncate">{fileName1}</p>
              </div>
              <div className="bg-green-50 rounded-lg p-4">
                <p className="text-sm text-green-600 font-medium">文件 2</p>
                <p className="text-sm text-gray-700 mt-1 truncate">{fileName2}</p>
              </div>
              <div className="bg-purple-50 rounded-lg p-4">
                <p className="text-sm text-purple-600 font-medium">序列 1 长度</p>
                <p className="text-2xl font-bold text-purple-700">
                  {result.aligned_a.replace(/-/g, '').length}
                </p>
              </div>
              <div className="bg-orange-50 rounded-lg p-4">
                <p className="text-sm text-orange-600 font-medium">最终得分</p>
                <p className="text-2xl font-bold text-orange-700">
                  {result.score}
                </p>
              </div>
            </div>

            <div className="mb-6">
              <h3 className="font-semibold text-gray-700 mb-3">图例</h3>
              <div className="flex flex-wrap gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 rounded match-char cursor-pointer">A</span>
                  <span className="text-gray-600">匹配 (点击查看详情)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 rounded mismatch-char">T</span>
                  <span className="text-gray-600">错配</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 rounded gap-char">-</span>
                  <span className="text-gray-600">空位</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="connector-match font-bold">|</span>
                  <span className="text-gray-600">匹配连接</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="connector-mismatch font-bold">*</span>
                  <span className="text-gray-600">错配连接</span>
                </div>
              </div>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-6">
              <p className="text-sm text-yellow-800">
                💡 <strong>提示：</strong>点击任意绿色高亮的匹配碱基或匹配连接符（|），可以查看该位置的详细信息。
              </p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 overflow-x-auto">
              <h3 className="font-semibold text-gray-700 mb-4">序列比对</h3>
              {renderAllLines()}
            </div>

            <div className="mt-6 p-4 bg-gray-100 rounded-lg">
              <h3 className="font-semibold text-gray-700 mb-2">比对统计</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">总长度</p>
                  <p className="font-bold text-gray-800">{result.aligned_a.length}</p>
                </div>
                <div>
                  <p className="text-gray-500">匹配数</p>
                  <p className="font-bold text-green-600">
                    {(result.alignment_string.match(/\|/g) || []).length}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">错配数</p>
                  <p className="font-bold text-red-600">
                    {(result.alignment_string.match(/\*/g) || []).length}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">空位总数</p>
                  <p className="font-bold text-gray-600">
                    {(result.aligned_a.match(/-/g) || []).length + 
                     (result.aligned_b.match(/-/g) || []).length}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <SidebarDetail
        isOpen={sidebarOpen}
        onClose={handleCloseSidebar}
        detail={selectedDetail}
      />
    </>
  );
};

export default AlignmentResultComponent;
