import { vec3 } from 'https://cdn.jsdelivr.net/npm/gl-matrix@3.4.3/+esm';

const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 8;
const LOD_LEVELS = 3;

const VOXEL_SHADER = `
struct Uniforms {
  viewProj: mat4x4<f32>,
  chunkPos: vec3<f32>,
  lod: f32
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) worldPos: vec3<f32>
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage> voxels: array<u32>;

var<private> faceOffsets: array<vec3<i32>, 6> = array<vec3<i32>, 6>(
  vec3<i32>(1, 0, 0),
  vec3<i32>(-1, 0, 0),
  vec3<i32>(0, 1, 0),
  vec3<i32>(0, -1, 0),
  vec3<i32>(0, 0, 1),
  vec3<i32>(0, 0, -1)
);

var<private> faceNormals: array<vec3<f32>, 6> = array<vec3<f32>, 6>(
  vec3<f32>(1.0, 0.0, 0.0),
  vec3<f32>(-1.0, 0.0, 0.0),
  vec3<f32>(0.0, 1.0, 0.0),
  vec3<f32>(0.0, -1.0, 0.0),
  vec3<f32>(0.0, 0.0, 1.0),
  vec3<f32>(0.0, 0.0, -1.0)
);

var<private> voxelColors: array<vec3<f32>, 5> = array<vec3<f32>, 5>(
  vec3<f32>(0.0, 0.0, 0.0),
  vec3<f32>(0.5, 0.35, 0.2),
  vec3<f32>(0.2, 0.6, 0.2),
  vec3<f32>(0.6, 0.5, 0.3),
  vec3<f32>(0.3, 0.4, 0.8)
);

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var output: VertexOutput;
  
  let voxelIndex = vertexIndex / 36u;
  let faceIndex = (vertexIndex % 36u) / 6u;
  let quadVertex = vertexIndex % 6u;

  let chunkSize = 16u;
  let x = i32(voxelIndex % chunkSize);
  let y = i32((voxelIndex / chunkSize) % chunkSize);
  let z = i32(voxelIndex / (chunkSize * chunkSize));

  let voxelType = voxels[voxelIndex];
  
  if (voxelType == 0u) {
    output.position = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    return output;
  }

  var neighborPos = vec3<i32>(x, y, z) + faceOffsets[faceIndex];
  var neighborHidden = false;
  
  if (all(neighborPos >= vec3<i32>(0)) && all(neighborPos < vec3<i32>(i32(chunkSize)))) {
    let neighborIndex = u32(neighborPos.y) * chunkSize * chunkSize + u32(neighborPos.z) * chunkSize + u32(neighborPos.x);
    neighborHidden = voxels[neighborIndex] != 0u;
  }

  if (neighborHidden) {
    output.position = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    return output;
  }

  let offset = 1.0 / uniforms.lod;
  var corner = vec3<f32>(f32(x), f32(y), f32(z)) * offset + uniforms.chunkPos;

  if (faceIndex == 0u) { corner.x += offset; }
  if (faceIndex == 1u) { corner.x += 0.0; }
  if (faceIndex == 2u) { corner.y += offset; }
  if (faceIndex == 3u) { corner.y += 0.0; }
  if (faceIndex == 4u) { corner.z += offset; }
  if (faceIndex == 5u) { corner.z += 0.0; }

  var quadPositions: array<vec3<f32>, 4>;
  
  if (faceIndex == 0u || faceIndex == 1u) {
    quadPositions[0] = corner + vec3<f32>(0.0, 0.0, 0.0);
    quadPositions[1] = corner + vec3<f32>(0.0, offset, 0.0);
    quadPositions[2] = corner + vec3<f32>(0.0, offset, offset);
    quadPositions[3] = corner + vec3<f32>(0.0, 0.0, offset);
  } else if (faceIndex == 2u || faceIndex == 3u) {
    quadPositions[0] = corner + vec3<f32>(0.0, 0.0, 0.0);
    quadPositions[1] = corner + vec3<f32>(0.0, 0.0, offset);
    quadPositions[2] = corner + vec3<f32>(offset, 0.0, offset);
    quadPositions[3] = corner + vec3<f32>(offset, 0.0, 0.0);
  } else {
    quadPositions[0] = corner + vec3<f32>(0.0, 0.0, 0.0);
    quadPositions[1] = corner + vec3<f32>(0.0, offset, 0.0);
    quadPositions[2] = corner + vec3<f32>(offset, offset, 0.0);
    quadPositions[3] = corner + vec3<f32>(offset, 0.0, 0.0);
  }

  var quadIndices = array<u32, 6>(0u, 1u, 2u, 0u, 2u, 3u);
  let pos = quadPositions[quadIndices[quadVertex]];

  output.worldPos = pos;
  output.position = uniforms.viewProj * vec4<f32>(pos, 1.0);
  output.color = voxelColors[voxelType];
  output.normal = faceNormals[faceIndex];

  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let lightDir = normalize(vec3<f32>(0.5, 0.8, 0.5));
  let diffuse = max(dot(input.normal, lightDir), 0.2);
  let color = input.color * diffuse;
  return vec4<f32>(color, 1.0);
}
`;

