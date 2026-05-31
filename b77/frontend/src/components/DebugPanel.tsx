import React from 'react';
import { useRenderStore } from '../store/useRenderStore';

export const DebugPanel: React.FC = () => {
  const { debugMode, setDebugMode, debugData, selectedPixel } = useRenderStore();

  if (!debugMode) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <button
          onClick={() => setDebugMode(true)}
          className="w-full py-3 px-4 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <span>启用调试模式</span>
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-tech-blue glow-text">调试面板</h3>
          <button
            onClick={() => setDebugMode(false)}
            className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {selectedPixel && (
          <div className="bg-gray-800/50 rounded-lg p-4">
            <h4 className="text-sm font-medium text-tech-blue mb-3">选中像素</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="text-gray-400">X:</div>
              <div className="text-white font-mono">{selectedPixel.x}</div>
              <div className="text-gray-400">Y:</div>
              <div className="text-white font-mono">{selectedPixel.y}</div>
            </div>
          </div>
        )}

        {debugData ? (
          <>
            <div className="bg-gray-800/50 rounded-lg p-4">
              <h4 className="text-sm font-medium text-tech-blue mb-3">光线路径树</h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {debugData.rayTree.map((ray, index) => (
                  <div key={index} className="bg-gray-900 rounded p-2 text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 bg-tech-blue/20 text-tech-blue rounded">
                        深度 {ray.depth}
                      </span>
                      <span className="text-gray-400">ID: {ray.id.slice(0, 8)}</span>
                    </div>
                    <div className="text-gray-300 font-mono">
                      起点: ({ray.origin.x.toFixed(2)}, {ray.origin.y.toFixed(2)}, {ray.origin.z.toFixed(2)})
                    </div>
                    <div className="text-gray-300 font-mono">
                      颜色: ({ray.color.x.toFixed(3)}, {ray.color.y.toFixed(3)}, {ray.color.z.toFixed(3)})
                    </div>
                    {ray.children.length > 0 && (
                      <div className="text-gray-500 mt-1">
                        子光线: {ray.children.length} 条
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gray-800/50 rounded-lg p-4">
              <h4 className="text-sm font-medium text-tech-blue mb-3">相交信息</h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {debugData.intersections.map((intersect, index) => (
                  <div key={index} className="bg-gray-900 rounded p-2 text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 bg-warning-yellow/20 text-warning-yellow rounded">
                        三角形 #{intersect.triangleIndex}
                      </span>
                    </div>
                    <div className="text-gray-300 font-mono">
                      点: ({intersect.point.x.toFixed(3)}, {intersect.point.y.toFixed(3)}, {intersect.point.z.toFixed(3)})
                    </div>
                    <div className="text-gray-300 font-mono">
                      法向量: ({intersect.normal.x.toFixed(3)}, {intersect.normal.y.toFixed(3)}, {intersect.normal.z.toFixed(3)})
                    </div>
                    <div className="text-gray-300 font-mono">
                      UV: ({intersect.uv.u.toFixed(3)}, {intersect.uv.v.toFixed(3)})
                    </div>
                    <div className="text-gray-400">
                      材质: {intersect.material}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gray-800/50 rounded-lg p-4">
              <h4 className="text-sm font-medium text-tech-blue mb-3">着色计算</h4>
              <div className="space-y-3">
                {debugData.shadingValues.map((shading, index) => (
                  <div key={index} className="bg-gray-900 rounded p-3 text-xs">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-white">{shading.step}</span>
                      <span className="px-2 py-0.5 bg-success-green/20 text-success-green rounded">
                        {(shading.contribution * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="mb-2">
                      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-tech-blue to-cyan-400"
                          style={{ width: `${shading.contribution * 100}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-gray-400 mb-1">{shading.description}</div>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-6 h-6 rounded border border-gray-600"
                        style={{
                          backgroundColor: `rgb(${Math.round(shading.value.x * 255)}, ${Math.round(shading.value.y * 255)}, ${Math.round(shading.value.z * 255)})`
                        }}
                      />
                      <span className="text-gray-300 font-mono">
                        ({shading.value.x.toFixed(3)}, {shading.value.y.toFixed(3)}, {shading.value.z.toFixed(3)})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
              </svg>
            </div>
            <p className="text-gray-400 text-sm">点击渲染画布上的任意像素</p>
            <p className="text-gray-500 text-xs mt-1">查看该像素的光线追踪详细信息</p>
          </div>
        )}
      </div>
    </div>
  );
};
