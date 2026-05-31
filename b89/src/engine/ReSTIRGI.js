const RESTIR_GI_WGSL = `
struct LightSample {
  position: vec3<f32>,
  color: vec3<f32>,
  intensity: f32,
  radius: f32,
  pdf: f32
};

struct Reservoir {
  sample: LightSample,
  weightSum: f32,
  sampleCount: u32
};

struct GBuffer {
  position: vec3<f32>,
  normal: vec3<f32>,
  albedo: vec3<f32>,
  depth: f32
};

@group(0) @binding(0) var<storage, read_write> gBuffer: array<GBuffer>;
@group(0) @binding(1) var<storage, read_write> reservoirs: array<Reservoir>;
@group(0) @binding(2) var<storage, read_write> indirectLight: array<vec3<f32>>;
@group(0) @binding(3) var<uniform> cameraPos: vec3<f32>;
@group(0) @binding(4) var<uniform> sunDirection: vec3<f32>;
@group(0) @binding(5) var<uniform> ambientIntensity: f32;
@group(0) @binding(6) var<uniform> frameIndex: u32;

@compute @workgroup_size(16, 16)
fn generateLightSamples(@builtin(global_invocation_id) id: vec2<u32>) {
  let width = 1024u;
  let height = 768u;
  
  if (id.x >= width || id.y >= height) {
    return;
  }

  let pixelIndex = id.y * width + id.x;
  
  var reservoir: Reservoir;
  reservoir.weightSum = 0.0;
  reservoir.sampleCount = 0u;

  let gBufferData = gBuffer[pixelIndex];
  
  if (gBufferData.depth > 0.99) {
    indirectLight[pixelIndex] = vec3<f32>(ambientIntensity * 0.1);
    return;
  }

  let numSamples = 8u;
  for (var i = 0u; i < numSamples; i++) {
    var sample = generateRandomLightSample(gBufferData.position, frameIndex + i);
    
    let targetPdf = evaluateTargetPDF(sample, gBufferData);
    let weight = targetPdf / max(sample.pdf, 0.001);
    
    reservoir.weightSum += weight;
    reservoir.sampleCount++;
    
    let rand = randomFloat(vec2<f32>(f32(id.x) + f32(i) * 0.1, f32(id.y) + f32(frameIndex) * 0.01));
    if (rand < weight / max(reservoir.weightSum, 0.001)) {
      reservoir.sample = sample;
    }
  }

  reservoirs[pixelIndex] = reservoir;
}

fn generateRandomLightSample(pos: vec3<f32>, seed: u32) -> LightSample {
  var sample: LightSample;
  
  let theta = randomFloat(vec2<f32>(f32(seed) * 0.1, 0.0)) * 2.0 * 3.14159;
  let phi = acos(2.0 * randomFloat(vec2<f32>(0.0, f32(seed) * 0.1)) - 1.0);
  
  let radius = 10.0 + randomFloat(vec2<f32>(f32(seed) * 0.01, 0.5)) * 40.0;
  
  sample.position = pos + vec3<f32>(
    sin(phi) * cos(theta) * radius,
    sin(phi) * sin(theta) * radius,
    cos(phi) * radius
  );
  
  sample.color = vec3<f32>(1.0, 0.95, 0.9);
  sample.intensity = 50.0;
  sample.radius = 5.0;
  sample.pdf = 1.0 / (4.0 * 3.14159 * radius * radius);
  
  return sample;
}

fn evaluateTargetPDF(sample: LightSample, gBuffer: GBuffer) -> f32 {
  let toLight = sample.position - gBuffer.position;
  let distance = length(toLight);
  let dir = normalize(toLight);
  
  let ndotl = max(dot(gBuffer.normal, dir), 0.0);
  let geometry = ndotl / (distance * distance);
  
  let visibility = 1.0;
  
  return sample.intensity * geometry * visibility;
}

@compute @workgroup_size(16, 16)
fn temporalReuse(@builtin(global_invocation_id) id: vec2<u32>) {
  let width = 1024u;
  let height = 768u;
  
  if (id.x >= width || id.y >= height) {
    return;
  }

  let pixelIndex = id.y * width + id.x;
  var currentReservoir = reservoirs[pixelIndex];
  
  let maxHistory = 20.0;
  let clampCount = min(f32(currentReservoir.sampleCount), maxHistory);
  
  if (currentReservoir.weightSum > 0.0) {
    let radiance = currentReservoir.sample.color * 
                   currentReservoir.sample.intensity * 
                   (currentReservoir.weightSum / clampCount);
    
    let sunContrib = max(dot(normalize(gBuffer[pixelIndex].normal), sunDirection), 0.0);
    let sunLight = vec3<f32>(1.0, 0.98, 0.9) * sunContrib * 2.0;
    
    let ambient = vec3<f32>(0.3, 0.4, 0.6) * ambientIntensity;
    
    indirectLight[pixelIndex] = gBuffer[pixelIndex].albedo * (radiance * 0.1 + sunLight + ambient);
  } else {
    indirectLight[pixelIndex] = gBuffer[pixelIndex].albedo * ambientIntensity * vec3<f32>(0.3);
  }
}

@compute @workgroup_size(16, 16)
fn spatialReuse(@builtin(global_invocation_id) id: vec2<u32>) {
  let width = 1024u;
  let height = 768u;
  
  if (id.x < 2u || id.x >= width - 2u || id.y < 2u || id.y >= height - 2u) {
    return;
  }

  let pixelIndex = id.y * width + id.x;
  var centerColor = indirectLight[pixelIndex];
  var totalWeight = 1.0;

  let depthCenter = gBuffer[pixelIndex].depth;
  let normalCenter = gBuffer[pixelIndex].normal;

  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) { continue; }

      let neighborIndex = (id.y + u32(dy)) * width + (id.x + u32(dx));
      let depthNeighbor = gBuffer[neighborIndex].depth;
      let normalNeighbor = gBuffer[neighborIndex].normal;

      let depthDiff = abs(depthCenter - depthNeighbor);
      let normalDiff = dot(normalCenter, normalNeighbor);

      if (depthDiff < 0.1 && normalDiff > 0.9) {
        let weight = 0.125;
        centerColor += indirectLight[neighborIndex] * weight;
        totalWeight += weight;
      }
    }
  }

  indirectLight[pixelIndex] = centerColor / totalWeight;
}

fn randomFloat(uv: vec2<f32>) -> f32 {
  return fract(sin(dot(uv, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}
`;

