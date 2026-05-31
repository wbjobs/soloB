import * as THREE from 'three';
import { fromArrayBuffer } from 'geotiff';
import * as ort from 'onnxruntime-web';

let device;
let inputBuffer;
let outputBuffer;
let uniformBuffer;
let bindGroup;
let pipeline;

let ortSession;
let webglCtx;

let originalImageData = null;
let superResImageData = null;
let imageWidth = 0;
let imageHeight = 0;
const SCALE = 4;

let scene, camera, renderer, terrainMesh;

let currentBackend = 'cpu';
let gpuCapabilities = {
    webgpu: false,
    webgl: false,
    webglVersion: null,
    vendor: null,
    renderer: null,
    isIntel: false
};

async function detectWebGPU() {
    if (!navigator.gpu) {
        return { available: false, error: 'WebGPU API not found', details: '浏览器不支持WebGPU' };
    }

    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            return { available: false, error: 'No GPU adapter found', details: '无法获取GPU适配器' };
        }

        const adapterInfo = await adapter.requestAdapterInfo();
        const vendor = adapterInfo.vendor || 'Unknown';
        const description = adapterInfo.description || adapterInfo.architecture || '';
        const isIntel = vendor.toLowerCase().includes('intel') || description.toLowerCase().includes('intel');

        const device = await adapter.requestDevice();
        device.destroy();

        return {
            available: true,
            vendor,
            description,
            isIntel,
            limits: adapter.limits
        };
    } catch (error) {
        return { available: false, error: error.message, details: 'WebGPU初始化失败' };
    }
}

function detectWebGL() {
    const canvas = document.createElement('canvas');
    
    let gl = null;
    let version = null;
    
    try {
        gl = canvas.getContext('webgl2');
        if (gl) version = 'WebGL 2.0';
    } catch (e) {}
    
    if (!gl) {
        try {
            gl = canvas.getContext('webgl');
            if (gl) version = 'WebGL 1.0';
        } catch (e) {}
    }

    if (!gl) {
        return { available: false, error: 'WebGL not supported' };
    }

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    
    const isIntel = vendor.toLowerCase().includes('intel') || renderer.toLowerCase().includes('intel');

    return {
        available: true,
        version,
        vendor,
        renderer,
        isIntel
    };
}

async function detectGPUCapabilities() {
    const content = document.getElementById('gpuInfoContent');
    const items = [];

    const webgpuResult = await detectWebGPU();
    gpuCapabilities.webgpu = webgpuResult.available;

    if (webgpuResult.available) {
        gpuCapabilities.vendor = webgpuResult.vendor;
        gpuCapabilities.isIntel = webgpuResult.isIntel;
        items.push(`
            <div class="gpu-info-item ${webgpuResult.isIntel ? 'warning' : 'success'}">
                <span class="gpu-label">WebGPU</span>
                <span class="gpu-value">支持 ${webgpuResult.isIntel ? '(Intel显卡注意兼容性)' : ''}</span>
            </div>
        `);
        items.push(`
            <div class="gpu-info-item">
                <span class="gpu-label">GPU厂商</span>
                <span class="gpu-value">${webgpuResult.vendor}</span>
            </div>
        `);
    } else {
        items.push(`
            <div class="gpu-info-item error">
                <span class="gpu-label">WebGPU</span>
                <span class="gpu-value">${webgpuResult.details}</span>
            </div>
        `);
    }

    const webglResult = detectWebGL();
    gpuCapabilities.webgl = webglResult.available;
    gpuCapabilities.webglVersion = webglResult.version;

    if (webglResult.available) {
        gpuCapabilities.renderer = webglResult.renderer;
        if (!gpuCapabilities.vendor) {
            gpuCapabilities.vendor = webglResult.vendor;
            gpuCapabilities.isIntel = webglResult.isIntel;
        }
        items.push(`
            <div class="gpu-info-item success">
                <span class="gpu-label">${webglResult.version}</span>
                <span class="gpu-value">支持</span>
            </div>
        `);
        items.push(`
            <div class="gpu-info-item">
                <span class="gpu-label">渲染器</span>
                <span class="gpu-value">${webglResult.renderer}</span>
            </div>
        `);
    } else {
        items.push(`
            <div class="gpu-info-item warning">
                <span class="gpu-label">WebGL</span>
                <span class="gpu-value">不支持</span>
            </div>
        `);
    }

    content.innerHTML = items.join('');
    updateBackendSelector();
}

function updateBackendSelector() {
    const panel = document.getElementById('renderBackendPanel');
    panel.style.display = 'block';

    const webgpuRadio = document.querySelector('input[value="webgpu"]');
    const webgpuStatus = document.getElementById('webgpuStatus');
    
    if (gpuCapabilities.webgpu) {
        webgpuRadio.disabled = gpuCapabilities.isIntel;
        webgpuStatus.textContent = gpuCapabilities.isIntel ? '可能不兼容' : '推荐';
        webgpuStatus.className = `backend-status ${gpuCapabilities.isIntel ? 'warning' : 'available'}`;
        if (!gpuCapabilities.isIntel) {
            webgpuRadio.checked = true;
            currentBackend = 'webgpu';
        }
    } else {
        webgpuRadio.disabled = true;
        webgpuStatus.textContent = '不支持';
        webgpuStatus.className = 'backend-status unavailable';
    }

    const webglRadio = document.querySelector('input[value="webgl"]');
    const webglStatus = document.getElementById('webglStatus');
    
    if (gpuCapabilities.webgl) {
        webglRadio.disabled = false;
        webglStatus.textContent = gpuCapabilities.webglVersion;
        webglStatus.className = 'backend-status available';
    } else {
        webglRadio.disabled = true;
        webglStatus.textContent = '不支持';
        webglStatus.className = 'backend-status unavailable';
    }

    const hint = document.getElementById('backendHint');
    if (gpuCapabilities.isIntel && gpuCapabilities.webgpu) {
        hint.textContent = '⚠️ 检测到Intel集成显卡，WebGPU可能存在兼容性问题。如遇失败请切换至CPU模式。';
    } else if (!gpuCapabilities.webgpu) {
        hint.textContent = '💡 浏览器不支持WebGPU，已自动切换至CPU兼容模式。处理速度可能较慢。';
    } else {
        hint.textContent = '✅ GPU加速可用，推荐使用WebGPU获得最佳性能。';
    }

    document.querySelectorAll('input[name="backend"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            currentBackend = e.target.value;
        });
    });
}

