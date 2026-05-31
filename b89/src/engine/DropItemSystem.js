import { vec3 } from 'gl-matrix';

const DROP_ITEM_WGSL = `
struct DropItem {
  position: vec3<f32>,
  velocity: vec3<f32>,
  color: vec3<f32>,
  voxelType: u32,
  lifetime: f32,
  size: f32,
  grounded: u32,
  padding: u32
};

@group(0) @binding(0) var<storage, read_write> dropItems: array<DropItem>;
@group(0) @binding(1) var<uniform> deltaTime: f32;
@group(0) @binding(2) var<uniform> gravity: vec3<f32>;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> @location(0) vec4<f32> {
  var item = dropItems[instanceIndex];
  
  if (item.lifetime <= 0.0) {
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }
  
  let voxelSize = item.size;
  let halfSize = voxelSize * 0.5;
  
  var vertices: array<vec3<f32>, 36> = array<vec3<f32>, 36>(
    vec3<f32>(halfSize, -halfSize, -halfSize), vec3<f32>(halfSize, halfSize, -halfSize), vec3<f32>(halfSize, halfSize, halfSize),
    vec3<f32>(halfSize, -halfSize, -halfSize), vec3<f32>(halfSize, halfSize, halfSize), vec3<f32>(halfSize, -halfSize, halfSize),
    vec3<f32>(-halfSize, -halfSize, halfSize), vec3<f32>(-halfSize, halfSize, halfSize), vec3<f32>(-halfSize, halfSize, -halfSize),
    vec3<f32>(-halfSize, -halfSize, halfSize), vec3<f32>(-halfSize, halfSize, -halfSize), vec3<f32>(-halfSize, -halfSize, -halfSize),
    vec3<f32>(-halfSize, halfSize, -halfSize), vec3<f32>(-halfSize, halfSize, halfSize), vec3<f32>(halfSize, halfSize, halfSize),
    vec3<f32>(-halfSize, halfSize, -halfSize), vec3<f32>(halfSize, halfSize, halfSize), vec3<f32>(halfSize, halfSize, -halfSize),
    vec3<f32>(-halfSize, -halfSize, halfSize), vec3<f32>(-halfSize, -halfSize, -halfSize), vec3<f32>(halfSize, -halfSize, -halfSize),
    vec3<f32>(-halfSize, -halfSize, halfSize), vec3<f32>(halfSize, -halfSize, -halfSize), vec3<f32>(halfSize, -halfSize, halfSize),
    vec3<f32>(-halfSize, -halfSize, halfSize), vec3<f32>(halfSize, -halfSize, halfSize), vec3<f32>(halfSize, halfSize, halfSize),
    vec3<f32>(-halfSize, -halfSize, halfSize), vec3<f32>(halfSize, halfSize, halfSize), vec3<f32>(-halfSize, halfSize, halfSize),
    vec3<f32>(-halfSize, -halfSize, -halfSize), vec3<f32>(halfSize, -halfSize, -halfSize), vec3<f32>(halfSize, halfSize, -halfSize),
    vec3<f32>(-halfSize, -halfSize, -halfSize), vec3<f32>(halfSize, halfSize, -halfSize), vec3<f32>(-halfSize, halfSize, -halfSize)
  );
  
  let vertex = vertices[vertexIndex] + item.position;
  
  return vec4<f32>(vertex, 1.0);
}

@fragment
fn fs_main(@location(0) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  return vec4<f32>(0.8, 0.7, 0.5, 1.0);
}
`;

class DropItemSystem {
  constructor(renderer, voxelWorld, maxItems = 512) {
    this.renderer = renderer;
    this.device = renderer.device;
    this.voxelWorld = voxelWorld;
    this.maxItems = maxItems;
    this.dropItems = [];
    this.itemBuffer = null;
    this.uniformBuffer = null;
    this.bindGroup = null;
    this.pipeline = null;
  }

  async init() {
    this.createBuffers();
    this.createPipeline();
  }

