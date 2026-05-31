struct CameraUniforms {
    viewProjectionMatrix: mat4x4f,
    inverseViewMatrix: mat4x4f,
    cameraPosition: vec4f,
};

struct LightUniforms {
    lightDirection: vec4f,
    lightColor: vec4f,
    ambientLight: vec4f,
    atomScale: f32,
    padding0: f32,
    padding1: f32,
    padding2: f32,
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<uniform> light: LightUniforms;

@group(1) @binding(0) var<storage, read> positions: array<vec3f>;
@group(1) @binding(1) var<storage, read> instanceData: array<vec4f>;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) centerWS: vec3f,
    @location(2) radius: f32,
    @location(3) color: vec3f,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
    var out: VertexOutput;
    
    let centerWS = positions[instanceIndex];
    let data = instanceData[instanceIndex];
    let radius = data.w * light.atomScale;
    
    let quadVertices = array<vec2f, 6>(
        vec2f(-1.0, -1.0),
        vec2f( 1.0, -1.0),
        vec2f(-1.0,  1.0),
        vec2f( 1.0, -1.0),
        vec2f( 1.0,  1.0),
        vec2f(-1.0,  1.0),
    );
    
    let localPos = quadVertices[vertexIndex];
    out.uv = localPos;
    
    let invView = camera.inverseViewMatrix;
    
    let right = vec3f(invView[0].x, invView[1].x, invView[2].x);
    let up = vec3f(invView[0].y, invView[1].y, invView[2].y);
    
    let billboardPos = centerWS + (right * localPos.x + up * localPos.y) * radius;
    out.position = camera.viewProjectionMatrix * vec4f(billboardPos, 1.0);
    
    out.centerWS = centerWS;
    out.radius = radius;
    out.color = data.rgb;
    
    return out;
}

@fragment
fn fs_main(@location(0) uv: vec2f,
           @location(1) centerWS: vec3f,
           @location(2) radius: f32,
           @location(3) color: vec3f) -> @location(0) vec4f {
    let distSq = dot(uv, uv);
    if (distSq > 1.0) {
        discard;
    }
    
    let z = sqrt(1.0 - distSq);
    let normal = normalize(vec3f(uv, z));
    
    let viewDir = normalize(camera.cameraPosition.xyz - centerWS);
    let lightDir = normalize(-light.lightDirection.xyz);
    
    let halfVec = normalize(lightDir + viewDir);
    
    let ambient = light.ambientLight.rgb * color;
    
    let nDotL = max(dot(normal, lightDir), 0.0);
    let diffuse = light.lightColor.rgb * color * nDotL;
    
    let nDotH = max(dot(normal, halfVec), 0.0);
    let specular = light.lightColor.rgb * pow(nDotH, 64.0) * 0.4;
    
    let finalColor = ambient + diffuse + specular;
    
    return vec4f(finalColor, 1.0);
}
