import { vec3, mat4 } from 'gl-matrix';

const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 8;

const OPTIMIZED_VOXEL_WGSL = `
struct Uniforms {
  viewProj: mat4x4<f32>,
  chunkPos: vec3<f32>,
  lodLevel: f32,
  frustumPlanes: array<vec4<f32>, 6>,
  cameraPos: vec3<f32>,
  padding: f32
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

fn isInFrustum(pos: vec3<f32>, radius: f32) -> bool {
  for (var i = 0u; i < 6u; i++) {
    let plane = uniforms.frustumPlanes[i];
    let distance = dot(plane.xyz, pos) + plane.w;
    if (distance < -radius) {
      return false;
    }
  }
  return true;
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> @location(0) vec4<f32> {
  let chunkSize = 16u;
  
  let voxelIndex = vertexIndex / 36u;
  let faceIndex = (vertexIndex % 36u) / 6u;
  let quadVertex = vertexIndex % 6u;

  let voxelType = voxels[voxelIndex];
  
  if (voxelType == 0u) {
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }

  let x = i32(voxelIndex % chunkSize);
  let y = i32((voxelIndex / chunkSize) % chunkSize);
  let z = i32(voxelIndex / (chunkSize * chunkSize));

  let neighborPos = vec3<i32>(x, y, z) + faceOffsets[faceIndex];
  var neighborHidden = false;
  
  if (all(neighborPos >= vec3<i32>(0)) && all(neighborPos < vec3<i32>(i32(chunkSize)))) {
    let neighborIndex = u32(neighborPos.y) * chunkSize * chunkSize + u32(neighborPos.z) * chunkSize + u32(neighborPos.x);
    neighborHidden = voxels[neighborIndex] != 0u;
  }

  if (neighborHidden) {
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }

  let voxelSize = 1.0 / uniforms.lodLevel;
  let stepSize = u32(uniforms.lodLevel);
  
  var corner = vec3<f32>(f32(x), f32(y), f32(z)) * voxelSize + uniforms.chunkPos;
  
  let worldPos = corner + vec3<f32>(8.0);
  let chunkRadius = f32(chunkSize) * voxelSize * 0.866;
  
  if (!isInFrustum(worldPos, chunkRadius)) {
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }

  var quadPositions: array<vec3<f32>, 4>;
  
  if (faceIndex == 0u || faceIndex == 1u) {
    quadPositions[0] = corner + vec3<f32>(0.0, 0.0, 0.0);
    quadPositions[1] = corner + vec3<f32>(0.0, voxelSize, 0.0);
    quadPositions[2] = corner + vec3<f32>(0.0, voxelSize, voxelSize);
    quadPositions[3] = corner + vec3<f32>(0.0, 0.0, voxelSize);
  } else if (faceIndex == 2u || faceIndex == 3u) {
    quadPositions[0] = corner + vec3<f32>(0.0, 0.0, 0.0);
    quadPositions[1] = corner + vec3<f32>(0.0, 0.0, voxelSize);
    quadPositions[2] = corner + vec3<f32>(voxelSize, 0.0, voxelSize);
    quadPositions[3] = corner + vec3<f32>(voxelSize, 0.0, 0.0);
  } else {
    quadPositions[0] = corner + vec3<f32>(0.0, 0.0, 0.0);
    quadPositions[1] = corner + vec3<f32>(0.0, voxelSize, 0.0);
    quadPositions[2] = corner + vec3<f32>(voxelSize, voxelSize, 0.0);
    quadPositions[3] = corner + vec3<f32>(voxelSize, 0.0, 0.0);
  }

  var quadIndices = array<u32, 6>(0u, 1u, 2u, 0u, 2u, 3u);
  let pos = quadPositions[quadIndices[quadVertex]];
  
  return uniforms.viewProj * vec4<f32>(pos, 1.0);
}

@fragment
fn fs_main(@location(0) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  return vec4<f32>(0.5, 0.4, 0.3, 1.0);
}
`;

