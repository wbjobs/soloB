import { vec3 } from 'gl-matrix';

const SIMPLE_GI_WGSL = `
struct Uniforms {
  sunDirection: vec3<f32>,
  ambientIntensity: f32,
  cameraPos: vec3<f32>,
  time: f32
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs_main(@location(0) worldPos: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) albedo: vec3<f32>) -> @location(0) vec4<f32> {
  let n = normalize(normal);
  
  let sunDir = normalize(uniforms.sunDirection);
  let diffuse = max(dot(n, sunDir), 0.0);
  
  let ambient = vec3<f32>(0.3, 0.35, 0.45) * uniforms.ambientIntensity;
  
  let viewDir = normalize(uniforms.cameraPos - worldPos);
  let halfDir = normalize(sunDir + viewDir);
  let specular = pow(max(dot(n, halfDir), 0.0), 32.0);
  
  let skyLight = max(n.y, 0.0) * 0.3 * uniforms.ambientIntensity;
  
  let indirect = vec3<f32>(0.2, 0.2, 0.25) * max(n.y, 0.1) + 
                 vec3<f32>(0.15, 0.1, 0.05) * max(-n.y, 0.1);
  
  let totalLight = ambient + vec3<f32>(1.0, 0.95, 0.85) * diffuse * 1.5 + 
                   skyLight + indirect;
  
  let finalColor = albedo * totalLight + specular * 0.1;
  
  let fogDensity = 0.0008;
  let distance = length(worldPos - uniforms.cameraPos);
  let fogFactor = 1.0 - exp(-distance * fogDensity);
  let fogColor = mix(vec3<f32>(0.6, 0.7, 0.8), vec3<f32>(0.3, 0.35, 0.45), uniforms.ambientIntensity);
  
  let color = mix(finalColor, fogColor, clamp(fogFactor, 0.0, 0.6));
  
  return vec4<f32>(color, 1.0);
}
`;

class SimpleGISystem {
  constructor(renderer, chunkManager) {
    this.renderer = renderer;
    this.device = renderer.device;
    this.chunkManager = chunkManager;
    this.sunDirection = [0.5, 0.8, 0.5];
    this.ambientIntensity = 0.5;
    this.time = 0;
    this.uniformBuffer = null;
    this.bindGroup = null;
    this.pipeline = null;
  }

  async init() {
    const shaderModule = this.renderer.createShaderModule(SIMPLE_GI_WGSL);

    this.uniformBuffer = this.renderer.createBuffer(
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      64
    );

    this.bindGroupLayout = this.renderer.createBindGroupLayout([
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX,
        buffer: { type: 'uniform' }
      }
    ]);

    this.bindGroup = this.renderer.createBindGroup(this.bindGroupLayout, [
      { binding: 0, resource: { buffer: this.uniformBuffer } }
    ]);

    const pipelineLayout = this.renderer.createPipelineLayout([this.bindGroupLayout]);

    this.pipeline = this.renderer.createRenderPipeline({
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

  setSunDirection(x, y, z) {
    const len = Math.sqrt(x * x + y * y + z * z);
    this.sunDirection = [x / len, y / len, z / len];
  }

  setAmbientIntensity(intensity) {
    this.ambientIntensity = intensity;
  }

  update(deltaTime, camera) {
    this.time += deltaTime;
    const cameraPos = camera.getPosition();
    
    const data = new Float32Array([
      this.sunDirection[0], this.sunDirection[1], this.sunDirection[2],
      this.ambientIntensity,
      cameraPos[0], cameraPos[1], cameraPos[2],
      this.time
    ]);
    
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  computeGI(commandEncoder) {
  }

  getGpuTime() {
    return 0;
  }

  getBindGroup() {
    return this.bindGroup;
  }

  getPipeline() {
    return this.pipeline;
  }
}

export default SimpleGISystem;