async function initWebGPU() {
    if (!gpuCapabilities.webgpu) {
        throw new Error('WebGPU not supported');
    }

    try {
        const adapter = await navigator.gpu.requestAdapter();
        device = await adapter.requestDevice();
        
        device.lost.then((info) => {
            console.warn('WebGPU device lost:', info.reason);
            if (currentBackend === 'webgpu') {
                currentBackend = 'cpu';
                document.querySelector('input[value="cpu"]').checked = true;
                document.getElementById('statusText').textContent = 'WebGPU连接丢失，已切换至CPU模式';
            }
        });

        return true;
    } catch (error) {
        console.error('WebGPU init failed:', error);
        return false;
    }
}

async function createComputePipeline() {
    const shaderCode = await fetch('espcn.wgsl').then(r => r.text());
    
    try {
        const shaderModule = device.createShaderModule({
            code: shaderCode
        });

        pipeline = device.createComputePipeline({
            layout: 'auto',
            compute: {
                module: shaderModule,
                entryPoint: 'bicubicUpscale'
            }
        });

        return true;
    } catch (error) {
        console.error('Shader compilation failed:', error);
        throw new Error(`Shader编译失败: ${error.message}`);
    }
}

function createBuffers(width, height) {
    const inputSize = width * height * 3 * 4;
    const outputSize = width * height * SCALE * SCALE * 3 * 4;

    inputBuffer = device.createBuffer({
        size: inputSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    outputBuffer = device.createBuffer({
        size: outputSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });

    uniformBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: inputBuffer } },
            { binding: 1, resource: { buffer: outputBuffer } },
            { binding: 2, resource: { buffer: uniformBuffer } }
        ]
    });
}

async function runWebGPUSuperResolution(imageData) {
    const startTime = performance.now();

    const width = imageData.width;
    const height = imageData.height;

    createBuffers(width, height);

    const pixels = new Float32Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
        pixels[i * 3] = imageData.data[i * 4] / 255;
        pixels[i * 3 + 1] = imageData.data[i * 4 + 1] / 255;
        pixels[i * 3 + 2] = imageData.data[i * 4 + 2] / 255;
    }

    device.queue.writeBuffer(inputBuffer, 0, pixels);

    const uniforms = new Uint32Array([width, height, SCALE, 0]);
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);

    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);

    const workgroupSizeX = Math.ceil((width * SCALE) / 16);
    const workgroupSizeY = Math.ceil((height * SCALE) / 16);
    passEncoder.dispatchWorkgroups(workgroupSizeX, workgroupSizeY);

    passEncoder.end();

    const readBuffer = device.createBuffer({
        size: width * height * SCALE * SCALE * 3 * 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    commandEncoder.copyBufferToBuffer(
        outputBuffer,
        0,
        readBuffer,
        0,
        width * height * SCALE * SCALE * 3 * 4
    );

    device.queue.submit([commandEncoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const resultData = new Float32Array(readBuffer.getMappedRange());

    const outWidth = width * SCALE;
    const outHeight = height * SCALE;
    const outputImageData = new ImageData(outWidth, outHeight);

    for (let i = 0; i < outWidth * outHeight; i++) {
        outputImageData.data[i * 4] = Math.round(Math.max(0, Math.min(255, resultData[i * 3] * 255)));
        outputImageData.data[i * 4 + 1] = Math.round(Math.max(0, Math.min(255, resultData[i * 3 + 1] * 255)));
        outputImageData.data[i * 4 + 2] = Math.round(Math.max(0, Math.min(255, resultData[i * 3 + 2] * 255)));
        outputImageData.data[i * 4 + 3] = 255;
    }

    readBuffer.unmap();
    readBuffer.destroy();
    inputBuffer.destroy();
    outputBuffer.destroy();
    uniformBuffer.destroy();

    const endTime = performance.now();
    console.log(`WebGPU Super-resolution took ${endTime - startTime}ms`);

    return outputImageData;
}

async function initONNXRuntime() {
    try {
        ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 4, 8);
        ort.env.wasm.simd = true;
        ort.env.wasm.proxy = false;
        
        return true;
    } catch (error) {
        console.error('ONNX Runtime init failed:', error);
        return false;
    }
}

function createBicubicKernel() {
    const kernel = new Float32Array(16);
    const a = -0.5;
    
    for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
            const dx = Math.abs((x - 1.5) / SCALE);
            const dy = Math.abs((y - 1.5) / SCALE);
            
            const wx = dx <= 1 ? 
                (a + 2) * dx * dx * dx - (a + 3) * dx * dx + 1 :
                dx < 2 ?
                a * dx * dx * dx - 5 * a * dx * dx + 8 * a * dx - 4 * a :
                0;
            
            const wy = dy <= 1 ? 
                (a + 2) * dy * dy * dy - (a + 3) * dy * dy + 1 :
                dy < 2 ?
                a * dy * dy * dy - 5 * a * dy * dy + 8 * a * dy - 4 * a :
                0;
            
            kernel[y * 4 + x] = wx * wy;
        }
    }
    
    const sum = kernel.reduce((a, b) => a + b, 0);
    return kernel.map(v => v / sum);
}

