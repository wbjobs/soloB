import React from 'react';
import { FileUploader } from './components/FileUploader';
import { ParameterPanel } from './components/ParameterPanel';
import { RenderCanvas } from './components/RenderCanvas';
import { DebugPanel } from './components/DebugPanel';

function App() {
  return (
    <div className="min-h-screen bg-deep-blue grid-bg">
      <header className="border-b border-gray-800 bg-black/30 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-tech-blue/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-tech-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white font-orbitron glow-text">
                WebAssembly 光线追踪器
              </h1>
              <p className="text-sm text-gray-400">
                基于 Rust + WASM 的实时光线追踪渲染平台
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-12 gap-6 h-[calc(100vh-140px)]">
          <div className="col-span-3 bg-black/40 rounded-xl border border-gray-800 overflow-hidden">
            <div className="h-full overflow-y-auto p-4 space-y-6">
              <FileUploader />
              <div className="border-t border-gray-800 pt-6">
                <ParameterPanel />
              </div>
            </div>
          </div>

          <div className="col-span-6 bg-black/40 rounded-xl border border-gray-800 flex items-center justify-center p-6">
            <RenderCanvas />
          </div>

          <div className="col-span-3 bg-black/40 rounded-xl border border-gray-800 overflow-hidden">
            <DebugPanel />
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
