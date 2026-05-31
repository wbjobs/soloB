import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';

const defaultVertexShader = `#version 300 es
precision highp float;

in vec3 position;
in vec2 uv;

out vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

const defaultFragmentShader = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform float iTime;
uniform vec2 iResolution;
uniform vec4 iMouse;

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;
    vec3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3(0.0, 2.0, 4.0));
    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(fragColor, gl_FragCoord.xy);
}
`;

const errorFragmentShader = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform float iTime;
uniform vec2 iResolution;

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    
    vec3 bg = mix(
        vec3(0.15, 0.08, 0.08),
        vec3(0.25, 0.0, 0.0),
        uv.y
    );
    
    vec3 lines = bg;
    float line = sin(uv.y * 80.0 + iTime * 5.0);
    if (line > 0.98) {
        lines = vec3(1.0, 0.2, 0.2);
    }
    
    vec3 border = bg;
    if (uv.x < 0.02 || uv.x > 0.98 || uv.y < 0.02 || uv.y > 0.98) {
        border = vec3(0.8, 0.2, 0.2);
    }
    
    fragColor = vec4(mix(mix(bg, lines, 0.3), border, 1.0), 1.0);
}
`;

function parseShaderErrors(errorLog, sourceCode, isVertexShader = false) {
  const errors = [];
  const lines = errorLog.split('\n');
  
  const lineNumberPatterns = [
    /ERROR:\s*(\d+):(\d+):\s*(.*)/i,
    /ERROR:\s*(\d+):(\d+)\s*(.*)/i,
    /line\s+(\d+).*error:\s*(.*)/i,
    /line\s+(\d+):\s*(.*)/i,
    /(\d+):(\d+):\s*(.*)/,
    /^(\d+):\s*(.*)/,
  ];

  for (const line of lines) {
    if (!line.trim()) continue;
    
    for (const pattern of lineNumberPatterns) {
      const match = line.match(pattern);
      if (match) {
        let lineNum = parseInt(match[1]);
        let column = match[2] ? parseInt(match[2]) : 0;
        let message = match[3] || match[2] || line;
        
        if (isNaN(lineNum) && match[2]) {
          lineNum = parseInt(match[2]);
          message = match[1] || line;
        }
        
        if (lineNum > 0 && !isNaN(lineNum)) {
          if (!isVertexShader) {
            const codeLines = sourceCode.split('\n');
            const hasMainImage = sourceCode.includes('mainImage');
            const hasInVuv = sourceCode.includes('in vec2 vUv');
            
            let offset = 0;
            if (!hasInVuv) offset += 1;
            if (hasMainImage && !sourceCode.includes('void main() {')) offset += 4;
          }
          
          errors.push({
            line: Math.max(1, lineNum),
            column: column || 1,
            message: message.trim(),
            raw: line,
            severity: 'error',
            isVertex: isVertexShader,
          });
        }
        break;
      }
    }
  }

  if (errors.length === 0 && errorLog.trim()) {
    errors.push({
      line: 1,
      column: 1,
      message: errorLog.trim(),
      raw: errorLog,
      severity: 'error',
      isVertex: isVertexShader,
    });
  }

  return errors;
}

function ShaderPreview({ code, onErrors }) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const materialRef = useRef(null);
  const uniformsRef = useRef(null);
  const animationFrameRef = useRef(null);
  const mouseRef = useRef({ x: 0, y: 0, isDown: false });
  const startTimeRef = useRef(Date.now());
  const lastCodeRef = useRef('');
  
  const [error, setError] = useState(null);

  const processShader = useCallback((shaderCode) => {
    let processed = shaderCode;
    
    if (!processed.includes('void main() {')) {
      if (processed.includes('void mainImage')) {
        processed += `