async function runCPUSuperResolution(imageData) {
    const startTime = performance.now();

    const width = imageData.width;
    const height = imageData.height;
    const outWidth = width * SCALE;
    const outHeight = height * SCALE;
    
    const outputImageData = new ImageData(outWidth, outHeight);
    const output = outputImageData.data;

    for (let c = 0; c < 3; c++) {
        for (let y = 0; y < outHeight; y++) {
            const inY = y / SCALE;
            const y0 = Math.floor(inY) - 1;
            const yd = inY - Math.floor(inY);
            
            for (let x = 0; x < outWidth; x++) {
                const inX = x / SCALE;
                const x0 = Math.floor(inX) - 1;
                const xd = inX - Math.floor(inX);
                
                let sum = 0;
                let weightSum = 0;
                
                for (let ky = 0; ky < 4; ky++) {
                    const py = Math.max(0, Math.min(height - 1, y0 + ky));
                    const wy = cubicWeight(yd + (1 - ky));
                    
                    for (let kx = 0; kx < 4; kx++) {
                        const px = Math.max(0, Math.min(width - 1, x0 + kx));
                        const wx = cubicWeight(xd + (1 - kx));
                        
                        const idx = (py * width + px) * 4 + c;
                        sum += imageData.data[idx] * wx * wy;
                        weightSum += wx * wy;
                    }
                }
                
                output[(y * outWidth + x) * 4 + c] = Math.round(Math.max(0, Math.min(255, sum / weightSum)));
            }
        }
    }
    
    for (let i = 0; i < outWidth * outHeight; i++) {
        output[i * 4 + 3] = 255;
    }

    const endTime = performance.now();
    console.log(`CPU Super-resolution took ${endTime - startTime}ms`);

    return outputImageData;
}

function cubicWeight(t) {
    const a = -0.5;
    t = Math.abs(t);
    
    if (t <= 1) {
        return (a + 2) * t * t * t - (a + 3) * t * t + 1;
    } else if (t < 2) {
        return a * t * t * t - 5 * a * t * t + 8 * a * t - 4 * a;
    }
    return 0;
}

function initWebGL() {
    const canvas = document.createElement('canvas');
    webglCtx = canvas.getContext('webgl2');
    
    if (!webglCtx) {
        return false;
    }

    const vertexShader = compileShader(webglCtx, webglCtx.VERTEX_SHADER, `
        attribute vec2 position;
        attribute vec2 texCoord;
        varying vec2 vTexCoord;
        void main() {
            vTexCoord = texCoord;
            gl_Position = vec4(position, 0.0, 1.0);
        }
    `);

    const fragmentShader = compileShader(webglCtx, webglCtx.FRAGMENT_SHADER, `
        precision highp float;
        uniform sampler2D uImage;
        uniform vec2 uInputSize;
        uniform float uScale;
        varying vec2 vTexCoord;
        
        float cubicWeight(float t) {
            t = abs(t);
            float a = -0.5;
            if (t <= 1.0) {
                return (a + 2.0) * t * t * t - (a + 3.0) * t * t + 1.0;
            } else if (t < 2.0) {
                return a * t * t * t - 5.0 * a * t * t + 8.0 * a * t - 4.0 * a;
            }
            return 0.0;
        }
        
        void main() {
            vec2 texCoord = vTexCoord / uScale;
            vec2 pixel = texCoord * uInputSize - 0.5;
            vec2 frac = fract(pixel);
            ivec2 base = ivec2(floor(pixel));
            
            vec3 sum = vec3(0.0);
            float weightSum = 0.0;
            
            for (int ky = 0; ky < 4; ky++) {
                float wy = cubicWeight(float(ky) - 1.0 - frac.y);
                int y = clamp(base.y + ky - 1, 0, int(uInputSize.y) - 1);
                
                for (int kx = 0; kx < 4; kx++) {
                    float wx = cubicWeight(float(kx) - 1.0 - frac.x);
                    int x = clamp(base.x + kx - 1, 0, int(uInputSize.x) - 1);
                    
                    vec2 sampleCoord = (vec2(x, y) + 0.5) / uInputSize;
                    vec3 color = texture2D(uImage, sampleCoord).rgb;
                    
                    sum += color * wx * wy;
                    weightSum += wx * wy;
                }
            }
            
            gl_FragColor = vec4(sum / weightSum, 1.0);
        }
    `);

    if (!vertexShader || !fragmentShader) {
        return false;
    }

    const program = webglCtx.createProgram();
    webglCtx.attachShader(program, vertexShader);
    webglCtx.attachShader(program, fragmentShader);
    webglCtx.linkProgram(program);

    if (!webglCtx.getProgramParameter(program, webglCtx.LINK_STATUS)) {
        console.error('WebGL program link failed:', webglCtx.getProgramInfoLog(program));
        return false;
    }

    webglCtx.useProgram(program);

    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const texCoords = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    const indices = new Uint16Array([0, 1, 2, 1, 3, 2]);

    const positionBuffer = webglCtx.createBuffer();
    webglCtx.bindBuffer(webglCtx.ARRAY_BUFFER, positionBuffer);
    webglCtx.bufferData(webglCtx.ARRAY_BUFFER, positions, webglCtx.STATIC_DRAW);
    const positionLoc = webglCtx.getAttribLocation(program, 'position');
    webglCtx.enableVertexAttribArray(positionLoc);
    webglCtx.vertexAttribPointer(positionLoc, 2, webglCtx.FLOAT, false, 0, 0);

    const texCoordBuffer = webglCtx.createBuffer();
    webglCtx.bindBuffer(webglCtx.ARRAY_BUFFER, texCoordBuffer);
    webglCtx.bufferData(webglCtx.ARRAY_BUFFER, texCoords, webglCtx.STATIC_DRAW);
    const texCoordLoc = webglCtx.getAttribLocation(program, 'texCoord');
    webglCtx.enableVertexAttribArray(texCoordLoc);
    webglCtx.vertexAttribPointer(texCoordLoc, 2, webglCtx.FLOAT, false, 0, 0);

    const indexBuffer = webglCtx.createBuffer();
    webglCtx.bindBuffer(webglCtx.ELEMENT_ARRAY_BUFFER, indexBuffer);
    webglCtx.bufferData(webglCtx.ELEMENT_ARRAY_BUFFER, indices, webglCtx.STATIC_DRAW);

    webglCtx.uInputSize = webglCtx.getUniformLocation(program, 'uInputSize');
    webglCtx.uScale = webglCtx.getUniformLocation(program, 'uScale');
    webglCtx.program = program;

    return true;
}

function compileShader(ctx, type, source) {
    const shader = ctx.createShader(type);
    ctx.shaderSource(shader, source);
    ctx.compileShader(shader);
    
    if (!ctx.getShaderParameter(shader, ctx.COMPILE_STATUS)) {
        console.error('Shader compile failed:', ctx.getShaderInfoLog(shader));
        ctx.deleteShader(shader);
        return null;
    }
    
    return shader;
}

