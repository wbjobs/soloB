import { vec3 } from 'gl-matrix';

const OPTIMIZED_VOXEL_WGSL = `
struct Uniforms {
  viewProj: mat4x4<f32>,
  chunkPos: vec3<f32>,
  lodLevel: f32,
  sunDirection: vec3<f32>,
  ambientIntensity: f32,
  cameraPos: vec3<f32>,
  time: f32,
  padding: vec3<f32>
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
  vec3<f32>(0.6, 0.4, 0.25),
  vec3<f32>(0.25, 0.65, 0.2),
  vec3<f32>(0.55, 0.45, 0.3),
  vec3<f32>(0.3, 0.4, 0.8)
);

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @location(0) vec4<f32> {
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

  var corner = vec3<f32>(f32(x), f32(y), f32(z)) + uniforms.chunkPos;

  var quadPositions: array<vec3<f32>, 4>;
  
  if (faceIndex == 0u || faceIndex == 1u) {
    quadPositions[0] = corner + vec3<f32>(0.0, 0.0, 0.0);
    quadPositions[1] = corner + vec3<f32>(0.0, 1.0, 0.0);
    quadPositions[2] = corner + vec3<f32>(0.0, 1.0, 1.0);
    quadPositions[3] = corner + vec3<f32>(0.0, 0.0, 1.0);
  } else if (faceIndex == 2u || faceIndex == 3u) {
    quadPositions[0] = corner + vec3<f32>(0.0, 0.0, 0.0);
    quadPositions[1] = corner + vec3<f32>(0.0, 0.0, 1.0);
    quadPositions[2] = corner + vec3<f32>(1.0, 0.0, 1.0);
    quadPositions[3] = corner + vec3<f32>(1.0, 0.0, 0.0);
  } else {
    quadPositions[0] = corner + vec3<f32>(0.0, 0.0, 0.0);
    quadPositions[1] = corner + vec3<f32>(0.0, 1.0, 0.0);
    quadPositions[2] = corner + vec3<f32>(1.0, 1.0, 0.0);
    quadPositions[3] = corner + vec3<f32>(1.0, 0.0, 0.0);
  }

  var quadIndices = array<u32, 6>(0u, 1u, 2u, 0u, 2u, 3u);
  let pos = quadPositions[quadIndices[quadVertex]];
  
  return uniforms.viewProj * vec4<f32>(pos, 1.0);
}

@fragment
fn fs_main(@location(0) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  let ndc = fragCoord.xyz / fragCoord.w;
  let depth = ndc.z * 0.5 + 0.5;
  
  let fogFactor = exp(-depth * 2.0);
  let fogColor = vec3<f32>(0.5, 0.55, 0.65);
  
  let color = mix(fogColor, vec3<f32>(0.6, 0.5, 0.35), fogFactor);
  
  return vec4<f32>(color, 1.0);
}
`;

class EfficientVoxelChunk {
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
    this.vertexCount = 0;
  }

  async init(terrainGenerator) {
    const result = terrainGenerator.generateChunk(this.chunkX, this.chunkZ);
    this.voxelBuffer = result.voxelBuffer;
    this.voxels = await terrainGenerator.readVoxelData(this.voxelBuffer);
    
    this.vertexCount = this.voxels.filter(v => v !== 0).length * 36;
    
    this.createBuffers();
  }

  createBuffers() {
    this.uniformBuffer = this.renderer.createBuffer(
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      256
    );

    this.bindGroup = this.renderer.createBindGroup(EfficientVoxelChunk.bindGroupLayout, [
      { binding: 0, resource: { buffer: this.uniformBuffer } },
      { binding: 1, resource: { buffer: this.voxelBuffer } }
    ]);
  }

  updateVisibility(camera, frameCount) {
    const centerX = this.chunkX * 16 + 8;
    const centerY = 8;
    const centerZ = this.chunkZ * 16 + 8;
    
    const dx = centerX - camera.position[0];
    const dy = centerY - camera.position[1];
    const dz = centerZ - camera.position[2];
    this.distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    if (this.distance > 12 * 16) {
      this.visible = false;
      return;
    }
    
    const frustum = camera.getFrustumPlanes();
    this.visible = this.isInFrustum(centerX, centerY, centerZ, frustum);
  }

  isInFrustum(x, y, z, frustum) {
    const radius = 16 * 0.866;
    
    for (let plane of frustum) {
      const distance = plane[0] * x + plane[1] * y + plane[2] * z + plane[3];
      if (distance < -radius) {
        return false;
      }
    }
    return true;
  }

  updateUniforms(viewProjMatrix, sunDirection, ambientIntensity, cameraPos) {
    const data = new Float32Array(32);
    data.set(viewProjMatrix, 0);
    data[16] = this.chunkX * 16;
    data[17] = 0;
    data[18] = this.chunkZ * 16;
    data[19] = this.lodLevel;
    data[20] = sunDirection[0];
    data[21] = sunDirection[1];
    data[22] = sunDirection[2];
    data[23] = ambientIntensity;
    data.set(cameraPos, 24);
    
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  render(passEncoder) {
    if (!this.visible || this.vertexCount === 0) return;

    passEncoder.setBindGroup(0, this.bindGroup);
    passEncoder.draw(this.vertexCount, 1, 0, 0);
  }

  destroy() {
    if (this.voxelBuffer) this.voxelBuffer.destroy();
    if (this.uniformBuffer) this.uniformBuffer.destroy();
  }
}