  createBuffers() {
    const itemSize = 12 + 12 + 12 + 4 + 4 + 4 + 4 + 4;
    const bufferSize = this.maxItems * itemSize;
    
    this.itemBuffer = this.device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }
      ]
    });

    this.bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.itemBuffer } },
        { binding: 1, resource: { buffer: this.uniformBuffer, offset: 0, size: 4 } },
        { binding: 2, resource: { buffer: this.uniformBuffer, offset: 16, size: 12 } }
      ]
    });

    this.renderBindGroupLayout = bindGroupLayout;
  }

  createPipeline() {
    const shaderModule = this.renderer.createShaderModule(DROP_ITEM_WGSL);

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.renderBindGroupLayout]
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main'
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: this.renderer.presentationFormat
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

  spawnDropItem(position, voxelType, color) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 2;
    
    const dropItem = {
      position: [...position],
      velocity: [
        Math.cos(angle) * speed,
        2 + Math.random() * 3,
        Math.sin(angle) * speed
      ],
      color,
      voxelType,
      lifetime: 60.0,
      size: 0.3,
      grounded: 0
    };

    this.dropItems.push(dropItem);
    this.updateBuffer();
  }

  update(deltaTime) {
    const gravity = [0, -20, 0];
    
    for (let i = this.dropItems.length - 1; i >= 0; i--) {
      const item = this.dropItems[i];
      
      item.lifetime -= deltaTime;
      if (item.lifetime <= 0) {
        this.dropItems.splice(i, 1);
        continue;
      }

      item.velocity[0] += gravity[0] * deltaTime;
      item.velocity[1] += gravity[1] * deltaTime;
      item.velocity[2] += gravity[2] * deltaTime;

      item.velocity[0] *= 0.98;
      item.velocity[1] *= 0.98;
      item.velocity[2] *= 0.98;

      const newPos = [
        item.position[0] + item.velocity[0] * deltaTime,
        item.position[1] + item.velocity[1] * deltaTime,
        item.position[2] + item.velocity[2] * deltaTime
      ];

      if (newPos[1] < 0.2) {
        newPos[1] = 0.2;
        item.velocity[1] = -item.velocity[1] * 0.3;
        item.velocity[0] *= 0.7;
        item.velocity[2] *= 0.7;
        item.grounded = 1;
      }

      this.checkVoxelCollision(item, newPos);

      item.position = newPos;
    }

    this.updateBuffer();

    const uniformData = new Float32Array(8);
    uniformData[0] = deltaTime;
    uniformData.set(gravity, 4);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
  }

  checkVoxelCollision(item, newPos) {
    const gridX = Math.floor(newPos[0]);
    const gridY = Math.floor(newPos[1]);
    const gridZ = Math.floor(newPos[2]);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const checkX = gridX + dx;
          const checkY = gridY + dy;
          const checkZ = gridZ + dz;

          if (this.checkVoxelAt(checkX, checkY, checkZ)) {
            const voxelCenter = [checkX + 0.5, checkY + 0.5, checkZ + 0.5];
            const toVoxel = [
              newPos[0] - voxelCenter[0],
              newPos[1] - voxelCenter[1],
              newPos[2] - voxelCenter[2]
            ];

            const dist = Math.sqrt(toVoxel[0] * toVoxel[0] + toVoxel[1] * toVoxel[1] + toVoxel[2] * toVoxel[2]);
            const minDist = 0.5 + item.size * 0.5;

            if (dist < minDist) {
              const normal = [toVoxel[0] / dist, toVoxel[1] / dist, toVoxel[2] / dist];
              const dot = item.velocity[0] * normal[0] + item.velocity[1] * normal[1] + item.velocity[2] * normal[2];

              item.velocity[0] -= 1.5 * dot * normal[0];
              item.velocity[1] -= 1.5 * dot * normal[1];
              item.velocity[2] -= 1.5 * dot * normal[2];

              const penetration = minDist - dist;
              newPos[0] += normal[0] * penetration;
              newPos[1] += normal[1] * penetration;
              newPos[2] += normal[2] * penetration;
            }
          }
        }
      }
    }
  }

  checkVoxelAt(x, y, z) {
    if (y < 0) return true;
    if (y > 256) return false;

    const chunkX = Math.floor(x / 16);
    const chunkZ = Math.floor(z / 16);
    const localX = ((x % 16) + 16) % 16;
    const localZ = ((z % 16) + 16) % 16;
    const localY = y;

    const key = `${chunkX},${chunkZ}`;
    const chunk = this.voxelWorld.chunks.get(key);

    if (chunk && chunk.voxels) {
      const voxelIndex = localY * 16 * 16 + localZ * 16 + localX;
      return chunk.voxels[voxelIndex] > 0;
    }

    return false;
  }

  updateBuffer() {
    const itemData = new Float32Array(this.maxItems * 16);
    
    for (let i = 0; i < Math.min(this.dropItems.length, this.maxItems); i++) {
      const item = this.dropItems[i];
      const baseIndex = i * 16;
      
      itemData[baseIndex] = item.position[0];
      itemData[baseIndex + 1] = item.position[1];
      itemData[baseIndex + 2] = item.position[2];
      
      itemData[baseIndex + 4] = item.velocity[0];
      itemData[baseIndex + 5] = item.velocity[1];
      itemData[baseIndex + 6] = item.velocity[2];
      
      itemData[baseIndex + 8] = item.color[0];
      itemData[baseIndex + 9] = item.color[1];
      itemData[baseIndex + 10] = item.color[2];
      itemData[baseIndex + 11] = item.voxelType;
      
      itemData[baseIndex + 12] = item.lifetime;
      itemData[baseIndex + 13] = item.size;
      itemData[baseIndex + 14] = item.grounded;
    }
    
    this.device.queue.writeBuffer(this.itemBuffer, 0, itemData);
  }

  render(passEncoder) {
    if (this.dropItems.length === 0) return;

    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, this.bindGroup);
    passEncoder.draw(36, Math.min(this.dropItems.length, this.maxItems), 0, 0);
  }

  getActiveCount() {
    return this.dropItems.length;
  }
}

export default DropItemSystem;