async function runWebGLSuperResolution(imageData) {
    const startTime = performance.now();

    const width = imageData.width;
    const height = imageData.height;
    const outWidth = width * SCALE;
    const outHeight = height * SCALE;

    webglCtx.canvas.width = outWidth;
    webglCtx.canvas.height = outHeight;
    webglCtx.viewport(0, 0, outWidth, outHeight);

    const texture = webglCtx.createTexture();
    webglCtx.bindTexture(webglCtx.TEXTURE_2D, texture);
    webglCtx.texParameteri(webglCtx.TEXTURE_2D, webglCtx.TEXTURE_WRAP_S, webglCtx.CLAMP_TO_EDGE);
    webglCtx.texParameteri(webglCtx.TEXTURE_2D, webglCtx.TEXTURE_WRAP_T, webglCtx.CLAMP_TO_EDGE);
    webglCtx.texParameteri(webglCtx.TEXTURE_2D, webglCtx.TEXTURE_MIN_FILTER, webglCtx.LINEAR);
    webglCtx.texParameteri(webglCtx.TEXTURE_2D, webglCtx.TEXTURE_MAG_FILTER, webglCtx.LINEAR);
    webglCtx.texImage2D(webglCtx.TEXTURE_2D, 0, webglCtx.RGBA, webglCtx.RGBA, webglCtx.UNSIGNED_BYTE, imageData);

    webglCtx.uniform2f(webglCtx.uInputSize, width, height);
    webglCtx.uniform1f(webglCtx.uScale, SCALE);

    webglCtx.drawElements(webglCtx.TRIANGLES, 6, webglCtx.UNSIGNED_SHORT, 0);
    webglCtx.finish();

    const outputImageData = new ImageData(outWidth, outHeight);
    webglCtx.readPixels(0, 0, outWidth, outHeight, webglCtx.RGBA, webglCtx.UNSIGNED_BYTE, outputImageData.data);

    webglCtx.deleteTexture(texture);

    const endTime = performance.now();
    console.log(`WebGL Super-resolution took ${endTime - startTime}ms`);

    return outputImageData;
}

async function loadGeoTIFF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const tiff = await fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();

    const rasters = await image.readRasters();
    const width = image.getWidth();
    const height = image.getHeight();

    const imgData = new ImageData(width, height);
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (rasters.length >= 3) {
                imgData.data[idx * 4] = rasters[0][idx];
                imgData.data[idx * 4 + 1] = rasters[1][idx];
                imgData.data[idx * 4 + 2] = rasters[2][idx];
            } else {
                const val = rasters[0][idx];
                imgData.data[idx * 4] = val;
                imgData.data[idx * 4 + 1] = val;
                imgData.data[idx * 4 + 2] = val;
            }
            imgData.data[idx * 4 + 3] = 255;
        }
    }

    return {
        imageData: imgData,
        metadata: {
            width,
            height,
            bands: rasters.length,
            bbox: image.getBoundingBox(),
            crs: image.geoKeys?.ProjectedCSTypeGeoKey || 'Unknown'
        }
    };
}

function displayMetadata(metadata) {
    const container = document.getElementById('metadataContent');
    container.innerHTML = `
        <div class="metadata-item">
            <div class="metadata-label">宽度</div>
            <div class="metadata-value">${metadata.width} px</div>
        </div>
        <div class="metadata-item">
            <div class="metadata-label">高度</div>
            <div class="metadata-value">${metadata.height} px</div>
        </div>
        <div class="metadata-item">
            <div class="metadata-label">波段数</div>
            <div class="metadata-value">${metadata.bands}</div>
        </div>
        <div class="metadata-item">
            <div class="metadata-label">坐标系统</div>
            <div class="metadata-value">${metadata.crs}</div>
        </div>
        <div class="metadata-item">
            <div class="metadata-label">边界</div>
            <div class="metadata-value">${metadata.bbox?.map(n => n.toFixed(2)).join(', ') || 'N/A'}</div>
        </div>
        <div class="metadata-item">
            <div class="metadata-label">放大倍数</div>
            <div class="metadata-value">${SCALE}x (${metadata.width * SCALE} x ${metadata.height * SCALE})</div>
        </div>
    `;
}

function drawImageToCanvas(canvasId, imageData) {
    const canvas = document.getElementById(canvasId);
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
}

function createHeatmap() {
    const heatmapCanvas = document.getElementById('heatmapCanvas');
    const ctx = heatmapCanvas.getContext('2d');
    
    const outWidth = imageWidth * SCALE;
    const outHeight = imageHeight * SCALE;
    heatmapCanvas.width = outWidth;
    heatmapCanvas.height = outHeight;

    const heatmapData = ctx.createImageData(outWidth, outHeight);

    const downscaledSuper = downscaleImage(superResImageData, 1/SCALE);

    for (let y = 0; y < imageHeight; y++) {
        for (let x = 0; x < imageWidth; x++) {
            const idx = y * imageWidth + x;
            
            let diff = 0;
            for (let c = 0; c < 3; c++) {
                diff += Math.abs(originalImageData.data[idx * 4 + c] - downscaledSuper.data[idx * 4 + c]);
            }
            diff /= 3;

            const normalizedDiff = diff / 255;
            const [r, g, b] = getHeatmapColor(normalizedDiff);

            for (let dy = 0; dy < SCALE; dy++) {
                for (let dx = 0; dx < SCALE; dx++) {
                    const outIdx = ((y * SCALE + dy) * outWidth + (x * SCALE + dx)) * 4;
                    heatmapData.data[outIdx] = r;
                    heatmapData.data[outIdx + 1] = g;
                    heatmapData.data[outIdx + 2] = b;
                    heatmapData.data[outIdx + 3] = 255;
                }
            }
        }
    }

    ctx.putImageData(heatmapData, 0, 0);
}

