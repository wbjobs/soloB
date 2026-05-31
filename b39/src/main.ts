import shaderCode from './shaders.wgsl?raw';
import type { Camera, XYZData } from './types';
import { getElementInfo } from './types';
import { loadXYZFromFile, computeBounds } from './xyzParser';
import {
  createPerspectiveMatrix,
  createLookAtMatrix,
  multiplyMatrices,
  invertMatrix,
} from './matrix';
import { generateSampleXYZ } from './sampleData';

class MolecularViewer {
  private canvas: HTMLCanvasElement;
  private context: GPUCanvasContext | null = null;
  private device: GPUDevice | null = null;
  private format: GPUTextureFormat = 'bgra8unorm';
  
  private renderPipeline: GPURenderPipeline | null = null;
  
  private cameraBindGroupLayout: GPUBindGroupLayout | null = null;
  private frameDataBindGroupLayout: GPUBindGroupLayout | null = null;
  
  private cameraBindGroup: GPUBindGroup | null = null;
  
  private cameraUniformBuffer: GPUBuffer | null = null;
  private lightUniformBuffer: GPUBuffer | null = null;
  
  private allFrameBuffers: GPUBuffer[] = [];
  private frameBindGroups: Map<number, GPUBindGroup> = new Map();
  private instanceDataBuffer: GPUBuffer | null = null;
  
  private streamingFrameSlots: GPUBuffer[] = [];
  private streamingBindGroups: Map<number, GPUBindGroup> = new Map();
  private lastUploadedFrame: number = -1;
  
  private depthTexture: GPUTexture | null = null;
  private depthTextureView: GPUTextureView | null = null;
  
  private xyzData: XYZData | null = null;
  private bounds: { min: [number, number, number]; max: [number, number, number]; center: [number, number, number]; size: number } | null = null;
  
  private camera: Camera = {
    rotationX: -0.3,
    rotationY: 0.5,
    zoom: 1.0,
    panX: 0,
    panY: 0,
  };
  
  private currentFrame: number = 0;
  private isPlaying: boolean = false;
  private playSpeed: number = 1.0;
  private lastFrameTime: number = 0;
  private frameAccumulator: number = 0;
  
  private atomScale: number = 1.0;
  
  private frameSlider: HTMLInputElement;
  private frameValue: HTMLSpanElement;
  private totalFrames: HTMLSpanElement;
  private speedSlider: HTMLInputElement;
  private speedValue: HTMLSpanElement;
  private atomSizeSlider: HTMLInputElement;
  private atomSizeValue: HTMLSpanElement;
  private playBtn: HTMLButtonElement;
  private pauseBtn: HTMLButtonElement;
  private resetBtn: HTMLButtonElement;
  private fileInput: HTMLInputElement;
  private loadSampleBtn: HTMLButtonElement;
  private fpsInfo: HTMLDivElement;
  
  private lastFpsTime: number = performance.now();
  private frameCount: number = 0;
  
  private isDragging: boolean = false;
  private isPanning: boolean = false;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;
  
  private cameraData: Float32Array;
  private lightData: Float32Array;
  
  private useStreaming: boolean = false;
  
  constructor() {
    this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
    
    this.frameSlider = document.getElementById('frameSlider') as HTMLInputElement;
    this.frameValue = document.getElementById('frameValue') as HTMLSpanElement;
    this.totalFrames = document.getElementById('totalFrames') as HTMLSpanElement;
    this.speedSlider = document.getElementById('speedSlider') as HTMLInputElement;
    this.speedValue = document.getElementById('speedValue') as HTMLSpanElement;
    this.atomSizeSlider = document.getElementById('atomSizeSlider') as HTMLInputElement;
    this.atomSizeValue = document.getElementById('atomSizeValue') as HTMLSpanElement;
    this.playBtn = document.getElementById('playBtn') as HTMLButtonElement;
    this.pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement;
    this.resetBtn = document.getElementById('resetBtn') as HTMLButtonElement;
    this.fileInput = document.getElementById('fileInput') as HTMLInputElement;
    this.loadSampleBtn = document.getElementById('loadSampleBtn') as HTMLButtonElement;
    this.fpsInfo = document.getElementById('fpsInfo') as HTMLDivElement;
    
    this.cameraData = new Float32Array(new ArrayBuffer(36 * 4));
    this.lightData = new Float32Array(new ArrayBuffer(16 * 4));
    
    this.init();
  }
  