class OptimizedChunk {
  constructor(renderer, chunkX, chunkZ, lodLevel) {
    this.renderer = renderer;
    this.device = renderer.device;
    this.chunkX = chunkX;
    this.chunkZ = chunkZ;
    this.lodLevel = lodLevel;
    this.voxelBuffer = null;
    this.uniformBuffer = null;
    this.bindGroup = null;
    this.voxels = [];
    this.visible = true;
    this.distance = 0;
    this.lastVisibleFrame = 0;
  }

  async init(terrainGenerator) {
    const result = terrainGenerator.generateChunk(this.chunkX, this.chunkZ);
    this.voxelBuffer = result.voxelBuffer;
    this.voxels = await terrainGenerator.readVoxelData(this.voxelBuffer);
    this.createBuffers();
  }

  createBuffers() {
    this.uniformBuffer = this.renderer.createBuffer(
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      256
    );

    this.bindGroup = this.renderer.createBindGroup(OptimizedChunk.bindGroupLayout, [
      { binding: 0, resource: { buffer: this.uniformBuffer } },
      { binding: 1, resource: { buffer: this.voxelBuffer } }
    ]);
  }

  updateVisibility(camera, frameCount) {
    const centerX = this.chunkX * CHUNK_SIZE + CHUNK_SIZE / 2;
    const centerY = 8;
    const centerZ = this.chunkZ * CHUNK_SIZE + CHUNK_SIZE / 2;
    
    const dx = centerX - camera.position[0];
    const dy = centerY - camera.position[1];
    const dz = centerZ - camera.position[2];
    this.distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    if (this.distance > RENDER_DISTANCE * CHUNK_SIZE * 1.2) {
      this.visible = false;
      return;
    }
    
    const frustum = camera.getFrustumPlanes();
    this.visible = this.isInFrustum(centerX, centerY, centerZ, frustum);
    
    if (this.visible) {
      this.lastVisibleFrame = frameCount;
    }
  }

  isInFrustum(x, y, z, frustum) {
    const radius = CHUNK_SIZE * 0.866;
    
    for (let plane of frustum) {
      const distance = plane[0] * x + plane[1] * y + plane[2] * z + plane[3];
      if (distance < -radius) {
        return false;
      }
    }
    return true;
  }

  updateUniforms(viewProjMatrix, frustumPlanes, cameraPos) {
    const data = new Float32Array(40);
    data.set(viewProjMatrix, 0);
    data[16] = this.chunkX * CHUNK_SIZE;
    data[17] = 0;
    data[18] = this.chunkZ * CHUNK_SIZE;
    data[19] = this.lodLevel;
    
    for (let i = 0; i < 6; i++) {
      data.set(frustumPlanes[i], 20 + i * 4);
    }
    
    data.set(cameraPos, 44);
    
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  render(passEncoder) {
    if (!this.visible) return;

    passEncoder.setBindGroup(0, this.bindGroup);
    
    const effectiveSize = Math.floor(this.voxels.length / (this.lodLevel * this.lodLevel * this.lodLevel));
    const vertexCount = Math.max(1, Math.min(effectiveSize, this.voxels.length)) * 36;
    
    passEncoder.draw(vertexCount, 1, 0, 0);
  }

  destroy() {
    if (this.voxelBuffer) this.voxelBuffer.destroy();
    if (this.uniformBuffer) this.uniformBuffer.destroy();
  }
}

class OptimizedChunkManager {
  constructor(renderer, terrainGenerator, camera) {
    this.renderer = renderer;
    this.terrainGenerator = terrainGenerator;
    this.camera = camera;
    this.chunks = new Map();
    this.visibleChunks = [];
    this.frameCount = 0;
    this.totalVertices = 0;
    this.maxChunksPerFrame = 4;
    this.chunkLoadQueue = [];
  }

