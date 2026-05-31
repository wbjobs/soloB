import { vec3 } from 'gl-matrix';

const PREVIEW_WGSL = `
struct Uniforms {
  viewProj: mat4x4<f32>,
  previewPos: vec3<f32>,
  canBuild: u32,
  voxelSize: f32
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @location(0) vec4<f32> {
  let halfSize = uniforms.voxelSize * 0.5;
  
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
  
  let vertex = vertices[vertexIndex] + uniforms.previewPos;
  return uniforms.viewProj * vec4<f32>(vertex, 1.0);
}

@fragment
fn fs_main(@location(0) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  var color = vec3<f32>(0.0, 1.0, 0.0);
  
  return vec4<f32>(color, 0.4);
}
`;

const HIGHLIGHT_WGSL = `
struct Uniforms {
  viewProj: mat4x4<f32>,
  targetPos: vec3<f32>,
  faceNormal: vec3<f32>,
  voxelSize: f32
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @location(0) vec4<f32> {
  let halfSize = uniforms.voxelSize * 0.52;
  let thickness = 0.05;
  
  var faceVertices: array<vec3<f32>, 6>;
  
  if (uniforms.faceNormal.x > 0.5) {
    faceVertices[0] = vec3<f32>(halfSize, -halfSize, -halfSize);
    faceVertices[1] = vec3<f32>(halfSize, halfSize, -halfSize);
    faceVertices[2] = vec3<f32>(halfSize, halfSize, halfSize);
    faceVertices[3] = vec3<f32>(halfSize, -halfSize, -halfSize);
    faceVertices[4] = vec3<f32>(halfSize, halfSize, halfSize);
    faceVertices[5] = vec3<f32>(halfSize, -halfSize, halfSize);
  } else if (uniforms.faceNormal.x < -0.5) {
    faceVertices[0] = vec3<f32>(-halfSize, -halfSize, halfSize);
    faceVertices[1] = vec3<f32>(-halfSize, halfSize, halfSize);
    faceVertices[2] = vec3<f32>(-halfSize, halfSize, -halfSize);
    faceVertices[3] = vec3<f32>(-halfSize, -halfSize, halfSize);
    faceVertices[4] = vec3<f32>(-halfSize, halfSize, -halfSize);
    faceVertices[5] = vec3<f32>(-halfSize, -halfSize, -halfSize);
  } else if (uniforms.faceNormal.y > 0.5) {
    faceVertices[0] = vec3<f32>(-halfSize, halfSize, -halfSize);
    faceVertices[1] = vec3<f32>(-halfSize, halfSize, halfSize);
    faceVertices[2] = vec3<f32>(halfSize, halfSize, halfSize);
    faceVertices[3] = vec3<f32>(-halfSize, halfSize, -halfSize);
    faceVertices[4] = vec3<f32>(halfSize, halfSize, halfSize);
    faceVertices[5] = vec3<f32>(halfSize, halfSize, -halfSize);
  } else if (uniforms.faceNormal.y < -0.5) {
    faceVertices[0] = vec3<f32>(-halfSize, -halfSize, halfSize);
    faceVertices[1] = vec3<f32>(-halfSize, -halfSize, -halfSize);
    faceVertices[2] = vec3<f32>(halfSize, -halfSize, -halfSize);
    faceVertices[3] = vec3<f32>(-halfSize, -halfSize, halfSize);
    faceVertices[4] = vec3<f32>(halfSize, -halfSize, -halfSize);
    faceVertices[5] = vec3<f32>(halfSize, -halfSize, halfSize);
  } else if (uniforms.faceNormal.z > 0.5) {
    faceVertices[0] = vec3<f32>(-halfSize, -halfSize, halfSize);
    faceVertices[1] = vec3<f32>(halfSize, -halfSize, halfSize);
    faceVertices[2] = vec3<f32>(halfSize, halfSize, halfSize);
    faceVertices[3] = vec3<f32>(-halfSize, -halfSize, halfSize);
    faceVertices[4] = vec3<f32>(halfSize, halfSize, halfSize);
    faceVertices[5] = vec3<f32>(-halfSize, halfSize, halfSize);
  } else {
    faceVertices[0] = vec3<f32>(halfSize, -halfSize, -halfSize);
    faceVertices[1] = vec3<f32>(-halfSize, -halfSize, -halfSize);
    faceVertices[2] = vec3<f32>(-halfSize, halfSize, -halfSize);
    faceVertices[3] = vec3<f32>(halfSize, -halfSize, -halfSize);
    faceVertices[4] = vec3<f32>(-halfSize, halfSize, -halfSize);
    faceVertices[5] = vec3<f32>(halfSize, halfSize, -halfSize);
  }
  
  let vertex = faceVertices[vertexIndex] + uniforms.targetPos;
  return uniforms.viewProj * vec4<f32>(vertex, 1.0);
}

@fragment
fn fs_main(@location(0) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 1.0, 0.0, 0.8);
}
`;

