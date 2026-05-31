class DevConsole {
  constructor() {
    this.fpsElement = document.getElementById('fps');
    this.giTimeElement = document.getElementById('gi-time');
    this.gpuTimeElement = document.getElementById('gpu-time');
    this.memoryElement = document.getElementById('memory');
    this.chunksElement = document.getElementById('chunks');
    this.visibleChunksElement = document.getElementById('visible-chunks');
    this.verticesElement = document.getElementById('vertices');
    this.particlesElement = document.getElementById('particles');
    this.dropItemsElement = document.getElementById('drop-items');

    this.stats = {
      fps: 0,
      giTime: 0,
      gpuTime: 0,
      memory: 0,
      chunks: 0,
      visibleChunks: 0,
      vertices: 0,
      particles: 0,
      dropItems: 0
    };

    this.history = {
      fps: [],
      giTime: [],
      gpuTime: [],
      memory: []
    };

    this.maxHistory = 60;
  }

  setFPS(fps) {
    this.stats.fps = fps;
    this.history.fps.push(fps);
    if (this.history.fps.length > this.maxHistory) {
      this.history.fps.shift();
    }
    this.updateElement(this.fpsElement, fps);
  }

  setGITime(ms) {
    this.stats.giTime = ms;
    this.history.giTime.push(ms);
    if (this.history.giTime.length > this.maxHistory) {
      this.history.giTime.shift();
    }
    this.updateElement(this.giTimeElement, ms.toFixed(2) + 'ms');
  }

  setGPUTime(ms) {
    this.stats.gpuTime = ms;
    this.history.gpuTime.push(ms);
    if (this.history.gpuTime.length > this.maxHistory) {
      this.history.gpuTime.shift();
    }
    this.updateElement(this.gpuTimeElement, ms.toFixed(2) + 'ms');
  }

  setMemory(mb) {
    this.stats.memory = mb;
    this.history.memory.push(mb);
    if (this.history.memory.length > this.maxHistory) {
      this.history.memory.shift();
    }
    this.updateElement(this.memoryElement, mb.toFixed(1) + 'MB');
  }

  setChunks(count) {
    this.stats.chunks = count;
    this.updateElement(this.chunksElement, count);
  }

  setVisibleChunks(count) {
    this.stats.visibleChunks = count;
    this.updateElement(this.visibleChunksElement, count);
  }

  setVertices(count) {
    this.stats.vertices = count;
    this.updateElement(this.verticesElement, this.formatNumber(count));
  }

  setParticleCount(count) {
    this.stats.particles = count;
    this.updateElement(this.particlesElement, count);
  }

  setDropItemCount(count) {
    this.stats.dropItems = count;
    this.updateElement(this.dropItemsElement, count);
  }

  updateElement(element, value) {
    if (element) {
      element.textContent = value;
    }
  }

  formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  getStats() {
    return { ...this.stats };
  }

  getAverageFPS() {
    if (this.history.fps.length === 0) return 0;
    return this.history.fps.reduce((a, b) => a + b, 0) / this.history.fps.length;
  }

  getAverageGITime() {
    if (this.history.giTime.length === 0) return 0;
    return this.history.giTime.reduce((a, b) => a + b, 0) / this.history.giTime.length;
  }

  getAverageGPUTime() {
    if (this.history.gpuTime.length === 0) return 0;
    return this.history.gpuTime.reduce((a, b) => a + b, 0) / this.history.gpuTime.length;
  }

  logPerformance() {
    console.log('=== Performance Stats ===');
    console.log(`FPS: ${this.stats.fps} (Avg: ${this.getAverageFPS().toFixed(1)})`);
    console.log(`GI Time: ${this.stats.giTime.toFixed(2)}ms (Avg: ${this.getAverageGITime().toFixed(2)}ms)`);
    console.log(`GPU Time: ${this.stats.gpuTime.toFixed(2)}ms (Avg: ${this.getAverageGPUTime().toFixed(2)}ms)`);
    console.log(`Memory: ${this.stats.memory.toFixed(1)}MB`);
    console.log(`Chunks: ${this.stats.chunks} (Visible: ${this.stats.visibleChunks})`);
    console.log(`Vertices: ${this.stats.vertices}`);
  }
}

export default DevConsole;
