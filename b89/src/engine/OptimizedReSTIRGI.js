const OPTIMIZED_RESTIR_WGSL = `
struct LightSample {
  position: vec3<f32>,
  color: vec3<f32>,
  intensity: f32,
  pdf: f32
};

struct Reservoir {
  sample: LightSample,
  weightSum: f32,
  sampleCount: u32,
  padding: vec2<f32>
};

struct GBufferItem {
  position: vec3<f32>,
  normal: vec3<f32>,
  albedo: vec3<f32>,
  depth: f32,
  valid: u32
};

@group(0) @binding(0) var<storage, read_write> gBuffer: array<GBufferItem>;
@group(0) @binding(1) var<storage, read_write> currentReservoirs: array<Reservoir>;
@group(0) @binding(2) var<storage, read_write> previousReservoirs: array<Reservoir>;
@group(0) @binding(3) var<storage, read_write> indirectLightCurrent: array<vec3<f32>>;
@group(0) @binding(4) var<storage, read_write> indirectLightHistory: array<vec3<f32>>;
@group(0) @binding(5) var<uniform> viewProj: mat4x4<f32>;
@group(0) @binding(6) var<uniform> cameraPos: vec3<f32>;
@group(0) @binding(7) var<uniform> cameraFront: vec3<f32>;
@group(0) @binding(8) var<uniform> sunDirection: vec3<f32>;
@group(0) @binding(9) var<uniform> ambientIntensity: f32;
@group(0) @binding(10) var<uniform> frameIndex: u32;
@group(0) @binding(11) var<uniform> tileOffset: vec2<u32>;
@group(0) @binding(12) var<uniform> frameCount: u32;
@group(0) @binding(13) var<storage, read_write> visibilityBuffer: array<u32>;

fn randomFloat(uv: vec2<f32>) -> f32 {
  return fract(sin(dot(uv, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn randomVec3(uv: vec2<f32>) -> vec3<f32> {
  return vec3<f32>(
    randomFloat(uv),
    randomFloat(uv + vec2<f32>(0.1, 0.0)),
    randomFloat(uv + vec2<f32>(0.0, 0.1))
  );
}

fn isInFrustum(pos: vec3<f32>, viewProjMat: mat4x4<f32>) -> bool {
  let clipPos = viewProjMat * vec4<f32>(pos, 1.0);
  let ndc = clipPos.xyz / clipPos.w;
  return all(ndc >= vec3<f32>(-1.1)) && all(ndc <= vec3<f32>(1.1));
}

fn calculateMipLevel(depth: f32) -> u32 {
  let normalizedDepth = clamp(depth, 0.0, 1.0);
  return u32(floor(normalizedDepth * 4.0));
}

@compute @workgroup_size(8, 8)
fn tileCulling(@builtin(global_invocation_id) id: vec2<u32>) {
  let width = 1024u;
  let height = 768u;
  let tileSize = 32u;
  
  let tileX = id.x;
  let tileY = id.y;
  
  if (tileX * tileSize >= width || tileY * tileSize >= height) {
    return;
  }

  var hasVisiblePixels = false;
  var totalDepth = 0.0;
  var sampleCount = 0u;
  
  for (var dy = 0u; dy < tileSize; dy += 4u) {
    for (var dx = 0u; dx < tileSize; dx += 4u) {
      let pixelX = tileX * tileSize + dx;
      let pixelY = tileY * tileSize + dy;
      
      if (pixelX < width && pixelY < height) {
        let pixelIndex = pixelY * width + pixelX;
        let gBufferItem = gBuffer[pixelIndex];
        
        if (gBufferItem.valid == 1u && gBufferItem.depth < 0.99) {
          if (isInFrustum(gBufferItem.position, viewProj)) {
            hasVisiblePixels = true;
            totalDepth += gBufferItem.depth;
            sampleCount++;
          }
        }
      }
    }
  }
  
  let tilesPerRow = (width + tileSize - 1u) / tileSize;
  let tileIndex = tileY * tilesPerRow + tileX;
  visibilityBuffer[tileIndex] = select(0u, 1u, hasVisiblePixels);
  
  if (sampleCount > 0u) {
    let avgDepth = totalDepth / f32(sampleCount);
    visibilityBuffer[tileIndex + 10000u] = calculateMipLevel(avgDepth);
  } else {
    visibilityBuffer[tileIndex + 10000u] = 0u;
  }
}

@compute @workgroup_size(16, 16)
fn generateTileSamples(@builtin(global_invocation_id) id: vec2<u32>) {
  let width = 1024u;
  let height = 768u;
  let tileSize = 32u;
  
  let baseX = (tileOffset.x + id.x) * tileSize;
  let baseY = (tileOffset.y + id.y) * tileSize;
  
  let tileIndex = (tileOffset.y + id.y) * ((width + tileSize - 1u) / tileSize + (tileOffset.x + id.x);
  
  if (visibilityBuffer[tileIndex] == 0u) {
    return;
  }

  let mipLevel = visibilityBuffer[tileIndex + 10000u];
  let stepSize = 1u << mipLevel;
  
  for (var dy = 0u; dy < tileSize; dy += stepSize) {
    for (var dx = 0u; dx < tileSize; dx += stepSize) {
      let pixelX = baseX + dx;
      let pixelY = baseY + dy;
      
      if (pixelX < width && pixelY < height) {
        let pixelIndex = pixelY * width + pixelX;
        let gBufferItem = gBuffer[pixelIndex];
        
        if (gBufferItem.valid == 0u || gBufferItem.depth > 0.99) {
          continue;
        }

        var reservoir: Reservoir;
        reservoir.weightSum = 0.0;
        reservoir.sampleCount = 0u;

        let numSamples = max(1u, 4u - mipLevel);
        for (var i = 0u; i < numSamples; i++) {
          let seed = f32(frameIndex + i) * 0.01;
          var sample = generateLightSample(gBufferItem.position, vec2<f32>(f32(pixelX) + seed, f32(pixelY) + seed));
          
          let targetPdf = evaluateTargetPDF(sample, gBufferItem);
          let weight = targetPdf / max(sample.pdf, 0.001);
          
          reservoir.weightSum += weight;
          reservoir.sampleCount++;
          
          let rand = randomFloat(vec2<f32>(f32(pixelX) + f32(i) * 0.1, f32(pixelY) + f32(frameIndex) * 0.01));
          if (rand < weight / max(reservoir.weightSum, 0.001)) {
            reservoir.sample = sample;
          }
        }

        currentReservoirs[pixelIndex] = reservoir;
      }
    }
  }
}

fn generateLightSample(pos: vec3<f32>, uv: vec2<f32>) -> LightSample {
  var sample: LightSample;
  
  let theta = randomFloat(uv) * 2.0 * 3.14159;
  let phi = acos(2.0 * randomFloat(uv + vec2<f32>(0.1, 0.2)) - 1.0);
  
  let radius = 5.0 + randomFloat(uv + vec2<f32>(0.3, 0.1)) * 20.0;
  
  sample.position = pos + vec3<f32>(
    sin(phi) * cos(theta) * radius,
    sin(phi) * sin(theta) * radius,
    cos(phi) * radius
  );
  
  sample.color = vec3<f32>(1.0, 0.95, 0.9);
  sample.intensity = 30.0;
  sample.pdf = 1.0 / (4.0 * 3.14159 * radius * radius);
  
  return sample;
}

fn evaluateTargetPDF(sample: LightSample, gBufferItem: GBufferItem) -> f32 {
  let toLight = sample.position - gBufferItem.position;
  let distance = length(toLight);
  let dir = normalize(toLight);
  
  let ndotl = max(dot(gBufferItem.normal, dir), 0.0);
  let geometry = ndotl / (distance * distance + 0.01);
  
  return sample.intensity * geometry;
}

@compute @workgroup_size(16, 16)
fn temporalReuseFilter(@builtin(global_invocation_id) id: vec2<u32>) {
  let width = 1024u;
  let height = 768u;
  
  let pixelX = id.x;
  let pixelY = id.y;
  
  if (pixelX >= width || pixelY >= height) {
    return;
  }

  let pixelIndex = pixelY * width + pixelX;
  let gBufferItem = gBuffer[pixelIndex];
  
  if (gBufferItem.valid == 0u || gBufferItem.depth > 0.99) {
    indirectLightCurrent[pixelIndex] = vec3<f32>(ambientIntensity * 0.1);
    return;
  }

  var currentReservoir = currentReservoirs[pixelIndex];
  var historyReservoir = previousReservoirs[pixelIndex];
  
  let historyWeight = 0.7;
  let currentWeight = 0.3;
  let maxHistory = 20.0;
  
  var radiance = vec3<f32>(0.0);
  
  if (currentReservoir.weightSum > 0.0) {
    let effectiveCount = min(f32(currentReservoir.sampleCount), maxHistory);
    radiance = currentReservoir.sample.color * 
                currentReservoir.sample.intensity * 
                (currentReservoir.weightSum / effectiveCount) * currentWeight;
  }
  
  if (historyReservoir.weightSum > 0.0) {
    let historyEffectiveCount = min(f32(historyReservoir.sampleCount), maxHistory);
    radiance += historyReservoir.sample.color * 
                historyReservoir.sample.intensity * 
                (historyReservoir.weightSum / historyEffectiveCount) * historyWeight;
  }
  
  let sunContrib = max(dot(normalize(gBufferItem.normal), sunDirection), 0.0);
  let sunLight = vec3<f32>(1.0, 0.98, 0.9) * sunContrib * 1.5;
  let ambient = vec3<f32>(0.3, 0.4, 0.6) * ambientIntensity;
  
  let currentLight = gBufferItem.albedo * (radiance * 0.1 + sunLight + ambient);
  
  let historyLight = indirectLightHistory[pixelIndex];
  let alpha = 0.85;
  let filteredLight = mix(currentLight, historyLight, alpha);
  
  indirectLightCurrent[pixelIndex] = filteredLight;
  
  previousReservoirs[pixelIndex] = currentReservoir;
  indirectLightHistory[pixelIndex] = filteredLight;
}

@compute @workgroup_size(16, 16)
fn spatialFilter(@builtin(global_invocation_id) id: vec2<u32>) {
  let width = 1024u;
  let height = 768u;
  
  let pixelX = id.x;
  let pixelY = id.y;
  
  if (pixelX < 2u || pixelX >= width - 2u || pixelY < 2u || pixelY >= height - 2u) {
    return;
  }

  let pixelIndex = pixelY * width + pixelX;
  var centerColor = indirectLightCurrent[pixelIndex];
  var totalWeight = 1.0;

  let depthCenter = gBuffer[pixelIndex].depth;
  let normalCenter = gBuffer[pixelIndex].normal;
  let posCenter = gBuffer[pixelIndex].position;

  let filterSize = 3u;
  for (var dy = -i32(filterSize); dy <= i32(filterSize); dy++) {
    for (var dx = -i32(filterSize); dx <= i32(filterSize); dx++) {
      if (dx == 0 && dy == 0) { continue; }

      let neighborIndex = (pixelY + u32(dy)) * width + (pixelX + u32(dx));
      let depthNeighbor = gBuffer[neighborIndex].depth;
      let normalNeighbor = gBuffer[neighborIndex].normal;
      let posNeighbor = gBuffer[neighborIndex].position;
      
      if (gBuffer[neighborIndex].valid == 0u) { continue; }

      let depthDiff = abs(depthCenter - depthNeighbor);
      let normalDiff = dot(normalCenter, normalNeighbor);
      let posDiff = length(posCenter - posNeighbor);

      let depthWeight = select(0.0, 1.0, depthDiff < 0.1);
      let normalWeight = max(0.0, normalDiff);
      let distanceWeight = exp(-posDiff * 0.5);
      
      let weight = depthWeight * normalWeight * distanceWeight * 0.05;
      
      centerColor += indirectLightCurrent[neighborIndex] * weight;
      totalWeight += weight;
    }
  }

  indirectLightCurrent[pixelIndex] = centerColor / totalWeight;
}
`;

