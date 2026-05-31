import WebGPURenderer from './WebGPURenderer.js';
import EfficientVoxelWorld from './EfficientVoxelWorld.js';
import TerrainGenerator from './TerrainGenerator.js';
import ParticleSystem from './ParticleSystem.js';
import DropItemSystem from './DropItemSystem.js';
import BuildPreviewSystem from './BuildPreviewSystem.js';
import NetworkManager from './NetworkManager.js';
import DevConsole from './DevConsole.js';
import Camera from './Camera.js';
import InputHandler from './InputHandler.js';

class VoxelEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = null;
    this.chunkManager = null;
    this.terrainGenerator = null;
    this.giSystem = null;
    this.networkManager = null;
    this.devConsole = null;
    this.camera = null;
    this.inputHandler = null;
    this.running = false;
    this.time = 0;
    this.dayTime = 8 * 60;
    this.frameCount = 0;
    this.lastFpsUpdate = 0;
  }

  async init() {
    this.renderer = new WebGPURenderer(this.canvas);
    await this.renderer.init();

    this.camera = new Camera(this.canvas);
    this.inputHandler = new InputHandler(this.canvas, this.camera);
    
    this.terrainGenerator = new TerrainGenerator(this.renderer);
    await this.terrainGenerator.init();

    this.voxelWorld = new EfficientVoxelWorld(this.renderer, this.terrainGenerator, this.camera);
    await this.voxelWorld.init();

    this.particleSystem = new ParticleSystem(this.renderer, 8192);
    await this.particleSystem.init();

    this.dropItemSystem = new DropItemSystem(this.renderer, this.voxelWorld, 512);
    await this.dropItemSystem.init();

    this.buildPreviewSystem = new BuildPreviewSystem(this.renderer, this.voxelWorld);
    await this.buildPreviewSystem.init();

    this.networkManager = new NetworkManager();

    this.devConsole = new DevConsole();

    this.setupEventListeners();
  }

  setupEventListeners() {
    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.camera.updateAspect();
    });

    this.inputHandler.on('toggle-day-night', () => {
      this.dayTime = this.dayTime < 12 * 60 ? 20 * 60 : 8 * 60;
    });
  }

  start() {
    this.running = true;
    this.lastTime = performance.now();
    this.animate();
  }

  stop() {
    this.running = false;
  }

  animate() {
    if (!this.running) return;

    const currentTime = performance.now();
    const deltaTime = (currentTime - this.lastTime) / 1000;
    this.lastTime = currentTime;

    this.time += deltaTime;
    this.updateDayNightCycle();
    this.update(deltaTime);
    this.render();
    this.updateStats(currentTime);

    requestAnimationFrame(() => this.animate());
  }

  updateDayNightCycle() {
    this.dayTime += 0.5;
    if (this.dayTime >= 24 * 60) {
      this.dayTime = 0;
    }

    const hours = Math.floor(this.dayTime / 60);
    const minutes = Math.floor(this.dayTime % 60);
    document.getElementById('time').textContent = 
      `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

    const sunAngle = (this.dayTime / (24 * 60)) * Math.PI * 2 - Math.PI / 2;
    const sunHeight = Math.sin(sunAngle);
    
    this.voxelWorld.setSunDirection(
      Math.cos(sunAngle) * 0.5,
      sunHeight,
      0.866
    );

    const ambientIntensity = Math.max(0.1, Math.min(1.0, sunHeight * 0.5 + 0.5));
    this.voxelWorld.setAmbientIntensity(ambientIntensity);
  }

  update(deltaTime) {
    this.inputHandler.update(deltaTime);
    this.voxelWorld.update();
    this.particleSystem.update(deltaTime, this.camera);
    this.dropItemSystem.update(deltaTime);
    this.buildPreviewSystem.update(this.camera);
    
    if (this.inputHandler.leftClicked) {
      const result = this.buildPreviewSystem.destroyVoxel();
      if (result) {
        const colors = [
          [0.6, 0.4, 0.25],
          [0.25, 0.65, 0.2],
          [0.55, 0.45, 0.3],
          [0.3, 0.4, 0.8]
        ];
        const color = colors[Math.min(result.voxelType, colors.length - 1)] || [0.5, 0.5, 0.5];
        this.particleSystem.spawnParticles(result.position, color, 24);
        this.dropItemSystem.spawnDropItem(result.position, result.voxelType, color);
      }
      this.inputHandler.leftClicked = false;
    }
    
    if (this.inputHandler.rightClicked) {
      this.buildPreviewSystem.placeVoxel(2);
      this.inputHandler.rightClicked = false;
    }
  }

  render() {
    const startTime = performance.now();
    
    const commandEncoder = this.renderer.device.createCommandEncoder();
    
    this.particleSystem.compute(commandEncoder);
    
    this.renderer.beginRender();
    
    const passEncoder = this.renderer.getPassEncoder();
    
    this.devConsole.setVisibleChunks(this.voxelWorld.getVisibleChunksCount());
    
    this.voxelWorld.render(this.camera);
    this.dropItemSystem.render(passEncoder);
    this.particleSystem.render(passEncoder);
    this.buildPreviewSystem.render(passEncoder, this.camera.getViewProjMatrix());
    
    this.renderer.endRender();
    
    const renderTime = performance.now() - startTime;
    this.devConsole.setGITime(renderTime);
    this.devConsole.setGPUTime(renderTime * 0.8);
    
    this.devConsole.setParticleCount(this.particleSystem.maxParticles);
    this.devConsole.setDropItemCount(this.dropItemSystem.getActiveCount());
  }

  updateStats(currentTime) {
    this.frameCount++;
    
    if (currentTime - this.lastFpsUpdate >= 1000) {
      const fps = Math.round(this.frameCount * 1000 / (currentTime - this.lastFpsUpdate));
      this.devConsole.setFPS(fps);
      this.frameCount = 0;
      this.lastFpsUpdate = currentTime;
    }

    this.devConsole.setChunks(this.voxelWorld.getLoadedChunksCount());
    this.devConsole.setVertices(this.voxelWorld.getTotalVertices());
    
    if (performance.memory) {
      this.devConsole.setMemory(performance.memory.usedJSHeapSize / (1024 * 1024));
    }
  }
}

export default VoxelEngine;
