import { vec3 } from 'gl-matrix';

const PARTICLE_WGSL = `
struct Particle {
  position: vec3<f32>,
  velocity: vec3<f32>,
  color: vec3<f32>,
  lifetime: f32,
  maxLifetime: f32,
  size: f32,
  active: u32,
  padding: u32
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> deltaTime: f32;
@group(0) @binding(2) var<uniform> gravity: vec3<f32>;
@group(0) @binding(3) var<uniform> wind: vec3<f32>;

@compute @workgroup_size(256)
fn updateParticles(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  
  if (index >= arrayLength(&particles)) {
    return;
  }
  
  var particle = particles[index];
  
  if (particle.active == 0u) {
    return;
  }
  
  particle.velocity += gravity * deltaTime;
  particle.velocity += wind * deltaTime;
  particle.velocity *= 0.98;
  
  particle.position += particle.velocity * deltaTime;
  
  if (particle.position.y < 0.0) {
    particle.position.y = 0.0;
    particle.velocity.y *= -0.3;
    particle.velocity.x *= 0.7;
    particle.velocity.z *= 0.7;
  }
  
  particle.lifetime -= deltaTime;
  
  if (particle.lifetime <= 0.0) {
    particle.active = 0u;
  }
  
  particles[index] = particle;
}

@compute @workgroup_size(64)
fn spawnParticles(@builtin(global_invocation_id) id: vec3<u32>,
                  @builtin(num_workgroups) numGroups: vec3<u32>) {
  let index = id.x;
  
  if (index >= arrayLength(&particles)) {
    return;
  }
  
  var particle = particles[index];
  
  if (particle.active == 1u) {
    return;
  }
  
  let randX = fract(sin(f32(index) * 12.9898 + f32(numGroups.x) * 78.233) * 43758.5453);
  let randY = fract(sin(f32(index) * 43.231 + f32(numGroups.y) * 92.324) * 23421.631);
  let randZ = fract(sin(f32(index) * 74.234 + f32(numGroups.z) * 10.423) * 74234.124);
  
  particle.active = 1u;
  particle.lifetime = particle.maxLifetime;
  
  particles[index] = particle;
}
`;

const PARTICLE_RENDER_WGSL = `
struct Uniforms {
  viewProj: mat4x4<f32>,
  cameraRight: vec3<f32>,
  cameraUp: vec3<f32>,
  padding: f32
};

struct Particle {
  position: vec3<f32>,
  velocity: vec3<f32>,
  color: vec3<f32>,
  lifetime: f32,
  maxLifetime: f32,
  size: f32,
  active: u32,
  padding: u32
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage> particles: array<Particle>;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> @location(0) vec4<f32> {
  var particle = particles[instanceIndex];
  
  if (particle.active == 0u) {
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }
  
  let cornerIndex = vertexIndex % 6u;
  
  var corners: array<vec2<f32>, 6> = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, 1.0)
  );
  
  let corner = corners[cornerIndex];
  let lifeRatio = particle.lifetime / particle.maxLifetime;
  let currentSize = particle.size * lifeRatio;
  
  var worldPos = particle.position;
  worldPos += uniforms.cameraRight * corner.x * currentSize;
  worldPos += uniforms.cameraUp * corner.y * currentSize;
  
  var outputColor = vec4<f32>(particle.color, lifeRatio);
  
  let clipPos = uniforms.viewProj * vec4<f32>(worldPos, 1.0);
  
  return clipPos;
}

@fragment
fn fs_main(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {
  return color;
}
`;

class ParticleSystem {
  constructor(renderer, maxParticles = 8192) {
    this.renderer = renderer;
    this.device = renderer.device;
    this.maxParticles = maxParticles;
    this.particleBuffer = null;
    this.uniformBuffer = null;
    this.computeBindGroup = null;
    this.renderBindGroup = null;
    this.computePipeline = null;
    this.renderPipeline = null;
    this.particles = [];
    this.activeParticleCount = 0;
  }

  async init() {
    this.createBuffers();
    this.createPipelines();
    this.initParticles();
  }