void main() {
    mainImage(fragColor, gl_FragCoord.xy);
}`;
      }
    }
    
    if (!processed.includes('in vec2 vUv;')) {
      const lines = processed.split('\n');
      let insertIndex = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('#version') || 
            lines[i].trim().startsWith('precision')) {
          insertIndex = i + 1;
        }
      }
      lines.splice(insertIndex, 0, 'in vec2 vUv;');
      processed = lines.join('\n');
    }
    
    return processed;
  }, []);

  const tryCompileShader = useCallback((renderer, shaderCode) => {
    const processedCode = processShader(shaderCode);
    
    let fragmentErrors = [];
    let vertexErrors = [];
    let captured = false;
    
    try {
      const uniforms = {
        iTime: { value: 0 },
        iResolution: { value: new THREE.Vector2() },
        iMouse: { value: new THREE.Vector4() },
        iDate: { value: new THREE.Vector4() },
      };
      uniformsRef.current = uniforms;

      const material = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: defaultVertexShader,
        fragmentShader: processedCode,
        glslVersion: THREE.GLSL3,
        onShaderError: (gl, program, vertexShader, fragmentShader) => {
          captured = true;
          const fragmentLog = gl.getShaderInfoLog(fragmentShader);
          const vertexLog = gl.getShaderInfoLog(vertexShader);
          
          if (fragmentLog && fragmentLog.length > 0) {
            fragmentErrors = parseShaderErrors(fragmentLog, shaderCode, false);
          }
          if (vertexLog && vertexLog.length > 0) {
            vertexErrors = parseShaderErrors(vertexLog, defaultVertexShader, true);
          }
        }
      });
      
      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const geometry = new THREE.PlaneGeometry(2, 2);
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      
      renderer.render(scene, camera);
      
      geometry.dispose();
      material.dispose();
      
      const allErrors = [...fragmentErrors, ...vertexErrors];
      
      if (captured && allErrors.length > 0) {
        return { 
          success: false, 
          errors: allErrors,
          rawError: fragmentErrors.map(e => e.raw).join('\n') + 
                   (vertexErrors.length > 0 ? '\n\nVertex Shader:\n' + vertexErrors.map(e => e.raw).join('\n') : '')
        };
      }
      
      return { success: true, material, uniforms, errors: [] };
    } catch (err) {
      const allErrors = [...fragmentErrors, ...vertexErrors];
      
      if (allErrors.length > 0) {
        return { 
          success: false, 
          errors: allErrors,
          rawError: fragmentErrors.map(e => e.raw).join('\n')
        };
      }
      
      return { 
        success: false, 
        errors: [{
          line: 1,
          column: 1,
          message: err.message,
          raw: err.message,
          severity: 'error',
          isVertex: false,
        }],
        rawError: err.message
      };
    }
  }, [processShader]);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    rendererRef.current = renderer;
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    renderer.domElement.className = 'shader-canvas';

    const result = tryCompileShader(renderer, code || defaultFragmentShader);
    
    let material;
    if (result.success) {
      material = result.material;
      setError(null);
      if (onErrors) onErrors([]);
    } else {
      setError(result.rawError);
      if (onErrors) onErrors(result.errors);
      
      const errorResult = tryCompileShader(renderer, errorFragmentShader);
      material = errorResult.success ? errorResult.material : null;
    }
    
    materialRef.current = material;

    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    startTimeRef.current = Date.now();
    lastCodeRef.current = code || defaultFragmentShader;

    const handleResize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      
      if (rendererRef.current) {
        rendererRef.current.setSize(w, h);
      }
      
      if (uniformsRef.current && uniformsRef.current.iResolution) {
        uniformsRef.current.iResolution.value.set(w, h);
      }
    };

    const handleMouseMove = (e) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = rect.height - (e.clientY - rect.top);
      
      if (uniformsRef.current && uniformsRef.current.iMouse) {
        const mouse = uniformsRef.current.iMouse.value;
        mouse.x = mouseRef.current.x;
        mouse.y = mouseRef.current.y;
        if (mouseRef.current.isDown) {
          mouse.z = mouseRef.current.x;
          mouse.w = mouseRef.current.y;
        }
      }
    };

    const handleMouseDown = () => {
      mouseRef.current.isDown = true;
      if (uniformsRef.current && uniformsRef.current.iMouse) {
        const mouse = uniformsRef.current.iMouse.value;
        mouse.z = mouseRef.current.x;
        mouse.w = mouseRef.current.y;
      }
    };

    const handleMouseUp = () => {
      mouseRef.current.isDown = false;
    };

    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('mouseleave', handleMouseUp);
    window.addEventListener('resize', handleResize);

    if (uniformsRef.current && uniformsRef.current.iResolution) {
      uniformsRef.current.iResolution.value.set(width, height);
    }

    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);

      if (uniformsRef.current && uniformsRef.current.iTime) {
        uniformsRef.current.iTime.value = (Date.now() - startTimeRef.current) / 1000;
      }

      if (uniformsRef.current && uniformsRef.current.iDate) {
        const now = new Date();
        uniformsRef.current.iDate.value.set(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
        );
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };

    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('mouseleave', handleMouseUp);

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      if (geometry) geometry.dispose();
      if (material) material.dispose();
      if (rendererRef.current) {
        rendererRef.current.dispose();
        if (rendererRef.current.domElement && container.contains(rendererRef.current.domElement)) {
          container.removeChild(rendererRef.current.domElement);
        }
      }
    };
  }, []);

  useEffect(() => {
    if (!code || !rendererRef.current || !sceneRef.current) return;
    
    if (code === lastCodeRef.current) return;
    lastCodeRef.current = code;

    const result = tryCompileShader(rendererRef.current, code);
    
    if (result.success) {
      const mesh = sceneRef.current.children[0];
      if (mesh && mesh.material) {
        const oldMaterial = mesh.material;
        mesh.material = result.material;
        if (oldMaterial) {
          oldMaterial.dispose();
        }
      }
      setError(null);
      if (onErrors) onErrors([]);
    } else {
      setError(result.rawError);
      if (onErrors) onErrors(result.errors);
      
      const errorResult = tryCompileShader(rendererRef.current, errorFragmentShader);
      if (errorResult.success) {
        const mesh = sceneRef.current.children[0];
        if (mesh && mesh.material) {
          const oldMaterial = mesh.material;
          mesh.material = errorResult.material;
          if (oldMaterial) {
            oldMaterial.dispose();
          }
        }
      }
    }
  }, [code, tryCompileShader, onErrors]);

  return (
    <div className="preview-container" ref={containerRef}>
      {error && (
        <div className="error-panel">
          <h3>Shader Compilation Error</h3>
          <pre>{error}</pre>
        </div>
      )}
    </div>
  );
}

export default ShaderPreview;