function getHeatmapColor(value) {
    if (value < 0.25) {
        return [0, 0, Math.floor(255 * (value / 0.25))];
    } else if (value < 0.5) {
        return [0, Math.floor(255 * ((value - 0.25) / 0.25)), 255];
    } else if (value < 0.75) {
        return [Math.floor(255 * ((value - 0.5) / 0.25)), 255, 255 - Math.floor(255 * ((value - 0.5) / 0.25))];
    } else {
        return [255, 255 - Math.floor(255 * ((value - 0.75) / 0.25)), 0];
    }
}

function downscaleImage(imageData, scale) {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);

    const outWidth = Math.floor(imageData.width * scale);
    const outHeight = Math.floor(imageData.height * scale);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outWidth;
    outCanvas.height = outHeight;
    const outCtx = outCanvas.getContext('2d');
    outCtx.drawImage(canvas, 0, 0, outWidth, outHeight);

    return outCtx.getImageData(0, 0, outWidth, outHeight);
}

function updateCompareView(sliderValue) {
    const compareCanvas = document.getElementById('compareCanvas');
    const ctx = compareCanvas.getContext('2d');

    const outWidth = imageWidth * SCALE;
    const outHeight = imageHeight * SCALE;
    compareCanvas.width = outWidth;
    compareCanvas.height = outHeight;

    const splitX = Math.floor((sliderValue / 100) * outWidth);

    const originalScaled = scaleImage(originalImageData, SCALE);
    ctx.putImageData(originalScaled, 0, 0, 0, 0, splitX, outHeight);
    ctx.putImageData(superResImageData, splitX, 0, splitX, 0, outWidth - splitX, outHeight);

    ctx.beginPath();
    ctx.moveTo(splitX, 0);
    ctx.lineTo(splitX, outHeight);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function scaleImage(imageData, scale) {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = imageData.width * scale;
    outCanvas.height = imageData.height * scale;
    const outCtx = outCanvas.getContext('2d');
    outCtx.imageSmoothingEnabled = false;
    outCtx.drawImage(canvas, 0, 0, outCanvas.width, outCanvas.height);

    return outCtx.getImageData(0, 0, outCanvas.width, outCanvas.height);
}

function initTerrain() {
    const container = document.getElementById('terrainCanvas');
    
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(50, 50, 50);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    scene.add(directionalLight);

    const animate = () => {
        requestAnimationFrame(animate);
        if (terrainMesh) {
            terrainMesh.rotation.y += 0.002;
        }
        renderer.render(scene, camera);
    };
    animate();
}

function createTerrainFromImage() {
    if (!originalImageData) return;

    if (terrainMesh) {
        scene.remove(terrainMesh);
    }

    const width = 100;
    const height = 100;
    const geometry = new THREE.PlaneGeometry(width, height, imageWidth - 1, imageHeight - 1);

    const vertices = geometry.attributes.position.array;
    
    for (let y = 0; y < imageHeight; y++) {
        for (let x = 0; x < imageWidth; x++) {
            const idx = y * imageWidth + x;
            const heightVal = (originalImageData.data[idx * 4] + 
                              originalImageData.data[idx * 4 + 1] + 
                              originalImageData.data[idx * 4 + 2]) / 3 / 255 * 20;
            vertices[idx * 3 + 2] = heightVal;
        }
    }

    geometry.computeVertexNormals();

    const canvas = document.createElement('canvas');
    canvas.width = imageWidth;
    canvas.height = imageHeight;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(originalImageData, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshStandardMaterial({
        map: texture,
        side: THREE.DoubleSide,
        wireframe: false
    });

    terrainMesh = new THREE.Mesh(geometry, material);
    terrainMesh.rotation.x = -Math.PI / 2;
    scene.add(terrainMesh);
}

function showView(viewName) {
    document.getElementById('sliderContainer').style.display = 'none';
    document.getElementById('heatmapContainer').style.display = 'none';
    document.getElementById('terrainContainer').style.display = 'none';

    switch (viewName) {
        case 'compare':
            document.getElementById('sliderContainer').style.display = 'block';
            updateCompareView(document.getElementById('compareSlider').value);
            break;
        case 'heatmap':
            document.getElementById('heatmapContainer').style.display = 'block';
            createHeatmap();
            break;
        case 'terrain':
            document.getElementById('terrainContainer').style.display = 'block';
            createTerrainFromImage();
            break;
    }
}

async function processImage(imageData) {
    const statusText = document.getElementById('statusText');
    const perfStats = document.getElementById('perfStats');
    
    try {
        let result;
        const startTime = performance.now();
        
        switch (currentBackend) {
            case 'webgpu':
                statusText.textContent = '正在使用WebGPU处理...';
                result = await runWebGPUSuperResolution(imageData);
                break;
            case 'webgl':
                statusText.textContent = '正在使用WebGL处理...';
                result = await runWebGLSuperResolution(imageData);
                break;
            case 'cpu':
            default:
                statusText.textContent = '正在使用CPU处理 (可能较慢)...';
                result = await runCPUSuperResolution(imageData);
                break;
        }
        
        const totalTime = performance.now() - startTime;
        
        perfStats.textContent = 
            `${currentBackend.toUpperCase()} | ${imageWidth}x${imageHeight} → ${imageWidth * SCALE}x${imageHeight * SCALE} | ${totalTime.toFixed(1)}ms`;
        
        return result;
        
    } catch (error) {
        console.error('Processing failed:', error);
        
        if (currentBackend === 'webgpu' && !gpuCapabilities.isIntel) {
            statusText.textContent = 'WebGPU处理失败，尝试WebGL模式...';
            currentBackend = 'webgl';
            document.querySelector('input[value="webgl"]').checked = true;
            return processImage(imageData);
        } else if (currentBackend === 'webgpu' || currentBackend === 'webgl') {
            statusText.textContent = 'GPU处理失败，切换至CPU兼容模式...';
            currentBackend = 'cpu';
            document.querySelector('input[value="cpu"]').checked = true;
            return processImage(imageData);
        }
        
        throw error;
    }
}

let temporalSequence = [];
let temporalSuperResResults = [];
let changeDetectionFrames = [];
let isPlaying = false;
let animationInterval = null;
let currentFrameIndex = 0;

async function addToTemporalSequence(file) {
    const statusText = document.getElementById('statusText');
    statusText.textContent = `正在加载: ${file.name}...`;
    
    try {
        const { imageData, metadata } = await loadGeoTIFF(file);
        
        const timestamp = file.lastModified || Date.now();
        const date = new Date(timestamp);
        
        const item = {
            id: Date.now() + Math.random(),
            name: file.name,
            date: date,
            dateStr: date.toLocaleDateString('zh-CN'),
            imageData: imageData,
            metadata: metadata,
            processed: false,
            superResData: null
        };
        
        temporalSequence.push(item);
        updateSequenceList();
        updateTemporalButtons();
        
        statusText.textContent = `已添加: ${file.name} (共${temporalSequence.length}帧)`;
        
    } catch (error) {
        console.error('Failed to load temporal image:', error);
        statusText.textContent = `加载失败: ${error.message}`;
    }
}

function updateSequenceList() {
    const container = document.getElementById('sequenceList');
    
    if (temporalSequence.length === 0) {
        container.innerHTML = '<div class="empty-hint">尚未添加时序图像，请上传同一地区不同时间的卫星图像</div>';
        return;
    }
    
    temporalSequence.sort((a, b) => a.date - b.date);
    
    container.innerHTML = temporalSequence.map((item, index) => `
        <div class="sequence-item ${item.processed ? 'processed' : ''}" data-id="${item.id}">
            <div class="sequence-thumb">
                <canvas id="thumb-${item.id}" width="60" height="60"></canvas>
            </div>
            <div class="sequence-info">
                <div class="sequence-name">${item.name}</div>
                <div class="sequence-meta">
                    ${item.dateStr} | ${item.imageData.width}×${item.imageData.height} | 
                    ${item.processed ? '已处理' : '待处理'}
                </div>
            </div>
            <div class="sequence-actions">
                <button onclick="removeFromSequence('${item.id}')" style="padding:4px 8px; font-size:12px;">删除</button>
                <button onclick="moveInSequence(${index}, -1)" ${index === 0 ? 'disabled' : ''} style="padding:4px 8px; font-size:12px;">↑</button>
                <button onclick="moveInSequence(${index}, 1)" ${index === temporalSequence.length - 1 ? 'disabled' : ''} style="padding:4px 8px; font-size:12px;">↓</button>
            </div>
        </div>
    `).join('');
    
    temporalSequence.forEach(item => {
        const canvas = document.getElementById(`thumb-${item.id}`);
        if (canvas) {
            const ctx = canvas.getContext('2d');
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = item.imageData.width;
            tempCanvas.height = item.imageData.height;
            tempCanvas.getContext('2d').putImageData(item.imageData, 0, 0);
            ctx.drawImage(tempCanvas, 0, 0, 60, 60);
        }
    });
}

function removeFromSequence(id) {
    temporalSequence = temporalSequence.filter(item => item.id != id);
    updateSequenceList();
    updateTemporalButtons();
}

function moveInSequence(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= temporalSequence.length) return;
    
    [temporalSequence[index], temporalSequence[newIndex]] = [temporalSequence[newIndex], temporalSequence[index]];
    updateSequenceList();
}

function updateTemporalButtons() {
    const processBtn = document.getElementById('processTemporalBtn');
    const detectBtn = document.getElementById('detectChangesBtn');
    
    processBtn.disabled = temporalSequence.length < 2;
    detectBtn.disabled = temporalSuperResResults.length < 2;
}

async function processTemporalSuperRes() {
    if (temporalSequence.length < 2) return;
    
    const statusText = document.getElementById('statusText');
    const useAttention = document.getElementById('useAttentionFusion').checked;
    const enableDenoise = document.getElementById('enableDenoise').checked;
    const fusionStrength = parseInt(document.getElementById('fusionStrength').value) / 100;
    
    statusText.textContent = `开始时序超分处理... (共${temporalSequence.length}帧)`;
    temporalSuperResResults = [];
    
    try {
        for (let i = 0; i < temporalSequence.length; i++) {
            const item = temporalSequence[i];
            statusText.textContent = `处理第 ${i + 1}/${temporalSequence.length} 帧...`;
            
            item.superResData = await processImage(item.imageData);
            item.processed = true;
            
            temporalSuperResResults.push({
                ...item,
                index: i
            });
        }
        
        if (useAttention && temporalSuperResResults.length >= 2) {
            statusText.textContent = '执行时序注意力融合...';
            await applyTemporalAttentionFusion(fusionStrength, enableDenoise);
        }
        
        updateSequenceList();
        updateTemporalButtons();
        
        document.getElementById('animationPanel').style.display = 'block';
        statusText.textContent = `时序超分完成！共处理 ${temporalSuperResResults.length} 帧`;
        
    } catch (error) {
        console.error('Temporal super-res failed:', error);
        statusText.textContent = `处理失败: ${error.message}`;
    }
}

async function applyTemporalAttentionFusion(strength, denoise) {
    const reference = temporalSuperResResults[0].superResData;
    const width = reference.width;
    const height = reference.height;
    
    for (let frameIdx = 0; frameIdx < temporalSuperResResults.length; frameIdx++) {
        const current = temporalSuperResResults[frameIdx].superResData;
        
        if (frameIdx > 0) {
            const previous = temporalSuperResResults[frameIdx - 1].superResData;
            applyTemporalSmoothing(current, previous, strength * 0.3);
        }
        
        if (denoise) {
            applyTemporalDenoise(current, temporalSuperResResults.slice(Math.max(0, frameIdx - 2), frameIdx + 1).map(f => f.superResData));
        }
    }
}

function applyTemporalSmoothing(current, previous, alpha) {
    for (let i = 0; i < current.data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
            current.data[i + c] = current.data[i + c] * (1 - alpha) + previous.data[i + c] * alpha;
        }
    }
}