class EfficientVoxelWorld {
  constructor(renderer, terrainGenerator, camera) {
    this.renderer = renderer;
    this.terrainGenerator = terrainGenerator;
    this.camera = camera;
    this.chunks = new Map();
    this.visibleChunks = [];
    this.frameCount = 0;
    this.totalVertices = 0;
    this.sunDirection = [0.5, 0.8, 0.5];
    this.ambientIntensity = 0.7;
  }

  static async initShaders(renderer) {
    const shaderModule = renderer.createShaderModule(OPTIMIZED_VOXEL_WGSL);

    EfficientVoxelChunk.bindGroupLayout = renderer.createBindGroupLayout([
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

    const pipelineLayout = renderer.createPipelineLayout([EfficientVoxelChunk.bindGroupLayout]);

    EfficientVoxelChunk.pipeline = renderer.createRenderPipeline({
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
    await EfficientVoxelWorld.initShaders(this.renderer);
    await this.updateChunks();
  }

  getChunkKey(chunkX, chunkZ) {
    return `${chunkX},${chunkZ}`;
  }

  getLODLevel(distance) {
    if (distance < 3 * 16) return 1;
    if (distance < 6 * 16) return 2;
    if (distance < 9 * 16) return 4;
    return 8;
  }

  async updateChunks() {
    const cameraChunkX = Math.floor(this.camera.position[0] / 16);
    const cameraChunkZ = Math.floor(this.camera.position[2] / 16);

    const toRemove = [];
    for (const [key, chunk] of this.chunks) {
      const dx = Math.abs(chunk.chunkX - cameraChunkX);
      const dz = Math.abs(chunk.chunkZ - cameraChunkZ);
      if (dx > 12 || dz > 12) {
        toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      this.chunks.get(key).destroy();
      this.chunks.delete(key);
    }

    const newChunks = [];
    for (let x = -10; x <= 10; x++) {
      for (let z = -10; z <= 10; z++) {
        const chunkX = cameraChunkX + x;
        const chunkZ = cameraChunkZ + z;
        const key = this.getChunkKey(chunkX, chunkZ);

        if (!this.chunks.has(key)) {
          const distance = Math.sqrt(x * x + z * z) * 16;
          if (distance < 10 * 16) {
            newChunks.push({ chunkX, chunkZ, distance, key });
          }
        }
      }
    }

    newChunks.sort((a, b) => a.distance - b.distance);

    const toLoad = newChunks.slice(0, 8);
    const promises = toLoad.map(async ({ chunkX, chunkZ, distance, key }) => {
      const lod = this.getLODLevel(distance);
      const chunk = new EfficientVoxelChunk(this.renderer, chunkX, chunkZ, lod);
      await chunk.init(this.terrainGenerator);
      this.chunks.set(key, chunk);
    });

    await Promise.all(promises);
  }

  update() {
    this.frameCount++;
    
    if (this.frameCount % 10 === 0) {
      this.updateChunks();
    }

    this.visibleChunks = [];

    for (const chunk of this.chunks.values()) {
      chunk.updateVisibility(this.camera, this.frameCount);
      
      if (chunk.visible) {
        this.visibleChunks.push(chunk);
      }
    }

    this.visibleChunks.sort((a, b) => a.distance - b.distance);
  }

  setSunDirection(x, y, z) {
    const len = Math.sqrt(x * x + y * y + z * z);
    this.sunDirection = [x / len, y / len, z / len];
  }

  setAmbientIntensity(intensity) {
    this.ambientIntensity = intensity;
  }

  render(camera) {
    const passEncoder = this.renderer.getPassEncoder();
    passEncoder.setPipeline(EfficientVoxelChunk.pipeline);

    const viewProj = camera.getViewProjMatrix();
    const cameraPos = camera.getPosition();

    this.totalVertices = 0;
    let renderedChunks = 0;

    for (const chunk of this.visibleChunks) {
      if (renderedChunks > 150) break;
      
      chunk.updateUniforms(viewProj, this.sunDirection, this.ambientIntensity, cameraPos);
      chunk.render(passEncoder);
      
      this.totalVertices += chunk.vertexCount;
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

export default EfficientVoxelWorld;
