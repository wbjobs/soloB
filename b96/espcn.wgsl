@group(0) @binding(0) var<storage, read> inputImage: array<f32>;
@group(0) @binding(1) var<storage, read_write> outputImage: array<f32>;
@group(0) @binding(2) var<uniform> params: Uniforms;

struct Uniforms {
    inputWidth: u32,
    inputHeight: u32,
    scale: u32,
};

const K1: array<f32, 81> = array(
    0.0328, -0.0281, -0.0351,  0.0696,  0.0499,  0.0176, -0.0331, -0.0048,  0.0155,
    -0.0125, -0.0166,  0.0061,  0.0164,  0.0433,  0.0349, -0.0123, -0.0241, -0.0032,
    -0.0372, -0.0004,  0.0445,  0.0419, -0.0081, -0.0562, -0.0387,  0.0018,  0.0123,
    0.0466, -0.0097, -0.0973, -0.0341,  0.0748,  0.0569, -0.0607, -0.0390,  0.0300,
    0.0411, -0.0124, -0.0749,  0.0072,  0.1470,  0.0080, -0.0781, -0.0141,  0.0415,
    0.0043, -0.0405, -0.0363,  0.0736,  0.0771, -0.0348, -0.0980,  0.0089,  0.0471,
    -0.0020, -0.0007,  0.0460,  0.0408, -0.0063, -0.0567, -0.0394,  0.0055, -0.0365,
    -0.0147, -0.0265,  0.0012,  0.0135,  0.0426,  0.0354, -0.0137, -0.0174, -0.0117,
    0.0094, -0.0053, -0.0332,  0.0165,  0.0491,  0.0716, -0.0355, -0.0276,  0.0337
);

const K2: array<f32, 729> = array(
    0.0125, -0.0041, -0.0113,  0.0089,  0.0156,  0.0021, -0.0114, -0.0056,  0.0032,
    -0.0056, -0.0067,  0.0021,  0.0054,  0.0143,  0.0116, -0.0041, -0.0080, -0.0011,
    -0.0124, -0.0001,  0.0148,  0.0139, -0.0027, -0.0187, -0.0129,  0.0006,  0.0041,
    0.0155, -0.0032, -0.0324, -0.0113,  0.0249,  0.0189, -0.0202, -0.0130,  0.0100,
    0.0137, -0.0041, -0.0249,  0.0024,  0.0490,  0.0027, -0.0260, -0.0047,  0.0138,
    0.0014, -0.0135, -0.0121,  0.0245,  0.0257, -0.0116, -0.0326,  0.0030,  0.0157,
    -0.0007, -0.0002,  0.0153,  0.0136, -0.0021, -0.0189, -0.0131,  0.0018, -0.0122,
    -0.0049, -0.0088,  0.0004,  0.0045,  0.0142,  0.0118, -0.0046, -0.0058, -0.0039,
    0.0031, -0.0018, -0.0111,  0.0055,  0.0163,  0.0238, -0.0118, -0.0092,  0.0112,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
);

const K3: array<f32, 2304> = array();

fn getPixel(x: i32, y: i32, c: u32) -> f32 {
    let width = i32(params.inputWidth);
    let height = i32(params.inputHeight);
    
    let px = clamp(x, 0, width - 1);
    let py = clamp(y, 0, height - 1);
    
    let idx = (py * width + px) * 3 + i32(c);
    return inputImage[u32(idx)];
}

fn applyConv3x3(x: i32, y: i32, channel: u32) -> f32 {
    var sum = 0.0;
    let kStart = channel * 9;
    
    for (var ky: i32 = -1; ky <= 1; ky++) {
        for (var kx: i32 = -1; kx <= 1; kx++) {
            let kidx = u32((ky + 1) * 3 + (kx + 1));
            sum += getPixel(x + kx, y + ky, channel) * K1[kidx];
        }
    }
    
    return max(sum, 0.0);
}

fn applyConv9x9(x: i32, y: i32, inChannel: u32, outChannel: u32) -> f32 {
    var sum = 0.0;
    let kStart = outChannel * 81 + inChannel * 9;
    
    for (var ky: i32 = -4; ky <= 4; ky++) {
        for (var kx: i32 = -4; kx <= 4; kx++) {
            let kidx = u32(kStart + (ky + 4) * 9 + (kx + 4));
            sum += getPixel(x + kx, y + ky, inChannel) * K1[kidx];
        }
    }
    
    return max(sum, 0.0);
}

fn pixelShuffle(x: i32, y: i32, c: u32) -> f32 {
    let scale = i32(params.scale);
    let ix = x / scale;
    let iy = y / scale;
    let dx = x % scale;
    let dy = y % scale;
    
    let channelIdx = u32((dy * scale + dx) * 3 + c);
    return getPixel(ix, iy, channelIdx);
}

@compute @workgroup_size(16, 16)
fn superResolution(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let outWidth = params.inputWidth * params.scale;
    let outHeight = params.inputHeight * params.scale;
    
    let x = i32(global_id.x);
    let y = i32(global_id.y);
    
    if (u32(x) >= outWidth || u32(y) >= outHeight) {
        return;
    }
    
    let scale = i32(params.scale);
    let ix = x / scale;
    let iy = y / scale;
    let dx = x % scale;
    let dy = y % scale;
    
    for (var c: u32 = 0; c < 3; c++) {
        var sum: f32 = 0.0;
        
        for (var ky: i32 = -2; ky <= 2; ky++) {
            for (var kx: i32 = -2; kx <= 2; kx++) {
                let pixel = getPixel(ix + kx, iy + ky, c);
                
                let wx = 1.0 - abs(f32(kx + dx) / f32(scale));
                let wy = 1.0 - abs(f32(ky + dy) / f32(scale));
                
                sum += pixel * wx * wy;
            }
        }
        
        let outIdx = (y * i32(outWidth) + x) * 3 + i32(c);
        outputImage[u32(outIdx)] = clamp(sum, 0.0, 1.0);
    }
}

@compute @workgroup_size(16, 16)
fn bicubicUpscale(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let outWidth = params.inputWidth * params.scale;
    let outHeight = params.inputHeight * params.scale;
    
    let x = i32(global_id.x);
    let y = i32(global_id.y);
    
    if (u32(x) >= outWidth || u32(y) >= outHeight) {
        return;
    }
    
    let scale = f32(params.scale);
    let fx = f32(x) / scale;
    let fy = f32(y) / scale;
    
    let x0 = i32(floor(fx));
    let y0 = i32(floor(fy));
    
    let dx = fx - f32(x0);
    let dy = fy - f32(y0);
    
    for (var c: u32 = 0; c < 3; c++) {
        var col: array<f32, 4>;
        
        for (var i: i32 = 0; i < 4; i++) {
            var p: array<f32, 4>;
            for (var j: i32 = 0; j < 4; j++) {
                p[u32(j)] = getPixel(x0 + j - 1, y0 + i - 1, c);
            }
            col[u32(i)] = cubicInterp(p, dx);
        }
        
        let value = cubicInterp(col, dy);
        let outIdx = (y * i32(outWidth) + x) * 3 + i32(c);
        outputImage[u32(outIdx)] = clamp(value, 0.0, 1.0);
    }
}

fn cubicInterp(p: array<f32, 4>, x: f32) -> f32 {
    return p[1] + 0.5 * x * (p[2] - p[0] + x * (2.0 * p[0] - 5.0 * p[1] + 4.0 * p[2] - p[3] + 
           x * (3.0 * (p[1] - p[2]) + p[3] - p[0])));
}