function applyTemporalDenoise(current, frames) {
    if (frames.length < 2) return;
    
    const width = current.width;
    const height = current.height;
    const kernel = 3;
    
    for (let y = kernel; y < height - kernel; y++) {
        for (let x = kernel; x < width - kernel; x++) {
            for (let c = 0; c < 3; c++) {
                let values = [];
                
                frames.forEach(frame => {
                    for (let ky = -kernel; ky <= kernel; ky++) {
                        for (let kx = -kernel; kx <= kernel; kx++) {
                            const idx = ((y + ky) * width + (x + kx)) * 4 + c;
                            values.push(frame.data[idx]);
                        }
                    }
                });
                
                values.sort((a, b) => a - b);
                const median = values[Math.floor(values.length / 2)];
                
                const currentIdx = (y * width + x) * 4 + c;
                current.data[currentIdx] = current.data[currentIdx] * 0.7 + median * 0.3;
            }
        }
    }
}

async function detectChanges() {
    if (temporalSuperResResults.length < 2) return;
    
    const statusText = document.getElementById('statusText');
    statusText.textContent = '正在检测时序变化...';
    
    try {
        changeDetectionFrames = [];
        
        for (let i = 0; i < temporalSuperResResults.length; i++) {
            const current = temporalSuperResResults[i].superResData;
            
            if (i === 0) {
                changeDetectionFrames.push({
                    image: current,
                    date: temporalSuperResResults[i].dateStr,
                    changes: null,
                    type: 'original'
                });
            }
            
            if (i < temporalSuperResResults.length - 1) {
                const next = temporalSuperResResults[i + 1].superResData;
                const changeMap = computeChangeMap(current, next);
                
                changeDetectionFrames.push({
                    image: changeMap.visualization,
                    date: `${temporalSuperResResults[i].dateStr} → ${temporalSuperResResults[i + 1].dateStr}`,
                    changes: changeMap.stats,
                    type: 'change'
                });
            }
        }
        
        updateChangeStats();
        initAnimationPlayer();
        
        statusText.textContent = `变化检测完成！生成 ${changeDetectionFrames.length} 帧`;
        
    } catch (error) {
        console.error('Change detection failed:', error);
        statusText.textContent = `变化检测失败: ${error.message}`;
    }
}