class Chunk {
  constructor(renderer, chunkX, chunkZ, lod = 1) {
    this.renderer = renderer;
    this.device = renderer.device;
    this.chunkX = chunkX;
    this.chunkZ = chunkZ;
    this.lod = lod;
    this.vertexBuffer = null;
    this.voxelBuffer = null;
    this.uniformBuffer = null;
    this.bindGroup = null;
    this.voxelCount = 0;
    this.loaded = false;
  }

  async init(terrainGenerator) {
    const result = terrainGenerator.generateChunk(this.chunkX, this.chunkZ);
    this.voxelBuffer = result.voxelBuffer;

    this.voxels = await terrainGenerator.readVoxelData(this.voxelBuffer);
    this.voxelCount = this.voxels.filter(v => v !== 0).length;

    this.createBuffers();
    this.loaded = true;
  }

  createBuffers() {
    const uniformSize = 64 + 16 + 4;
    this.uniformBuffer = this.renderer.createBuffer(
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      uniformSize
    );

    this.bindGroup = this.renderer.createBindGroup(Chunk.bindGroupLayout, [
      { binding: 0, resource: { buffer: this.uniformBuffer } },
      { binding: 1, resource: { buffer: this.voxelBuffer } }
    ]);
  }

  updateUniforms(viewProjMatrix) {
    const data = new Float32Array(21);
    data.set(viewProjMatrix, 0);
    data[16] = this.chunkX * CHUNK_SIZE;
    data[17] = 0;
    data[18] = this.chunkZ * CHUNK_SIZE;
    data[19] = this.lod;
    
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  render(passEncoder) {
    if (!this.loaded || this.voxelCount === 0) return;

    passEncoder.setBindGroup(0, this.bindGroup);
    const vertexCount = this.voxels.length * 36;
    passEncoder.draw(vertexCount, 1, 0, 0);
  }

  destroy() {
    if (this.vertexBuffer) this.vertexBuffer.destroy();
    if (this.voxelBuffer) this.voxelBuffer.destroy();
    if (this.uniformBuffer) this.uniformBuffer.destroy();
    this.loaded = false;
  }
}

class ChunkManager {
  constructor(renderer, terrainGenerator, camera) {
    this.renderer = renderer;
    this.terrainGenerator = terrainGenerator;
    this.camera = camera;
    this.chunks = new Map();
    this.pipeline = null;
    this.totalVertices = 0;
  }

  static async initShaders(renderer) {
    const shaderModule = renderer.createShaderModule(VOXEL_SHADER);

    Chunk.bindGroupLayout = renderer.createBindGroupLayout([
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' }
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'read-only-storage' }
      }
    ]);

    const pipelineLayout = renderer.createPipelineLayout([Chunk.bindGroupLayout]);

    Chunk.pipeline = renderer.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main'
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: renderer.presentationFormat
        }]
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back'
      },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus'
      }
    });
  }

  async init() {
    await ChunkManager.initShaders(this.renderer);
    await this.updateChunks();
  }

  getChunkKey(chunkX, chunkZ) {
    return `${chunkX},${chunkZ}`;
  }

  getLODLevel(distance) {
    if (distance < 3) return 1;
    if (distance < 6) return 2;
    return 4;
  }

  async updateChunks() {
    const cameraChunkX = Math.floor(this.camera.position[0] / CHUNK_SIZE);
    const cameraChunkZ = Math.floor(this.camera.position[2] / CHUNK_SIZE);

    const toRemove = [];
    for (const [key, chunk] of this.chunks) {
      const dx = Math.abs(chunk.chunkX - cameraChunkX);
      const dz = Math.abs(chunk.chunkZ - cameraChunkZ);
      if (dx > RENDER_DISTANCE || dz > RENDER_DISTANCE) {
        toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      this.chunks.get(key).destroy();
      this.chunks.delete(key);
    }

    const promises = [];
    for (let x = -RENDER_DISTANCE; x <= RENDER_DISTANCE; x++) {
      for (let z = -RENDER_DISTANCE; z <= RENDER_DISTANCE; z++) {
        const chunkX = cameraChunkX + x;
        const chunkZ = cameraChunkZ + z;
        const key = this.getChunkKey(chunkX, chunkZ);

        if (!this.chunks.has(key)) {
          const distance = Math.sqrt(x * x + z * z);
          const lod = this.getLODLevel(distance);
          const chunk = new Chunk(this.renderer, chunkX, chunkZ, lod);
          this.chunks.set(key, chunk);
          promises.push(chunk.init(this.terrainGenerator));
        }
      }
    }

    await Promise.all(promises);
  }

  update() {
    if (Math.random() < 0.1) {
      this.updateChunks();
    }
  }

  render(camera, giSystem) {
    const passEncoder = this.renderer.getPassEncoder();
    passEncoder.setPipeline(Chunk.pipeline);

    const viewProj = camera.getViewProjMatrix();
    this.totalVertices = 0;

    for (const chunk of this.chunks.values()) {
      if (chunk.loaded) {
        chunk.updateUniforms(viewProj);
        chunk.render(passEncoder);
        this.totalVertices += chunk.voxelCount * 36;
      }
    }
  }

  getLoadedChunksCount() {
    let count = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.loaded) count++;
    }
    return count;
  }

  getTotalVertices() {
    return this.totalVertices;
  }
}

export default ChunkManager;