class OptimizedReSTIRGI {
  constructor(renderer, chunkManager) {
    this.renderer = renderer;
    this.device = renderer.device;
    this.chunkManager = chunkManager;
    this.frameIndex = 0;
    this.sunDirection = [0.5, 0.8, 0.5];
    this.ambientIntensity = 0.5;
    this.width = 1024;
    this.height = 768;
    
    this.tileSize = 32;
    this.tilesX = Math.ceil(this.width / this.tileSize);
    this.tilesY = Math.ceil(this.height / this.tileSize);
    
    this.tilesPerFrame = 8;
    this.currentTileBatch = 0;
    this.totalTileBatches = Math.ceil(this.tilesX * this.tilesY / this.tilesPerFrame);
    
    this.gpuTimeQuery = null;
    this.lastGpuTime = 0;
    this.targetGpuTime = 25;
  }

  async init() {
    const shaderModule = this.renderer.createShaderModule(OPTIMIZED_RESTIR_WGSL);

    this.bindGroupLayout = this.renderer.createBindGroupLayout([
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 11, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 12, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }
    ]);

    const pipelineLayout = this.renderer.createPipelineLayout([this.bindGroupLayout]);

    this.cullingPipeline = this.renderer.createComputePipeline({
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint: 'tileCulling' }
    });

    this.samplePipeline = this.renderer.createComputePipeline({
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint: 'generateTileSamples' }
    });

    this.temporalPipeline = this.renderer.createComputePipeline({
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint: 'temporalReuseFilter' }
    });

    this.spatialPipeline = this.renderer.createComputePipeline({
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint: 'spatialFilter' }
    });

    this.createBuffers();
    this.setupTimestampQuery();
  }

  createBuffers() {
    const pixelCount = this.width * this.height;
    const tileCount = this.tilesX * this.tilesY;
    
    const gBufferSize = pixelCount * (12 + 12 + 12 + 4 + 4);
    const reservoirSize = pixelCount * (12 + 12 + 4 + 4 + 4 + 8);
    const lightSize = pixelCount * 12;
    const visibilitySize = (tileCount + 10000) * 4;

    this.gBuffer = this.renderer.createBuffer(
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      gBufferSize
    );

    this.currentReservoirs = this.renderer.createBuffer(
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      reservoirSize
    );

    this.previousReservoirs = this.renderer.createBuffer(
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      reservoirSize
    );

    this.indirectLightCurrent = this.renderer.createBuffer(
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      lightSize
    );

    this.indirectLightHistory = this.renderer.createBuffer(
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      lightSize
    );

    this.visibilityBuffer = this.renderer.createBuffer(
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      visibilitySize
    );

    this.viewProjBuffer = this.renderer.createBuffer(
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      64
    );

    this.cameraPosBuffer = this.renderer.createBuffer(
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      16
    );

    this.cameraFrontBuffer = this.renderer.createBuffer(
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      16
    );

    this.sunDirBuffer = this.renderer.createBuffer(
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      16
    );

    this.ambientBuffer = this.renderer.createBuffer(
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      4
    );

    this.frameIndexBuffer = this.renderer.createBuffer(
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      4
    );

    this.tileOffsetBuffer = this.renderer.createBuffer(
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      8
    );

    this.frameCountBuffer = this.renderer.createBuffer(
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      4
    );

    this.bindGroup = this.renderer.createBindGroup(this.bindGroupLayout, [
      { binding: 0, resource: { buffer: this.gBuffer } },
      { binding: 1, resource: { buffer: this.currentReservoirs } },
      { binding: 2, resource: { buffer: this.previousReservoirs } },
      { binding: 3, resource: { buffer: this.indirectLightCurrent } },
      { binding: 4, resource: { buffer: this.indirectLightHistory } },
      { binding: 5, resource: { buffer: this.viewProjBuffer } },
      { binding: 6, resource: { buffer: this.cameraPosBuffer } },
      { binding: 7, resource: { buffer: this.cameraFrontBuffer } },
      { binding: 8, resource: { buffer: this.sunDirBuffer } },
      { binding: 9, resource: { buffer: this.ambientBuffer } },
      { binding: 10, resource: { buffer: this.frameIndexBuffer } },
      { binding: 11, resource: { buffer: this.tileOffsetBuffer } },
      { binding: 12, resource: { buffer: this.visibilityBuffer } }
    ]);
  }

  setupTimestampQuery() {
    this.querySet = this.device.createQuerySet({
      type: 'timestamp',
      count: 2
    });
    
    this.queryBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
  }

  setSunDirection(x, y, z) {
    const length = Math.sqrt(x * x + y * y + z * z);
    this.sunDirection = [x / length, y / length, z / length];
  }

  setAmbientIntensity(intensity) {
    this.ambientIntensity = intensity;
  }

  update(deltaTime, camera) {
    this.frameIndex++;
    
    if (camera) {
      const viewProj = camera.getViewProjMatrix();
      this.device.queue.writeBuffer(this.viewProjBuffer, 0, viewProj);
      this.device.queue.writeBuffer(this.cameraPosBuffer, 0, new Float32Array(camera.getPosition()));
      this.device.queue.writeBuffer(this.cameraFrontBuffer, 0, new Float32Array([camera.front[0], camera.front[1], camera.front[2], 0]));
    }
  }

  computeGI(commandEncoder) {
    this.device.queue.writeBuffer(this.sunDirBuffer, 0, new Float32Array(this.sunDirection));
    this.device.queue.writeBuffer(this.ambientBuffer, 0, new Float32Array([this.ambientIntensity]));
    this.device.queue.writeBuffer(this.frameIndexBuffer, 0, new Uint32Array([this.frameIndex]));

    if (this.querySet) {
      commandEncoder.writeTimestamp(this.querySet, 0);
    }

    const cullingPass = commandEncoder.beginComputePass();
    cullingPass.setPipeline(this.cullingPipeline);
    cullingPass.setBindGroup(0, this.bindGroup);
    cullingPass.dispatchWorkgroups(Math.ceil(this.tilesX / 8), Math.ceil(this.tilesY / 8));
    cullingPass.end();

    const batchStartTile = this.currentTileBatch * this.tilesPerFrame;
    const tilesX = Math.min(this.tilesPerFrame, this.tilesX * this.tilesY - batchStartTile);
    
    for (let i = 0; i < tilesX; i++) {
      const tileIndex = batchStartTile + i;
      const tileX = tileIndex % this.tilesX;
      const tileY = Math.floor(tileIndex / this.tilesX);
      
      this.device.queue.writeBuffer(this.tileOffsetBuffer, 0, new Uint32Array([tileX, tileY]));
      
      const samplePass = commandEncoder.beginComputePass();
      samplePass.setPipeline(this.samplePipeline);
      samplePass.setBindGroup(0, this.bindGroup);
      samplePass.dispatchWorkgroups(1, 1);
      samplePass.end();
    }

    this.currentTileBatch = (this.currentTileBatch + 1) % this.totalTileBatches;

    if (this.frameIndex % 2 === 0) {
      const temporalPass = commandEncoder.beginComputePass();
      temporalPass.setPipeline(this.temporalPipeline);
      temporalPass.setBindGroup(0, this.bindGroup);
      temporalPass.dispatchWorkgroups(Math.ceil(this.width / 16), Math.ceil(this.height / 16));
      temporalPass.end();

      const spatialPass = commandEncoder.beginComputePass();
      spatialPass.setPipeline(this.spatialPipeline);
      spatialPass.setBindGroup(0, this.bindGroup);
      spatialPass.dispatchWorkgroups(Math.ceil(this.width / 16), Math.ceil(this.height / 16));
      spatialPass.end();
    }

    if (this.querySet) {
      commandEncoder.writeTimestamp(this.querySet, 1);
      commandEncoder.resolveQuerySet(this.querySet, 0, 2, this.queryBuffer, 0);
    }

    this.adaptToGpuLoad();
  }

  async adaptToGpuLoad() {
    if (this.frameIndex % 30 !== 0) return;

    try {
      await this.queryBuffer.mapAsync(GPUMapMode.READ);
      const times = new BigUint64Array(this.queryBuffer.getMappedRange());
      const gpuTimeMs = Number(times[1] - times[0]) / 1000000;
      this.lastGpuTime = gpuTimeMs;
      
      this.queryBuffer.unmap();

      if (gpuTimeMs > this.targetGpuTime) {
        this.tilesPerFrame = Math.max(2, this.tilesPerFrame - 1);
      } else if (gpuTimeMs < this.targetGpuTime * 0.7) {
        this.tilesPerFrame = Math.min(16, this.tilesPerFrame + 1);
      }

      this.totalTileBatches = Math.ceil(this.tilesX * this.tilesY / this.tilesPerFrame);
    } catch (e) {
    }
  }

  getGpuTime() {
    return this.lastGpuTime;
  }

  getIndirectLightBuffer() {
    return this.indirectLightCurrent;
  }
}

export default OptimizedReSTIRGI;
