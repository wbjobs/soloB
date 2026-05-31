import VoxelEngine from './engine/VoxelEngine.js';

async function init() {
  const canvas = document.getElementById('canvas');
  const engine = new VoxelEngine(canvas);
  
  try {
    await engine.init();
    engine.start();
  } catch (error) {
    console.error('引擎初始化失败:', error);
    alert('WebGPU 不支持或初始化失败');
  }
}

init();