class ReSTIRGI {
  constructor(renderer, chunkManager) {
    this.renderer = renderer;
    this.device = renderer.device;
    this.chunkManager = chunkManager;
    this.frameIndex = 0;
    this.sunDirection = [0.5, 0.8, 0.5];
    this.ambientIntensity = 0.5;
    this.width = 1024;
    this.height = 768;
  }

  async init() {
    const shaderModule = this.renderer.createShaderModule(RESTIR_GI_WGSL);

    this.bindGroupLayout = this.renderer.createBindGroupLayout([
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }
    ]);

    const pipelineLayout = this.renderer.createPipelineLayout([this.bindGroupLayout]);

    this.samplePipeline = this.renderer.createComputePipeline({
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint: 'generateLightSamples' }
    });

    this.temporalPipeline = this.renderer.createComputePipeline({
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint: 'temporalReuse' }
    });

    this.spatialPipeline = this.renderer.createComputePipeline({
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint: 'spatialReuse' }
    });

    this.createBuffers();
  }

  createBuffers() {
    const pixelCount = this.width * this.height;
    const gBufferSize = pixelCount * (12 + 12 + 12 + 4);
    const reservoirSize = pixelCount * (12 + 12 + 4 + 4 + 4 + 4 + 4);
    const lightSize = pixelCount * 12;

    this.gBuffer = this.renderer.createBuffer(
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      gBufferSize
    );

    this.reservoirs = this.renderer.createBuffer(
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      reservoirSize
    );

    this.indirectLight = this.renderer.createBuffer(
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      lightSize
    );

    this.cameraPosBuffer = this.renderer.createBuffer(
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

    this.bindGroup = this.renderer.createBindGroup(this.bindGroupLayout, [
      { binding: 0, resource: { buffer: this.gBuffer } },
      { binding: 1, resource: { buffer: this.reservoirs } },
      { binding: 2, resource: { buffer: this.indirectLight } },
      { binding: 3, resource: { buffer: this.cameraPosBuffer } },
      { binding: 4, resource: { buffer: this.sunDirBuffer } },
      { binding: 5, resource: { buffer: this.ambientBuffer } },
      { binding: 6, resource: { buffer: this.frameIndexBuffer } }
    ]);
  }

  setSunDirection(x, y, z) {
    const length = Math.sqrt(x * x + y * y + z * z);
    this.sunDirection = [x / length, y / length, z / length];
  }

  setAmbientIntensity(intensity) {
    this.ambientIntensity = intensity;
  }

  update(deltaTime) {
    this.frameIndex++;
  }

  computeGI() {
    const commandEncoder = this.renderer.getCommandEncoder();

    this.device.queue.writeBuffer(this.cameraPosBuffer, 0, new Float32Array([0, 60, 0]));
    this.device.queue.writeBuffer(this.sunDirBuffer, 0, new Float32Array(this.sunDirection));
    this.device.queue.writeBuffer(this.ambientBuffer, 0, new Float32Array([this.ambientIntensity]));
    this.device.queue.writeBuffer(this.frameIndexBuffer, 0, new Uint32Array([this.frameIndex]));

    const pass1 = commandEncoder.beginComputePass();
    pass1.setPipeline(this.samplePipeline);
    pass1.setBindGroup(0, this.bindGroup);
    pass1.dispatchWorkgroups(Math.ceil(this.width / 16), Math.ceil(this.height / 16));
    pass1.end();

    const pass2 = commandEncoder.beginComputePass();
    pass2.setPipeline(this.temporalPipeline);
    pass2.setBindGroup(0, this.bindGroup);
    pass2.dispatchWorkgroups(Math.ceil(this.width / 16), Math.ceil(this.height / 16));
    pass2.end();

    const pass3 = commandEncoder.beginComputePass();
    pass3.setPipeline(this.spatialPipeline);
    pass3.setBindGroup(0, this.bindGroup);
    pass3.dispatchWorkgroups(Math.ceil(this.width / 16), Math.ceil(this.height / 16));
    pass3.end();
  }

  getIndirectLightBuffer() {
    return this.indirectLight;
  }
}

export default ReSTIRGI;