class BuildPreviewSystem {
  constructor(renderer, voxelWorld) {
    this.renderer = renderer;
    this.device = renderer.device;
    this.voxelWorld = voxelWorld;
    this.previewPosition = null;
    this.canBuild = false;
    this.highlightPosition = null;
    this.highlightNormal = [0, 0, 0];
    this.voxelSize = 1.0;
    this.previewBuffer = null;
    this.highlightBuffer = null;
    this.previewBindGroup = null;
    this.highlightBindGroup = null;
    this.previewPipeline = null;
    this.highlightPipeline = null;
    this.raycastDistance = 8.0;
  }

  async init() {
    this.createBuffers();
    this.createPipelines();
  }

  createBuffers() {
    this.previewBuffer = this.device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.highlightBuffer = this.device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }
      ]
    });

    this.previewBindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.previewBuffer } }]
    });

    this.highlightBindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.highlightBuffer } }]
    });

    this.bindGroupLayout = bindGroupLayout;
  }

  createPipelines() {
    const previewShader = this.renderer.createShaderModule(PREVIEW_WGSL);
    const highlightShader = this.renderer.createShaderModule(HIGHLIGHT_WGSL);

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout]
    });

    this.previewPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: previewShader,
        entryPoint: 'vs_main'
      },
      fragment: {
        module: previewShader,
        entryPoint: 'fs_main',
        targets: [{
          format: this.renderer.presentationFormat,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add'
            },
            alpha: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add'
            }
          }
        }]
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back'
      },
      depthStencil: {
        depthWriteEnabled: false,
        depthCompare: 'less',
        format: 'depth24plus'
      }
    });

    this.highlightPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: highlightShader,
        entryPoint: 'vs_main'
      },
      fragment: {
        module: highlightShader,
        entryPoint: 'fs_main',
        targets: [{
          format: this.renderer.presentationFormat,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add'
            },
            alpha: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add'
            }
          }
        }]
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back'
      },
      depthStencil: {
        depthWriteEnabled: false,
        depthCompare: 'less',
        format: 'depth24plus'
      }
    });
  }

  raycast(camera) {
    const origin = [...camera.position];
    const direction = [...camera.front];
    
    const dirLength = Math.sqrt(direction[0]**2 + direction[1]**2 + direction[2]**2);
    direction[0] /= dirLength;
    direction[1] /= dirLength;
    direction[2] /= dirLength;

    let currentPos = [...origin];
    let hitVoxel = null;
    let hitNormal = null;

    const step = 0.1;
    const maxSteps = Math.floor(this.raycastDistance / step);

    for (let i = 0; i < maxSteps; i++) {
      const gridX = Math.floor(currentPos[0]);
      const gridY = Math.floor(currentPos[1]);
      const gridZ = Math.floor(currentPos[2]);

      if (this.checkVoxelAt(gridX, gridY, gridZ)) {
        hitVoxel = [gridX, gridY, gridZ];
        
        const prevX = Math.floor(currentPos[0] - direction[0] * step);
        const prevY = Math.floor(currentPos[1] - direction[1] * step);
        const prevZ = Math.floor(currentPos[2] - direction[2] * step);

        if (prevX !== gridX) {
          hitNormal = [direction[0] > 0 ? -1 : 1, 0, 0];
        } else if (prevY !== gridY) {
          hitNormal = [0, direction[1] > 0 ? -1 : 1, 0];
        } else if (prevZ !== gridZ) {
          hitNormal = [0, 0, direction[2] > 0 ? -1 : 1];
        } else {
          hitNormal = [-direction[0], -direction[1], -direction[2]];
        }
        
        break;
      }

      currentPos[0] += direction[0] * step;
      currentPos[1] += direction[1] * step;
      currentPos[2] += direction[2] * step;
    }

    if (hitVoxel && hitNormal) {
      this.highlightPosition = hitVoxel;
      this.highlightNormal = hitNormal;
      
      const buildX = hitVoxel[0] + hitNormal[0];
      const buildY = hitVoxel[1] + hitNormal[1];
      const buildZ = hitVoxel[2] + hitNormal[2];
      
      const playerDist = Math.sqrt(
        (buildX - camera.position[0])**2 +
        (buildY - camera.position[1])**2 +
        (buildZ - camera.position[2])**2
      );
      
      if (playerDist > 0.8) {
        this.previewPosition = [buildX, buildY, buildZ];
        this.canBuild = !this.checkVoxelAt(buildX, buildY, buildZ);
      } else {
        this.previewPosition = null;
        this.canBuild = false;
      }
    } else {
      this.highlightPosition = null;
      this.previewPosition = null;
      this.canBuild = false;
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

  update(camera) {
    this.raycast(camera);
  }

  updateUniforms(viewProj) {
    if (this.previewPosition) {
      const previewData = new Float32Array(20);
      previewData.set(viewProj, 0);
      previewData[16] = this.previewPosition[0];
      previewData[17] = this.previewPosition[1];
      previewData[18] = this.previewPosition[2];
      previewData[19] = this.canBuild ? 1 : 0;
      previewData[20] = this.voxelSize;
      this.device.queue.writeBuffer(this.previewBuffer, 0, previewData);
    }

    if (this.highlightPosition) {
      const highlightData = new Float32Array(20);
      highlightData.set(viewProj, 0);
      highlightData[16] = this.highlightPosition[0];
      highlightData[17] = this.highlightPosition[1];
      highlightData[18] = this.highlightPosition[2];
      highlightData.set(this.highlightNormal, 20);
      highlightData[24] = this.voxelSize;
      this.device.queue.writeBuffer(this.highlightBuffer, 0, highlightData);
    }
  }

  render(passEncoder, viewProj) {
    this.updateUniforms(viewProj);

    if (this.highlightPosition) {
      passEncoder.setPipeline(this.highlightPipeline);
      passEncoder.setBindGroup(0, this.highlightBindGroup);
      passEncoder.draw(6, 1, 0, 0);
    }

    if (this.previewPosition) {
      passEncoder.setPipeline(this.previewPipeline);
      passEncoder.setBindGroup(0, this.previewBindGroup);
      passEncoder.draw(36, 1, 0, 0);
    }
  }

  getPreviewPosition() {
    return this.previewPosition;
  }

  getHighlightPosition() {
    return this.highlightPosition;
  }

  canBuildAtPreview() {
    return this.canBuild;
  }

  placeVoxel(voxelType = 2) {
    if (!this.canBuild || !this.previewPosition) {
      return false;
    }

    const [x, y, z] = this.previewPosition;
    this.setVoxelAt(x, y, z, voxelType);
    return true;
  }

  destroyVoxel() {
    if (!this.highlightPosition) {
      return false;
    }

    const [x, y, z] = this.highlightPosition;
    this.setVoxelAt(x, y, z, 0);
    return { position: [x + 0.5, y + 0.5, z + 0.5], voxelType: this.getVoxelTypeAt(x, y, z) };
  }

  setVoxelAt(x, y, z, type) {
    if (y < 0 || y > 256) return;

    const chunkX = Math.floor(x / 16);
    const chunkZ = Math.floor(z / 16);
    const localX = ((x % 16) + 16) % 16;
    const localZ = ((z % 16) + 16) % 16;
    const localY = y;

    const key = `${chunkX},${chunkZ}`;
    const chunk = this.voxelWorld.chunks.get(key);

    if (chunk && chunk.voxels) {
      const voxelIndex = localY * 16 * 16 + localZ * 16 + localX;
      chunk.voxels[voxelIndex] = type;
      
      if (chunk.voxelBuffer) {
        this.device.queue.writeBuffer(chunk.voxelBuffer, 0, new Uint32Array(chunk.voxels));
      }
    }
  }

  getVoxelTypeAt(x, y, z) {
    if (y < 0 || y > 256) return 0;

    const chunkX = Math.floor(x / 16);
    const chunkZ = Math.floor(z / 16);
    const localX = ((x % 16) + 16) % 16;
    const localZ = ((z % 16) + 16) % 16;
    const localY = y;

    const key = `${chunkX},${chunkZ}`;
    const chunk = this.voxelWorld.chunks.get(key);

    if (chunk && chunk.voxels) {
      const voxelIndex = localY * 16 * 16 + localZ * 16 + localX;
      return chunk.voxels[voxelIndex];
    }

    return 0;
  }
}

export default BuildPreviewSystem;