function computeChangeMap(frame1, frame2) {
    const width = frame1.width;
    const height = frame1.height;
    const visualization = new ImageData(width, height);
    
    let totalChange = 0;
    let maxChange = 0;
    let changePixels = 0;
    
    for (let i = 0; i < frame1.data.length; i += 4) {
        let diff = 0;
        for (let c = 0; c < 3; c++) {
            diff += Math.abs(frame1.data[i + c] - frame2.data[i + c]);
        }
        diff /= 3;
        
        totalChange += diff;
        if (diff > 30) changePixels++;
        maxChange = Math.max(maxChange, diff);
        
        const normalizedDiff = Math.min(255, diff * 3);
        let r, g, b;
        
        if (normalizedDiff < 50) {
            r = 0; g = Math.floor(normalizedDiff * 2); b = 255 - Math.floor(normalizedDiff * 2);
        } else if (normalizedDiff < 150) {
            const t = (normalizedDiff - 50) / 100;
            r = 0; g = Math.floor(100 + 155 * t); b = Math.floor(255 * (1 - t));
        } else {
            const t = (normalizedDiff - 150) / 105;
            r = Math.floor(255 * t); g = Math.floor(255 * (1 - t)); b = 0;
        }
        
        visualization.data[i] = r;
        visualization.data[i + 1] = g;
        visualization.data[i + 2] = b;
        visualization.data[i + 3] = 255;
    }
    
    for (let i = 0; i < frame1.data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
            visualization.data[i + c] = Math.floor(
                frame1.data[i + c] * 0.3 + visualization.data[i + c] * 0.7
            );
        }
    }
    
    return {
        visualization,
        stats: {
            totalChange,
            maxChange,
            changeRatio: changePixels / (width * height),
            avgChange: totalChange / (width * height)
        }
    };
}

function updateChangeStats() {
    const changeFrames = changeDetectionFrames.filter(f => f.type === 'change');
    
    if (changeFrames.length === 0) return;
    
    const totalChangeSum = changeFrames.reduce((sum, f) => sum + f.changes.totalChange, 0);
    const maxChangeOverall = Math.max(...changeFrames.map(f => f.changes.maxChange));
    const avgChangeOverall = changeFrames.reduce((sum, f) => sum + f.changes.avgChange, 0) / changeFrames.length;
    
    document.getElementById('totalChange').textContent = 
        `${(changeFrames[0].changes.changeRatio * 100).toFixed(1)}%`;
    document.getElementById('maxChange').textContent = 
        `${maxChangeOverall.toFixed(0)}`;
    document.getElementById('avgChange').textContent = 
        `${avgChangeOverall.toFixed(1)}`;
}

function initAnimationPlayer() {
    if (changeDetectionFrames.length === 0) return;
    
    currentFrameIndex = 0;
    updateAnimationFrame();
    
    const slider = document.getElementById('timelineSlider');
    slider.max = changeDetectionFrames.length - 1;
    slider.value = 0;
}

function updateAnimationFrame() {
    if (changeDetectionFrames.length === 0) return;
    
    const frame = changeDetectionFrames[currentFrameIndex];
    const canvas = document.getElementById('animationCanvas');
    canvas.width = frame.image.width;
    canvas.height = frame.image.height;
    
    const ctx = canvas.getContext('2d');
    ctx.putImageData(frame.image, 0, 0);
    
    document.getElementById('frameLabel').textContent = 
        `帧 ${currentFrameIndex + 1}/${changeDetectionFrames.length}`;
    document.getElementById('dateLabel').textContent = frame.date;
    
    document.getElementById('timelineSlider').value = currentFrameIndex;
}

function playAnimation() {
    if (isPlaying) return;
    
    isPlaying = true;
    document.getElementById('playBtn').style.display = 'none';
    document.getElementById('pauseBtn').style.display = 'inline-block';
    
    const speed = parseInt(document.getElementById('speedSelect').value);
    
    animationInterval = setInterval(() => {
        currentFrameIndex = (currentFrameIndex + 1) % changeDetectionFrames.length;
        updateAnimationFrame();
    }, speed);
}

function pauseAnimation() {
    isPlaying = false;
    document.getElementById('playBtn').style.display = 'inline-block';
    document.getElementById('pauseBtn').style.display = 'none';
    
    if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = null;
    }
}

