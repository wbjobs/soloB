import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useRenderStore } from '../store/useRenderStore';
import { useWebSocket } from '../hooks/useWebSocket';

export const RenderCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const {
    params,
    tiles,
    objData,
    currentTask,
    renderHistory,
    resetRender,
    setSelectedPixel,
    debugMode,
    isConnected,
    clearHistory
  } = useRenderStore();
  const { sendRenderRequest, sendDebugPixelRequest } = useWebSocket();
  const [hoveredPixel, setHoveredPixel] = useState<{ x: number; y: number } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const renderTiles = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0A1628';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const TILE_SIZE = 16;
    tiles.forEach((tile) => {
      const imageData = new ImageData(
        new Uint8ClampedArray(tile.pixels),
        tile.tileWidth,
        tile.tileHeight
      );
      ctx.putImageData(imageData, tile.tileX * TILE_SIZE, tile.tileY * TILE_SIZE);
    });

    if (debugMode && hoveredPixel) {
      ctx.strokeStyle = '#00D4FF';
      ctx.lineWidth = 2;
      ctx.strokeRect(hoveredPixel.x - 5, hoveredPixel.y - 5, 10, 10);
    }
  }, [tiles, debugMode, hoveredPixel]);

  useEffect(() => {
    renderTiles();
  }, [renderTiles]);

  const startRender = useCallback(() => {
    if (!objData || !isConnected) {
      if (!objData) alert('请先上传 OBJ 文件');
      if (!isConnected) alert('正在连接后端服务，请稍候...');
      return;
    }

    resetRender();
    sendRenderRequest(objData, {
      samples: params.samples,
      maxDepth: params.maxDepth,
      lightPosition: params.lightPosition,
      resolution: params.resolution,
      adaptiveSampling: params.adaptiveSampling,
      edgeThreshold: params.edgeThreshold,
      maxSamples: params.maxSamples,
    });
  }, [objData, isConnected, resetRender, sendRenderRequest, params]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!debugMode || !currentTask) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(e.clientX - rect.left);
    const y = Math.floor(e.clientY - rect.top);

    setSelectedPixel({ x, y });
    sendDebugPixelRequest(currentTask.taskId, x, y);
  }, [debugMode, currentTask, setSelectedPixel, sendDebugPixelRequest]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!debugMode) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(e.clientX - rect.left);
    const y = Math.floor(e.clientY - rect.top);

    setHoveredPixel({ x, y });
  }, [debugMode]);

  const handleMouseLeave = useCallback(() => {
    setHoveredPixel(null);
  }, []);

  const performanceComparison = useMemo(() => {
    const withAdaptive = renderHistory.filter(h => h.adaptiveSampling);
    const withoutAdaptive = renderHistory.filter(h => !h.adaptiveSampling);

    if (withAdaptive.length === 0 || withoutAdaptive.length === 0) {
      return null;
    }

    const avgWith = withAdaptive.reduce((sum, h) => sum + h.renderTimeMs, 0) / withAdaptive.length;
    const avgWithout = withoutAdaptive.reduce((sum, h) => sum + h.renderTimeMs, 0) / withoutAdaptive.length;
    const improvement = ((avgWithout - avgWith) / avgWithout * 100).toFixed(1);

    return { avgWith, avgWithout, improvement };
  }, [renderHistory]);

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={params.resolution.width}
          height={params.resolution.height}
          onClick={handleCanvasClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="rounded-lg glow-border cursor-crosshair"
          style={{ maxWidth: '100%', height: 'auto' }}
        />

        {currentTask && currentTask.status === 'rendering' && (
          <div className="absolute top-4 left-4 right-4">
            <div className="bg-black/70 backdrop-blur-sm rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-white">
                  渲染中... {params.adaptiveSampling && <span className="text-tech-blue">(自适应采样)</span>}
                </span>
                <span className="text-sm text-tech-blue font-mono">
                  {Math.round(currentTask.progress * 100)}%
                </span>
              </div>
              <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-tech-blue to-cyan-400 transition-all duration-300"
                  style={{ width: `${currentTask.progress * 100}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-gray-400 flex justify-between">
                <span>已完成: {currentTask.completedTiles} / {currentTask.totalTiles} 块</span>
                {currentTask.totalSamples && (
                  <span>采样数: {currentTask.totalSamples.toLocaleString()}</span>
                )}
              </div>
            </div>
          </div>
        )}

        {currentTask && currentTask.status === 'completed' && currentTask.renderTimeMs && (
          <div className="absolute top-4 left-4 right-4">
            <div className="bg-success-green/20 backdrop-blur-sm border border-success-green/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-success-green font-bold">✓ 渲染完成</span>
                <span className="text-sm text-white font-mono">
                  {formatTime(currentTask.renderTimeMs)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="text-gray-300">
                  采样模式: <span className="text-white">{currentTask.adaptiveSampling ? '自适应' : '统一'}</span>
                </div>
                <div className="text-gray-300">
                  总采样数: <span className="text-white">{currentTask.totalSamples?.toLocaleString()}</span>
                </div>
                {currentTask.samplesSaved !== undefined && currentTask.samplesSaved > 0 && (
                  <div className="col-span-2 text-success-green">
                    节省采样: {(currentTask.samplesSaved / 1000000).toFixed(2)}M ({((currentTask.samplesSaved / (currentTask.totalSamples || 1)) * 100).toFixed(1)}%)
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {debugMode && (
          <div className="absolute bottom-4 left-4 right-4">
            <div className="bg-black/70 backdrop-blur-sm rounded-lg p-3">
              <p className="text-sm text-tech-blue">
                🔍 调试模式已启用 - 点击任意像素查看光线追踪详情
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-4 flex-wrap justify-center">
        <button
          onClick={startRender}
          disabled={!objData || currentTask?.status === 'rendering'}
          className={`px-8 py-3 rounded-lg font-bold transition-all duration-300 ${
            objData && currentTask?.status !== 'rendering'
              ? 'bg-tech-blue text-black hover:bg-cyan-400 hover:shadow-lg hover:shadow-tech-blue/50'
              : 'bg-gray-700 text-gray-500 cursor-not-allowed'
          }`}
        >
          {currentTask?.status === 'rendering' ? '渲染中...' : '开始渲染'}
        </button>

        {renderHistory.length > 0 && (
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="px-6 py-3 rounded-lg font-bold bg-gray-700 text-white hover:bg-gray-600 transition-all duration-300"
          >
            {showHistory ? '隐藏历史' : '渲染历史'}
          </button>
        )}

        {!isConnected && (
          <div className="flex items-center gap-2 px-4 py-2 bg-warning-yellow/20 border border-warning-yellow/50 rounded-lg">
            <div className="w-2 h-2 bg-warning-yellow rounded-full animate-pulse" />
            <span className="text-sm text-warning-yellow">连接后端服务中...</span>
          </div>
        )}

        {isConnected && (
          <div className="flex items-center gap-2 px-4 py-2 bg-success-green/20 border border-success-green/50 rounded-lg">
            <div className="w-2 h-2 bg-success-green rounded-full" />
            <span className="text-sm text-success-green">已连接</span>
          </div>
        )}
      </div>

      {showHistory && renderHistory.length > 0 && (
        <div className="w-full max-w-2xl bg-gray-900/80 backdrop-blur-sm rounded-lg p-4 border border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-bold text-tech-blue">渲染历史与对比</h4>
            <button
              onClick={clearHistory}
              className="text-xs text-gray-400 hover:text-red-400 transition-colors"
            >
              清除历史
            </button>
          </div>

          {performanceComparison && (
            <div className="mb-4 p-3 bg-tech-blue/10 border border-tech-blue/30 rounded-lg">
              <h5 className="text-sm font-bold text-tech-blue mb-2">📊 性能对比</h5>
              <div className="grid grid-cols-3 gap-4 text-xs">
                <div>
                  <div className="text-gray-400">平均时间(启用)</div>
                  <div className="text-white font-mono">{formatTime(performanceComparison.avgWith)}</div>
                </div>
                <div>
                  <div className="text-gray-400">平均时间(禁用)</div>
                  <div className="text-white font-mono">{formatTime(performanceComparison.avgWithout)}</div>
                </div>
                <div>
                  <div className="text-gray-400">性能提升</div>
                  <div className="text-success-green font-mono font-bold">+{performanceComparison.improvement}%</div>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {renderHistory.slice().reverse().map((history, index) => (
              <div
                key={history.taskId}
                className="flex items-center justify-between p-2 bg-gray-800/50 rounded hover:bg-gray-800 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-gray-500 text-xs font-mono">#{renderHistory.length - index}</span>
                  <span className={`px-2 py-1 rounded text-xs font-bold ${
                    history.adaptiveSampling
                      ? 'bg-tech-blue/20 text-tech-blue'
                      : 'bg-gray-600 text-gray-300'
                  }`}>
                    {history.adaptiveSampling ? '自适应' : '统一'}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-gray-300 font-mono">{formatTime(history.renderTimeMs)}</span>
                  <span className="text-gray-400">
                    {(history.totalSamples / 1000000).toFixed(2)}M 采样
                  </span>
                  {history.adaptiveSampling && history.samplesSaved > 0 && (
                    <span className="text-success-green">
                      节省 {((history.samplesSaved / (history.totalSamples + history.samplesSaved)) * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
