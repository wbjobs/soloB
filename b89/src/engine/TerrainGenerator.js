const TERRAIN_WGSL = `
struct ChunkData {
  position: vec3<i32>,
  size: u32,
  voxels: array<u32>
};

@group(0) @binding(0) var<uniform> chunkPos: vec3<i32>;
@group(0) @binding(1) var<storage, read_write> chunkData: ChunkData;

@compute @workgroup_size(4, 4, 4)
fn generateTerrain(@builtin(global_invocation_id) id: vec3<u32>) {
  let chunkSize = 16u;
  
  if (id.x >= chunkSize || id.y >= chunkSize || id.z >= chunkSize) {
    return;
  }

  let worldPos = vec3<f32>(
    f32(chunkPos.x * i32(chunkSize)) + f32(id.x),
    f32(id.y),
    f32(chunkPos.z * i32(chunkSize)) + f32(id.z)
  );

  var density = 0.0;
  
  let noiseScale = 0.015;
  density += simplexNoise3D(worldPos * noiseScale) * 30.0;
  density += simplexNoise3D(worldPos * noiseScale * 2.0) * 15.0;
  density += simplexNoise3D(worldPos * noiseScale * 4.0) * 7.5;
  density += simplexNoise3D(worldPos * noiseScale * 8.0) * 3.75;

  let baseHeight = 40.0;
  let surfaceHeight = baseHeight + density;

  let voxelIndex = id.y * chunkSize * chunkSize + id.z * chunkSize + id.x;
  
  if (f32(id.y) < surfaceHeight) {
    if (f32(id.y) > surfaceHeight - 3.0) {
      chunkData.voxels[voxelIndex] = 2u;
    } else if (f32(id.y) > surfaceHeight - 8.0) {
      chunkData.voxels[voxelIndex] = 3u;
    } else {
      chunkData.voxels[voxelIndex] = 1u;
    }
  } else {
    chunkData.voxels[voxelIndex] = 0u;
  }

  if (id.y < 5u && chunkData.voxels[voxelIndex] == 0u) {
    chunkData.voxels[voxelIndex] = 4u;
  }
}

fn simplexNoise3D(p: vec3<f32>) -> f32 {
  let F3 = 1.0 / 3.0;
  let G3 = 1.0 / 6.0;
  
  var s = dot(p, vec3<f32>(F3));
  var i = floor(p + vec3<f32>(s));
  var t = dot(i, vec3<f32>(G3));
  var X0 = i - vec3<f32>(t);
  var x0 = p - X0;
  
  var i1: vec3<f32>;
  var i2: vec3<f32>;
  
  if (x0.x >= x0.y) {
    if (x0.y >= x0.z) { i1 = vec3<f32>(1, 0, 0); i2 = vec3<f32>(1, 1, 0); }
    else if (x0.x >= x0.z) { i1 = vec3<f32>(1, 0, 0); i2 = vec3<f32>(1, 0, 1); }
    else { i1 = vec3<f32>(0, 0, 1); i2 = vec3<f32>(1, 0, 1); }
  } else {
    if (x0.y < x0.z) { i1 = vec3<f32>(0, 0, 1); i2 = vec3<f32>(0, 1, 1); }
    else if (x0.x < x0.z) { i1 = vec3<f32>(0, 1, 0); i2 = vec3<f32>(0, 1, 1); }
    else { i1 = vec3<f32>(0, 1, 0); i2 = vec3<f32>(1, 1, 0); }
  }

  var x1 = x0 - i1 + vec3<f32>(G3);
  var x2 = x0 - i2 + vec3<f32>(2.0 * G3);
  var x3 = x0 - vec3<f32>(1.0) + vec3<f32>(3.0 * G3);

  var n0 = 0.0;
  var n1 = 0.0;
  var n2 = 0.0;
  var n3 = 0.0;

  var t0 = 0.6 - dot(x0, x0);
  if (t0 >= 0.0) {
    t0 *= t0;
    n0 = t0 * t0 * grad3D(hash(i), x0);
  }

  var t1 = 0.6 - dot(x1, x1);
  if (t1 >= 0.0) {
    t1 *= t1;
    n1 = t1 * t1 * grad3D(hash(i + i1), x1);
  }

  var t2 = 0.6 - dot(x2, x2);
  if (t2 >= 0.0) {
    t2 *= t2;
    n2 = t2 * t2 * grad3D(hash(i + i2), x2);
  }

  var t3 = 0.6 - dot(x3, x3);
  if (t3 >= 0.0) {
    t3 *= t3;
    n3 = t3 * t3 * grad3D(hash(i + vec3<f32>(1.0)), x3);
  }

  return 32.0 * (n0 + n1 + n2 + n3);
}

fn hash(p: vec3<f32>) -> u32 {
  var h = u32(p.x) * 73856093u ^ u32(p.y) * 19349663u ^ u32(p.z) * 83492791u;
  h = h ^ (h >> 16u);
  h = h * 0x45d9f3bu;
  h = h ^ (h >> 16u);
  h = h * 0x45d9f3bu;
  h = h ^ (h >> 16u);
  return h;
}

fn grad3D(hash: u32, g: vec3<f32>) -> f32 {
  let h = hash & 15u;
  let u = select(g.x, g.y, h < 8u);
  let v = select(g.y, select(g.z, g.x, h < 2u || h == 12u || h == 14u), h < 4u);
  return select(-u, u, (h & 1u) == 0u) + select(-v, v, (h & 2u) == 0u);
}
`;

class TerrainGenerator {
  constructor(renderer) {
    this.renderer = renderer;
    this.device = renderer.device;
    this.computePipeline = null;
    this.bindGroupLayout = null;
  }

  async init() {
    const shaderModule = this.renderer.createShaderModule(TERRAIN_WGSL);

    this.bindGroupLayout = this.renderer.createBindGroupLayout([
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' }
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' }
      }
    ]);

    const pipelineLayout = this.renderer.createPipelineLayout([this.bindGroupLayout]);

    this.computePipeline = this.renderer.createComputePipeline({
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'generateTerrain'
      }
    });
  }

  generateChunk(chunkX, chunkZ) {
    const chunkSize = 16;
    const voxelCount = chunkSize * chunkSize * chunkSize;
    const bufferSize = 12 + 4 + voxelCount * 4;

    const voxelBuffer = this.renderer.createBuffer(
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      bufferSize
    );

    const uniformData = new Int32Array([chunkX, 0, chunkZ]);
    const uniformBuffer = this.renderer.createBuffer(
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      16,
      uniformData
    );

    const bindGroup = this.renderer.createBindGroup(this.bindGroupLayout, [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: voxelBuffer } }
    ]);

    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.computePipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(4, 4, 4);
    passEncoder.end();

    this.device.queue.submit([commandEncoder.finish()]);

    return { voxelBuffer, chunkX, chunkZ };
  }

  async readVoxelData(voxelBuffer) {
    const chunkSize = 16;
    const voxelCount = chunkSize * chunkSize * chunkSize;
    const readBuffer = this.device.createBuffer({
      size: voxelCount * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(
      voxelBuffer,
      16,
      readBuffer,
      0,
      voxelCount * 4
    );
    this.device.queue.submit([commandEncoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const data = new Uint32Array(readBuffer.getMappedRange());
    const voxels = Array.from(data);
    readBuffer.unmap();
    readBuffer.destroy();

    return voxels;
  }
}

export default TerrainGenerator;