function exportAsGif() {
    alert('GIF导出功能需要gif.js库支持。已生成帧数据，可通过开发者工具保存画布。');
    
    const canvas = document.getElementById('animationCanvas');
    const link = document.createElement('a');
    link.download = `change-detection-frame-${currentFrameIndex}.png`;
    link.href = canvas.toDataURL();
    link.click();
}

function exportAsVideo() {
    alert('视频导出功能需要MediaRecorder支持。已生成帧数据，可通过开发者工具保存。');
    
    const canvas = document.getElementById('animationCanvas');
    const link = document.createElement('a');
    link.download = `change-detection-frame-${currentFrameIndex}.png`;
    link.href = canvas.toDataURL();
    link.click();
}

async function main() {
    const statusText = document.getElementById('statusText');
    
    try {
        statusText.textContent = '正在检测GPU能力...';
        await detectGPUCapabilities();
        
        const initPromises = [];
        
        if (gpuCapabilities.webgpu) {
            initPromises.push(
                initWebGPU()
                    .then(success => success && createComputePipeline())
                    .catch(e => {
                        console.warn('WebGPU init failed, will fallback:', e);
                        return false;
                    })
            );
        }
        
        if (gpuCapabilities.webgl) {
            initPromises.push(
                Promise.resolve().then(() => initWebGL())
            );
        }
        
        initPromises.push(initONNXRuntime());
        
        await Promise.all(initPromises);
        
        if (gpuCapabilities.webgpu && currentBackend === 'webgpu') {
            statusText.textContent = '就绪 - WebGPU加速模式';
        } else if (gpuCapabilities.webgl && currentBackend === 'webgl') {
            statusText.textContent = '就绪 - WebGL模式';
        } else {
            statusText.textContent = '就绪 - CPU兼容模式';
        }
        
        initTerrain();

        let selectedFile = null;

        document.getElementById('fileInput').addEventListener('change', (e) => {
            selectedFile = e.target.files[0];
            document.getElementById('loadBtn').disabled = !selectedFile;
            if (selectedFile) {
                statusText.textContent = `已选择: ${selectedFile.name}`;
            }
        });

        document.getElementById('loadBtn').addEventListener('click', async () => {
            if (!selectedFile) return;

            try {
                statusText.textContent = '正在加载GeoTIFF...';
                document.getElementById('loadBtn').disabled = true;

                const { imageData, metadata } = await loadGeoTIFF(selectedFile);
                originalImageData = imageData;
                imageWidth = imageData.width;
                imageHeight = imageData.height;

                displayMetadata(metadata);
                drawImageToCanvas('originalCanvas', imageData);

                superResImageData = await processImage(imageData);
                drawImageToCanvas('superresCanvas', superResImageData);

                statusText.textContent = '处理完成！';
                document.getElementById('loadBtn').disabled = false;

            } catch (error) {
                console.error(error);
                statusText.textContent = `错误: ${error.message}`;
                document.getElementById('loadBtn').disabled = false;
            }
        });

        document.getElementById('compareBtn').addEventListener('click', () => showView('compare'));
        document.getElementById('heatmapBtn').addEventListener('click', () => showView('heatmap'));
        document.getElementById('terrainBtn').addEventListener('click', () => showView('terrain'));

        document.getElementById('compareSlider').addEventListener('input', (e) => {
            updateCompareView(e.target.value);
        });

        document.getElementById('temporalBtn').addEventListener('click', () => {
            const panel = document.getElementById('temporalPanel');
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        });

        document.getElementById('addTemporalBtn').addEventListener('click', () => {
            const fileInput = document.getElementById('temporalFileInput');
            const files = fileInput.files;
            for (let i = 0; i < files.length; i++) {
                addToTemporalSequence(files[i]);
            }
            fileInput.value = '';
        });

        document.getElementById('processTemporalBtn').addEventListener('click', processTemporalSuperRes);
        document.getElementById('detectChangesBtn').addEventListener('click', detectChanges);

        document.getElementById('clearSequenceBtn').addEventListener('click', () => {
            temporalSequence = [];
            temporalSuperResResults = [];
            changeDetectionFrames = [];
            updateSequenceList();
            updateTemporalButtons();
            document.getElementById('animationPanel').style.display = 'none';
            statusText.textContent = '序列已清空';
        });

        document.getElementById('fusionStrength').addEventListener('input', (e) => {
            document.getElementById('fusionValue').textContent = e.target.value + '%';
        });

        document.getElementById('prevFrameBtn').addEventListener('click', () => {
            if (changeDetectionFrames.length === 0) return;
            currentFrameIndex = (currentFrameIndex - 1 + changeDetectionFrames.length) % changeDetectionFrames.length;
            updateAnimationFrame();
        });

        document.getElementById('nextFrameBtn').addEventListener('click', () => {
            if (changeDetectionFrames.length === 0) return;
            currentFrameIndex = (currentFrameIndex + 1) % changeDetectionFrames.length;
            updateAnimationFrame();
        });

        document.getElementById('playBtn').addEventListener('click', playAnimation);
        document.getElementById('pauseBtn').addEventListener('click', pauseAnimation);

        document.getElementById('speedSelect').addEventListener('change', () => {
            if (isPlaying) {
                pauseAnimation();
                playAnimation();
            }
        });

        document.getElementById('timelineSlider').addEventListener('input', (e) => {
            currentFrameIndex = parseInt(e.target.value);
            updateAnimationFrame();
        });

        document.getElementById('exportGifBtn').addEventListener('click', exportAsGif);
        document.getElementById('exportVideoBtn').addEventListener('click', exportAsVideo);

        window.removeFromSequence = removeFromSequence;
        window.moveInSequence = moveInSequence;

        window.addEventListener('resize', () => {
            const container = document.getElementById('terrainCanvas');
            if (container && camera && renderer) {
                camera.aspect = container.clientWidth / container.clientHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(container.clientWidth, container.clientHeight);
            }
        });

    } catch (error) {
        console.error('Initialization error:', error);
        statusText.textContent = `初始化错误: ${error.message}`;
    }
}

main();