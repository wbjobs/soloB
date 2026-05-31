class WebGPURenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.device = null;
    this.context = null;
    this.presentationFormat = null;
    this.commandEncoder = null;
    this.passEncoder = null;
    this.depthTexture = null;
    this.uniformBuffer = null;
    this.uniformBindGroup = null;
  }

  async init() {
    if (!navigator.gpu) {
      throw new Error('WebGPU 不支持');
    }

    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance'
    });

    if (!adapter) {
      throw new Error('无法获取 GPU 适配器');
    }

    this.device = await adapter.requestDevice({
      requiredLimits: {
        maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
        maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup,
        maxComputeWorkgroupSizeX: adapter.limits.maxComputeWorkgroupSizeX,
        maxComputeWorkgroupSizeY: adapter.limits.maxComputeWorkgroupSizeY,
        maxComputeWorkgroupSizeZ: adapter.limits.maxComputeWorkgroupSizeZ,
        maxComputeWorkgroupsPerDimension: adapter.limits.maxComputeWorkgroupsPerDimension,
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
        maxInterStageShaderComponents: adapter.limits.maxInterStageShaderComponents
      }
    });

    this.context = this.canvas.getContext('webgpu');
    this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();

    this.context.configure({
      device: this.device,
      format: this.presentationFormat,
      alphaMode: 'premultiplied',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });

    this.resize();
    this.createDepthTexture();
    this.createUniformBuffer();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.width = this.canvas.width;
    this.height = this.canvas.height;

    if (this.depthTexture) {
      this.depthTexture.destroy();
    }
    this.createDepthTexture();
  }

  createDepthTexture() {
    this.depthTexture = this.device.createTexture({
      size: [this.width, this.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
  }

  createUniformBuffer() {
    this.uniformBuffer = this.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
  }

  updateUniforms(data) {
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  beginRender() {
    this.commandEncoder = this.device.createCommandEncoder();

    const currentTexture = this.context.getCurrentTexture();
    const currentTextureView = currentTexture.createView();

    this.passEncoder = this.commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: currentTextureView,
        clearValue: { r: 0.1, g: 0.1, b: 0.2, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store'
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store'
      }
    });
  }

  endRender() {
    this.passEncoder.end();
    this.device.queue.submit([this.commandEncoder.finish()]);
  }

  getCommandEncoder() {
    return this.commandEncoder;
  }

  getPassEncoder() {
    return this.passEncoder;
  }

  createBuffer(usage, size, data = null) {
    const buffer = this.device.createBuffer({
      size,
      usage,
      mappedAtCreation: !!data
    });

    if (data) {
      new data.constructor(buffer.getMappedRange()).set(data);
      buffer.unmap();
    }

    return buffer;
  }

  createShaderModule(code) {
    return this.device.createShaderModule({
      code
    });
  }

  createBindGroup(layout, entries) {
    return this.device.createBindGroup({
      layout,
      entries
    });
  }

  createBindGroupLayout(entries) {
    return this.device.createBindGroupLayout({
      entries
    });
  }

  createPipelineLayout(bindGroupLayouts) {
    return this.device.createPipelineLayout({
      bindGroupLayouts
    });
  }

  createRenderPipeline(descriptor) {
    return this.device.createRenderPipeline(descriptor);
  }

  createComputePipeline(descriptor) {
    return this.device.createComputePipeline(descriptor);
  }
}

export default WebGPURenderer;