  createBuffers() {
    const particleSize = 4 * 3 + 4 * 3 + 4 + 4 + 4 + 4;
    const bufferSize = this.maxParticles * particleSize;
    
    this.particleBuffer = this.device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 64 + 16 + 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.computeBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }
      ]
    });

    this.renderBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }
      ]
    });

    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.uniformBuffer, offset: 0, size: 4 } },
        { binding: 2, resource: { buffer: this.uniformBuffer, offset: 16, size: 12 } },
        { binding: 3, resource: { buffer: this.uniformBuffer, offset: 32, size: 12 } }
      ]
    });

    this.renderBindGroup = this.device.createBindGroup({
      layout: this.renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer, offset: 64, size: 80 } },
        { binding: 1, resource: { buffer: this.particleBuffer } }
      ]
    });
  }

  createPipelines() {
    const computeShaderModule = this.renderer.createShaderModule(PARTICLE_WGSL);
    const renderShaderModule = this.renderer.createShaderModule(PARTICLE_RENDER_WGSL);

    const computePipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.computeBindGroupLayout]
    });

    this.computePipeline = this.device.createComputePipeline({
      layout: computePipelineLayout,
      compute: {
        module: computeShaderModule,
        entryPoint: 'updateParticles'
      }
    });

    const renderPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.renderBindGroupLayout]
    });

    this.renderPipeline = this.device.createRenderPipeline({
      layout: renderPipelineLayout,
      vertex: {
        module: renderShaderModule,
        entryPoint: 'vs_main'
      },
      fragment: {
        module: renderShaderModule,
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
        topology: 'triangle-list'
      },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus'
      }
    });
  }

  initParticles() {
    const particleData = new Float32Array(this.maxParticles * 16);
    
    for (let i = 0; i < this.maxParticles; i++) {
      const baseIndex = i * 16;
      particleData[baseIndex] = 0;
      particleData[baseIndex + 1] = 0;
      particleData[baseIndex + 2] = 0;
      particleData[baseIndex + 3] = 0;
      particleData[baseIndex + 4] = 0;
      particleData[baseIndex + 5] = 0;
      particleData[baseIndex + 6] = 0;
      particleData[baseIndex + 7] = 0;
      particleData[baseIndex + 8] = 0;
      particleData[baseIndex + 9] = 3.0;
      particleData[baseIndex + 10] = 0.15;
      particleData[baseIndex + 11] = 0;
      particleData[baseIndex + 12] = 0;
      particleData[baseIndex + 13] = 0;
      particleData[baseIndex + 14] = 0;
      particleData[baseIndex + 15] = 0;
    }
    
    this.device.queue.writeBuffer(this.particleBuffer, 0, particleData);
  }

  spawnParticles(position, color, count = 16) {
    const newParticles = [];
    
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 6;
      const velocity = [
        Math.cos(angle) * speed + (Math.random() - 0.5) * 2,
        3 + Math.random() * 5,
        Math.sin(angle) * speed + (Math.random() - 0.5) * 2
      ];

      const offset = [
        (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.8
      ];

      newParticles.push({
        position: [
          position[0] + offset[0],
          position[1] + offset[1],
          position[2] + offset[2]
        ],
        velocity,
        color,
        lifetime: 2.0 + Math.random() * 2.0,
        maxLifetime: 4.0,
        size: 0.1 + Math.random() * 0.15,
        active: 1
      });
    }

    this.addParticlesToBuffer(newParticles);
  }

  async addParticlesToBuffer(newParticles) {
    const particlesToAdd = newParticles.length;
    
    await this.particleBuffer.mapAsync(GPUMapMode.READ);
    const particleData = new Float32Array(this.particleBuffer.getMappedRange());
    
    let addedCount = 0;
    for (let i = 0; i < this.maxParticles && addedCount < particlesToAdd; i++) {
      const baseIndex = i * 16;
      if (particleData[baseIndex + 11] === 0) {
        const particle = newParticles[addedCount];
        
        particleData[baseIndex] = particle.position[0];
        particleData[baseIndex + 1] = particle.position[1];
        particleData[baseIndex + 2] = particle.position[2];
        
        particleData[baseIndex + 4] = particle.velocity[0];
        particleData[baseIndex + 5] = particle.velocity[1];
        particleData[baseIndex + 6] = particle.velocity[2];
        
        particleData[baseIndex + 8] = particle.color[0];
        particleData[baseIndex + 9] = particle.color[1];
        particleData[baseIndex + 10] = particle.color[2];
        
        particleData[baseIndex + 12] = particle.lifetime;
        particleData[baseIndex + 13] = particle.maxLifetime;
        particleData[baseIndex + 14] = particle.size;
        particleData[baseIndex + 15] = particle.active;
        
        addedCount++;
      }
    }
    
    this.particleBuffer.unmap();
  }

  update(deltaTime, camera) {
    const gravity = [0, -15, 0];
    const wind = [0.5, 0, 0.3];
    
    const uniformData = new Float32Array(36);
    uniformData[0] = deltaTime;
    uniformData.set(gravity, 4);
    uniformData.set(wind, 8);
    
    if (camera) {
      const viewProj = camera.getViewProjMatrix();
      uniformData.set(viewProj, 16);
      uniformData.set(camera.right, 16 + 16);
      uniformData.set(camera.up, 16 + 20);
    }
    
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
  }

  compute(commandEncoder) {
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.computePipeline);
    passEncoder.setBindGroup(0, this.computeBindGroup);
    passEncoder.dispatchWorkgroups(Math.ceil(this.maxParticles / 256));
    passEncoder.end();
  }

  render(passEncoder) {
    passEncoder.setPipeline(this.renderPipeline);
    passEncoder.setBindGroup(0, this.renderBindGroup);
    passEncoder.draw(6, this.maxParticles, 0, 0);
  }
}

export default ParticleSystem;