  private async init(): Promise<void> {
    try {
      if (!navigator.gpu) {
        throw new Error('WebGPU not supported');
      }
      
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        throw new Error('Failed to find GPU adapter');
      }
      
      this.device = await adapter.requestDevice();
      
      this.context = this.canvas.getContext('webgpu');
      if (!this.context) {
        throw new Error('Failed to create WebGPU context');
      }
      
      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: 'opaque',
      });
      
      this.setupResizeHandler();
      this.setupInputHandlers();
      this.createPipelines();
      this.createStaticBuffers();
      
      const sampleData = generateSampleXYZ();
      this.loadXYZData(sampleData);
      
      const controls = document.getElementById('controls');
      const info = document.getElementById('info');
      if (controls) controls.style.display = 'block';
      if (info) info.style.display = 'block';
      
      this.animate();
    } catch (error) {
      console.error('Failed to initialize WebGPU:', error);
      const noWebGpu = document.getElementById('no-webgpu');
      if (noWebGpu) noWebGpu.style.display = 'block';
    }
  }
  
  private setupResizeHandler(): void {
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const newWidth = this.canvas.clientWidth * dpr;
      const newHeight = this.canvas.clientHeight * dpr;
      
      if (this.canvas.width !== newWidth || this.canvas.height !== newHeight) {
        this.canvas.width = newWidth;
        this.canvas.height = newHeight;
        this.recreateDepthTexture();
      }
    };
    
    resize();
    window.addEventListener('resize', resize);
  }
  
  private recreateDepthTexture(): void {
    if (!this.device) return;
    
    if (this.depthTexture) {
      this.depthTexture.destroy();
    }
    
    if (this.canvas.width === 0 || this.canvas.height === 0) return;
    
    this.depthTexture = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthTextureView = this.depthTexture.createView();
  }
  
  private setupInputHandlers(): void {
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.isPanning = e.button === 2 || e.shiftKey;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });
    
    this.canvas.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.isPanning = false;
    });
    
    this.canvas.addEventListener('mouseleave', () => {
      this.isDragging = false;
      this.isPanning = false;
    });
    
    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      
      if (this.isPanning) {
        this.camera.panX -= dx * 0.01;
        this.camera.panY += dy * 0.01;
      } else {
        this.camera.rotationY += dx * 0.005;
        this.camera.rotationX += dy * 0.005;
        this.camera.rotationX = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.camera.rotationX));
      }
      
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });
    
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = 1 + e.deltaY * 0.001;
      this.camera.zoom = Math.max(0.1, Math.min(10, this.camera.zoom * factor));
    }, { passive: false });
    
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    
    this.fileInput.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        try {
          const data = await loadXYZFromFile(file);
          this.loadXYZData(data);
        } catch (error) {
          alert('Failed to load XYZ file: ' + (error as Error).message);
        }
      }
    });
    
    this.loadSampleBtn.addEventListener('click', () => {
      const sampleData = generateSampleXYZ();
      this.loadXYZData(sampleData);
    });
    
    this.playBtn.addEventListener('click', () => {
      this.isPlaying = true;
    });
    
    this.pauseBtn.addEventListener('click', () => {
      this.isPlaying = false;
    });
    
    this.resetBtn.addEventListener('click', () => {
      this.currentFrame = 0;
      this.frameAccumulator = 0;
      this.isPlaying = false;
      this.lastUploadedFrame = -1;
      this.updateFrameUI();
    });
    
    this.frameSlider.addEventListener('input', (e) => {
      this.currentFrame = parseInt((e.target as HTMLInputElement).value, 10);
      this.isPlaying = false;
      this.updateFrameUI();
    });
    
    this.speedSlider.addEventListener('input', (e) => {
      this.playSpeed = parseFloat((e.target as HTMLInputElement).value);
      this.speedValue.textContent = this.playSpeed.toFixed(1) + 'x';
    });
    
    this.atomSizeSlider.addEventListener('input', (e) => {
      this.atomScale = parseFloat((e.target as HTMLInputElement).value);
      this.atomSizeValue.textContent = this.atomScale.toFixed(1);
    });
  }
  
  private createPipelines(): void {
    if (!this.device) return;
    
    const shaderModule = this.device.createShaderModule({ code: shaderCode });
    
    this.cameraBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    
    this.frameDataBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    
    const renderPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.cameraBindGroupLayout, this.frameDataBindGroupLayout],
    });
    
    this.renderPipeline = this.device.createRenderPipeline({
      layout: renderPipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],
      },
      primitive: {
        topology: 'triangle-list',
        frontFace: 'ccw',
        cullMode: 'none',
      },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus',
      },
    });
  }
  
  private createStaticBuffers(): void {
    if (!this.device) return;
    
    this.cameraUniformBuffer = this.device.createBuffer({
      size: 4 * 16 + 4 * 16 + 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    
    this.lightUniformBuffer = this.device.createBuffer({
      size: 16 + 16 + 16 + 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    
    this.cameraBindGroup = this.device.createBindGroup({
      layout: this.cameraBindGroupLayout!,
      entries: [
        { binding: 0, resource: { buffer: this.cameraUniformBuffer } },
        { binding: 1, resource: { buffer: this.lightUniformBuffer } },
      ],
    });
  }
  
  private loadXYZData(data: XYZData): void {
    this.xyzData = data;
    this.bounds = computeBounds(data.frames);
    
    this.currentFrame = 0;
    this.frameAccumulator = 0;
    this.isPlaying = data.frames.length > 1;
    this.lastUploadedFrame = -1;
    
    this.frameSlider.max = (data.frames.length - 1).toString();
    this.totalFrames.textContent = data.frames.length.toString();
    this.updateFrameUI();
    
    this.camera.zoom = 1.0;
    this.camera.panX = 0;
    this.camera.panY = 0;
    
    this.createFrameDataBuffers();
  }
  
  private createFrameDataBuffers(): void {
    if (!this.device || !this.xyzData) return;
    
    for (const buf of this.allFrameBuffers) {
      buf.destroy();
    }
    this.allFrameBuffers = [];
    this.frameBindGroups.clear();
    
    for (const buf of this.streamingFrameSlots) {
      buf.destroy();
    }
    this.streamingFrameSlots = [];
    this.streamingBindGroups.clear();
    
    if (this.instanceDataBuffer) {
      this.instanceDataBuffer.destroy();
      this.instanceDataBuffer = null;
    }
    
    const frame = this.xyzData.frames[0];
    const atomCount = frame.atoms.length;
    const center = this.bounds!.center;
    const frameCount = this.xyzData.frames.length;
    
    const positionsByteSize = atomCount * 3 * 4;
    const totalFrameDataSize = positionsByteSize * frameCount;
    const maxGpuMemory = 256 * 1024 * 1024;
    
    this.useStreaming = totalFrameDataSize > maxGpuMemory && atomCount > 5000;
    
    if (this.useStreaming) {
      this.createStreamingFrameBuffers(atomCount, center);
    } else {
      this.createFullFrameBuffers(atomCount, center);
    }
    
    this.recreateDepthTexture();
  }
  
  private createFullFrameBuffers(atomCount: number, center: [number, number, number]): void {
    if (!this.device || !this.xyzData) return;
    
    const frameCount = this.xyzData.frames.length;
    
    for (let f = 0; f < frameCount; f++) {
      const frameData = this.xyzData.frames[f];
      const positionsData = new Float32Array(atomCount * 3);
      
      for (let i = 0; i < atomCount; i++) {
        const atom = frameData.atoms[i];
        positionsData[i * 3] = atom.x - center[0];
        positionsData[i * 3 + 1] = atom.y - center[1];
        positionsData[i * 3 + 2] = atom.z - center[2];
      }
      
      const buffer = this.device.createBuffer({
        size: positionsData.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      new Float32Array(buffer.getMappedRange()).set(positionsData);
      buffer.unmap();
      
      this.allFrameBuffers.push(buffer);
    }
    
    const firstFrame = this.xyzData.frames[0];
    const instanceData = new Float32Array(atomCount * 4);
    for (let i = 0; i < atomCount; i++) {
      const atom = firstFrame.atoms[i];
      const info = getElementInfo(atom.element);
      instanceData[i * 4] = info.color[0];
      instanceData[i * 4 + 1] = info.color[1];
      instanceData[i * 4 + 2] = info.color[2];
      instanceData[i * 4 + 3] = info.radius;
    }
    
    this.instanceDataBuffer = this.device.createBuffer({
      size: instanceData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.instanceDataBuffer.getMappedRange()).set(instanceData);
    this.instanceDataBuffer.unmap();
  }
  
  private createStreamingFrameBuffers(atomCount: number, center: [number, number, number]): void {
    if (!this.device || !this.xyzData) return;
    
    const slotCount = 3;
    const positionsByteSize = atomCount * 3 * 4;
    
    for (let i = 0; i < slotCount; i++) {
      const buffer = this.device.createBuffer({
        size: positionsByteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.streamingFrameSlots.push(buffer);
    }
    
    const firstFrame = this.xyzData.frames[0];
    const instanceData = new Float32Array(atomCount * 4);
    for (let i = 0; i < atomCount; i++) {
      const atom = firstFrame.atoms[i];
      const info = getElementInfo(atom.element);
      instanceData[i * 4] = info.color[0];
      instanceData[i * 4 + 1] = info.color[1];
      instanceData[i * 4 + 2] = info.color[2];
      instanceData[i * 4 + 3] = info.radius;
    }
    
    this.instanceDataBuffer = this.device.createBuffer({
      size: instanceData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.instanceDataBuffer.getMappedRange()).set(instanceData);
    this.instanceDataBuffer.unmap();
    
    this.uploadStreamingFrame(0, 0, center);
    this.uploadStreamingFrame(1, 1, center);
  }
  
  private uploadStreamingFrame(slotIdx: number, frameIdx: number, center: [number, number, number]): void {
    if (!this.device || !this.xyzData) return;
    
    const frameData = this.xyzData.frames[frameIdx];
    const atomCount = frameData.atoms.length;
    const positionsData = new Float32Array(atomCount * 3);
    
    for (let i = 0; i < atomCount; i++) {
      const atom = frameData.atoms[i];
      positionsData[i * 3] = atom.x - center[0];
      positionsData[i * 3 + 1] = atom.y - center[1];
      positionsData[i * 3 + 2] = atom.z - center[2];
    }
    
    const buffer = this.streamingFrameSlots[slotIdx];
    this.device.queue.writeBuffer(buffer, 0, positionsData);
  }
  
  private getFrameBindGroup(frameIdx: number): GPUBindGroup | null {
    if (!this.device || !this.instanceDataBuffer) return null;
    
    if (this.useStreaming) {
      return this.getStreamingFrameBindGroup(frameIdx);
    }
    
    let bindGroup = this.frameBindGroups.get(frameIdx);
    if (!bindGroup) {
      const positionsBuffer = this.allFrameBuffers[frameIdx];
      if (!positionsBuffer) return null;
      
      bindGroup = this.device.createBindGroup({
        layout: this.frameDataBindGroupLayout!,
        entries: [
          { binding: 0, resource: { buffer: positionsBuffer } },
          { binding: 1, resource: { buffer: this.instanceDataBuffer } },
        ],
      });
      
      if (this.frameBindGroups.size < 200) {
        this.frameBindGroups.set(frameIdx, bindGroup);
      }
    }
    
    return bindGroup;
  }
  
  private getStreamingFrameBindGroup(frameIdx: number): GPUBindGroup | null {
    if (!this.device || !this.instanceDataBuffer || !this.xyzData) return null;
    
    const slotCount = this.streamingFrameSlots.length;
    const slotIdx = frameIdx % slotCount;
    const numFrames = this.xyzData.frames.length;
    
    if (this.lastUploadedFrame !== frameIdx) {
      const center = this.bounds!.center;
      this.uploadStreamingFrame(slotIdx, frameIdx, center);
      
      const nextSlotIdx = (slotIdx + 1) % slotCount;
      const nextFrameIdx = (frameIdx + 1) % numFrames;
      this.uploadStreamingFrame(nextSlotIdx, nextFrameIdx, center);
      
      this.lastUploadedFrame = frameIdx;
    }
    
    let bindGroup = this.streamingBindGroups.get(slotIdx);
    if (!bindGroup) {
      const positionsBuffer = this.streamingFrameSlots[slotIdx];
      
      bindGroup = this.device.createBindGroup({
        layout: this.frameDataBindGroupLayout!,
        entries: [
          { binding: 0, resource: { buffer: positionsBuffer } },
          { binding: 1, resource: { buffer: this.instanceDataBuffer } },
        ],
      });
      
      this.streamingBindGroups.set(slotIdx, bindGroup);
    }
    
    return bindGroup;
  }
  
  private updateFrameUI(): void {
    this.frameSlider.value = this.currentFrame.toString();
    this.frameValue.textContent = (this.currentFrame + 1).toString();
  }
  
  private updateUniforms(): void {
    if (!this.device) return;
    
    const aspect = this.canvas.width / this.canvas.height;
    const fov = Math.PI / 4;
    const near = 0.1;
    const far = 1000;
    
    const projection = createPerspectiveMatrix(fov, aspect, near, far);
    
    const center = [0, 0, 0] as [number, number, number];
    const up = [0, 1, 0] as [number, number, number];
    
    const distance = (this.bounds?.size || 10) * 1.5 / this.camera.zoom;
    
    const eye: [number, number, number] = [
      Math.sin(this.camera.rotationY) * Math.cos(this.camera.rotationX) * distance + this.camera.panX * distance * 0.3,
      Math.sin(this.camera.rotationX) * distance + this.camera.panY * distance * 0.3,
      Math.cos(this.camera.rotationY) * Math.cos(this.camera.rotationX) * distance,
    ];
    
    const view = createLookAtMatrix(eye, center, up);
    const viewProjection = multiplyMatrices(projection, view);
    const inverseView = invertMatrix(view);
    
    this.cameraData.set(viewProjection, 0);
    this.cameraData.set(inverseView, 16);
    this.cameraData.set(eye, 32);
    
    this.device.queue.writeBuffer(this.cameraUniformBuffer!, 0, this.cameraData as unknown as BufferSource);
    
    const lightDirection: [number, number, number] = [0.3, -0.8, -0.5];
    const lightDirLen = Math.sqrt(
      lightDirection[0] ** 2 + lightDirection[1] ** 2 + lightDirection[2] ** 2
    );
    
    this.lightData[0] = lightDirection[0] / lightDirLen;
    this.lightData[1] = lightDirection[1] / lightDirLen;
    this.lightData[2] = lightDirection[2] / lightDirLen;
    this.lightData[3] = 0;
    
    this.lightData[4] = 1.0;
    this.lightData[5] = 0.95;
    this.lightData[6] = 0.9;
    this.lightData[7] = 1.0;
    
    this.lightData[8] = 0.3;
    this.lightData[9] = 0.3;
    this.lightData[10] = 0.35;
    this.lightData[11] = 1.0;
    
    this.lightData[12] = this.atomScale;
    
    this.device.queue.writeBuffer(this.lightUniformBuffer!, 0, this.lightData as unknown as BufferSource);
  }
  
  private animate = (): void => {
    requestAnimationFrame(this.animate);
    
    const now = performance.now();
    const deltaTime = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;
    
    this.frameCount++;
    if (now - this.lastFpsTime > 1000) {
      const fps = Math.round(this.frameCount / ((now - this.lastFpsTime) / 1000));
      this.fpsInfo.textContent = `FPS: ${fps}`;
      this.frameCount = 0;
      this.lastFpsTime = now;
    }
    
    if (this.isPlaying && this.xyzData && this.xyzData.frames.length > 1) {
      this.frameAccumulator += deltaTime * this.playSpeed * 30;
      
      while (this.frameAccumulator >= 1) {
        this.currentFrame = (this.currentFrame + 1) % this.xyzData.frames.length;
        this.frameAccumulator -= 1;
        this.updateFrameUI();
      }
    }
    
    this.updateUniforms();
    this.render();
  }
  
  private render(): void {
    if (!this.device || !this.context || !this.renderPipeline || !this.depthTextureView) return;
    if (!this.xyzData) return;
    
    const frameBindGroup = this.getFrameBindGroup(this.currentFrame);
    if (!frameBindGroup) return;
    
    const texture = this.context.getCurrentTexture();
    const textureView = texture.createView();
    
    const commandEncoder = this.device.createCommandEncoder();
    
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.1, g: 0.1, b: 0.18, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.depthTextureView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    
    renderPass.setPipeline(this.renderPipeline);
    
    if (this.cameraBindGroup) {
      renderPass.setBindGroup(0, this.cameraBindGroup);
    }
    
    renderPass.setBindGroup(1, frameBindGroup);
    renderPass.draw(6, this.xyzData.atomCount);
    
    renderPass.end();
    
    const commandBuffer = commandEncoder.finish();
    this.device.queue.submit([commandBuffer]);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new MolecularViewer();
});