  static async initShaders(renderer) {
    const shaderModule = renderer.createShaderModule(OPTIMIZED_VOXEL_WGSL);

    OptimizedChunk.bindGroupLayout = renderer.createBindGroupLayout([
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

    const pipelineLayout = renderer.createPipelineLayout([OptimizedChunk.bindGroupLayout]);

    OptimizedChunk.pipeline = renderer.createRenderPipeline({
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
    await OptimizedChunkManager.initShaders(this.renderer);
    await this.updateChunks();
  }

  getChunkKey(chunkX, chunkZ) {
    return `${chunkX},${chunkZ}`;
  }

  getLODLevel(distance) {
    if (distance < 2 * CHUNK_SIZE) return 1;
    if (distance < 4 * CHUNK_SIZE) return 2;
    if (distance < 6 * CHUNK_SIZE) return 4;
    return 8;
  }

  async updateChunks() {
    const cameraChunkX = Math.floor(this.camera.position[0] / CHUNK_SIZE);
    const cameraChunkZ = Math.floor(this.camera.position[2] / CHUNK_SIZE);

    const toRemove = [];
    for (const [key, chunk] of this.chunks) {
      const dx = Math.abs(chunk.chunkX - cameraChunkX);
      const dz = Math.abs(chunk.chunkZ - cameraChunkZ);
      if (dx > RENDER_DISTANCE + 2 || dz > RENDER_DISTANCE + 2) {
        toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      this.chunks.get(key).destroy();
      this.chunks.delete(key);
    }

    const newChunks = [];
    for (let x = -RENDER_DISTANCE; x <= RENDER_DISTANCE; x++) {
      for (let z = -RENDER_DISTANCE; z <= RENDER_DISTANCE; z++) {
        const chunkX = cameraChunkX + x;
        const chunkZ = cameraChunkZ + z;
        const key = this.getChunkKey(chunkX, chunkZ);

        if (!this.chunks.has(key)) {
          const distance = Math.sqrt(x * x + z * z);
          newChunks.push({ chunkX, chunkZ, distance, key });
        }
      }
    }

    newChunks.sort((a, b) => a.distance - b.distance);

    const toLoad = newChunks.slice(0, this.maxChunksPerFrame);
    const promises = toLoad.map(async ({ chunkX, chunkZ, distance, key }) => {
      const lod = this.getLODLevel(distance * CHUNK_SIZE);
      const chunk = new OptimizedChunk(this.renderer, chunkX, chunkZ, lod);
      await chunk.init(this.terrainGenerator);
      this.chunks.set(key, chunk);
    });

    await Promise.all(promises);
  }

  update() {
    this.frameCount++;
    
    if (this.frameCount % 5 === 0) {
      this.updateChunks();
    }

    this.visibleChunks = [];
    const frustum = this.camera.getFrustumPlanes();

    for (const chunk of this.chunks.values()) {
      chunk.updateVisibility(this.camera, this.frameCount);
      
      if (chunk.visible) {
        this.visibleChunks.push(chunk);
      }
    }

    this.visibleChunks.sort((a, b) => a.distance - b.distance);
  }

  render(camera, giSystem) {
    const passEncoder = this.renderer.getPassEncoder();
    passEncoder.setPipeline(OptimizedChunk.pipeline);

    const viewProj = camera.getViewProjMatrix();
    const frustum = camera.getFrustumPlanes();
    const cameraPos = camera.getPosition();

    this.totalVertices = 0;
    let renderedChunks = 0;

    for (const chunk of this.visibleChunks) {
      if (renderedChunks > 200) break;
      
      chunk.updateUniforms(viewProj, frustum, cameraPos);
      chunk.render(passEncoder);
      
      const effectiveVoxels = Math.floor(chunk.voxels.length / (chunk.lodLevel * chunk.lodLevel * chunk.lodLevel));
      this.totalVertices += effectiveVoxels * 36;
      renderedChunks++;
    }
  }

  getLoadedChunksCount() {
    return this.chunks.size;
  }

  getVisibleChunksCount() {
    return this.visibleChunks.length;
  }

  getTotalVertices() {
    return this.totalVertices;
  }
}

export default OptimizedChunkManager;
