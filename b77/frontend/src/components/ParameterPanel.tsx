import React from 'react';
import { useRenderStore } from '../store/useRenderStore';

export const ParameterPanel: React.FC = () => {
  const { params, setParams } = useRenderStore();

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-bold text-tech-blue glow-text mb-4">
        渲染参数
      </h3>

      <div className="space-y-4">
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm text-gray-300">采样数 (Samples)</label>
            <span className="text-sm text-tech-blue font-mono">{params.samples}</span>
          </div>
          <input
            type="range"
            min="1"
            max="64"
            value={params.samples}
            onChange={(e) => setParams({ samples: parseInt(e.target.value) })}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-tech-blue"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>1</span>
            <span>64</span>
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm text-gray-300">最大反射深度</label>
            <span className="text-sm text-tech-blue font-mono">{params.maxDepth}</span>
          </div>
          <input
            type="range"
            min="1"
            max="20"
            value={params.maxDepth}
            onChange={(e) => setParams({ maxDepth: parseInt(e.target.value) })}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-tech-blue"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>1</span>
            <span>20</span>
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-3">光源位置</label>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">X</label>
              <input
                type="number"
                step="0.1"
                value={params.lightPosition.x}
                onChange={(e) => setParams({
                  lightPosition: { ...params.lightPosition, x: parseFloat(e.target.value) }
                })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm focus:border-tech-blue focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Y</label>
              <input
                type="number"
                step="0.1"
                value={params.lightPosition.y}
                onChange={(e) => setParams({
                  lightPosition: { ...params.lightPosition, y: parseFloat(e.target.value) }
                })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm focus:border-tech-blue focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Z</label>
              <input
                type="number"
                step="0.1"
                value={params.lightPosition.z}
                onChange={(e) => setParams({
                  lightPosition: { ...params.lightPosition, z: parseFloat(e.target.value) }
                })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm focus:border-tech-blue focus:outline-none transition-colors"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-3">渲染分辨率</label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">宽度</label>
              <input
                type="number"
                min="128"
                max="1024"
                step="64"
                value={params.resolution.width}
                onChange={(e) => setParams({
                  resolution: { ...params.resolution, width: parseInt(e.target.value) }
                })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm focus:border-tech-blue focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">高度</label>
              <input
                type="number"
                min="128"
                max="1024"
                step="64"
                value={params.resolution.height}
                onChange={(e) => setParams({
                  resolution: { ...params.resolution, height: parseInt(e.target.value) }
                })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm focus:border-tech-blue focus:outline-none transition-colors"
              />
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-700">
          <h4 className="text-md font-semibold text-tech-blue mb-4">智能采样优化</h4>
          
          <div className="flex items-center justify-between mb-4">
            <label className="text-sm text-gray-300">启用自适应采样</label>
            <button
              onClick={() => setParams({ adaptiveSampling: !params.adaptiveSampling })}
              className={`relative w-12 h-6 rounded-full transition-colors duration-300 ${
                params.adaptiveSampling ? 'bg-tech-blue' : 'bg-gray-600'
              }`}
            >
              <span
                className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform duration-300 ${
                  params.adaptiveSampling ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {params.adaptiveSampling && (
            <>
              <div className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-gray-300">边缘检测阈值</label>
                  <span className="text-sm text-tech-blue font-mono">{params.edgeThreshold.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="0.5"
                  step="0.01"
                  value={params.edgeThreshold}
                  onChange={(e) => setParams({ edgeThreshold: parseFloat(e.target.value) })}
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-tech-blue"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>0.05</span>
                  <span>0.5</span>
                </div>
              </div>

              <div className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-gray-300">最大采样数</label>
                  <span className="text-sm text-tech-blue font-mono">{params.maxSamples}</span>
                </div>
                <input
                  type="range"
                  min="8"
                  max="128"
                  step="8"
                  value={params.maxSamples}
                  onChange={(e) => setParams({ maxSamples: parseInt(e.target.value) })}
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-tech-blue"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>8</span>
                  <span>128</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="pt-4 border-t border-gray-800">
        <div className="bg-gray-800/50 rounded-lg p-4 space-y-2">
          <p className="text-xs text-gray-400">
            <span className="text-tech-blue">提示：</span> 较高的采样数和反射深度会产生更真实的效果，但渲染时间也会更长。
          </p>
        </div>
      </div>
    </div>
  );
};
