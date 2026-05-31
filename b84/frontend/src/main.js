import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const LITHOLOGY_COLORS = {
  '花岗岩': 0x8B4513,
  '片麻岩': 0x696969,
  '石英岩': 0xFFFAF0,
  '大理岩': 0xFFFFFF,
  '矽卡岩': 0x228B22,
  '矿体': 0xFFD700,
  '未知': 0x808080
};

const LOD_DISTANCES = [100, 200, 400, 800];
const CHUNK_SIZE = 200;

class ChunkManager {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.loadingChunks = new Set();
    this.loadQueue = [];
    this.maxConcurrentLoads = 4;
  }

  getChunkKey(chunkIndex) {
    return `${chunkIndex[0]},${chunkIndex[1]}`;
  }

  addChunk(chunkData, stratIndex, color) {
    const key = this.getChunkKey(chunkData.chunk_index);
    if (this.chunks.has(key)) return;

    const lod = new THREE.LOD();
    
    if (chunkData.isEmpty || !chunkData.vertices || chunkData.vertices.length === 0) {
      return;
    }

    const baseGeometry = this.createGeometry(chunkData.vertices, chunkData.faces);
    const baseMaterial = new THREE.MeshPhongMaterial({ 
      color, 
      transparent: true, 
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    const baseMesh = new THREE.Mesh(baseGeometry, baseMaterial);
    lod.addLevel(baseMesh, 0);

    for (let i = 1; i < LOD_DISTANCES.length; i++) {
      const simplifiedVerts = this.simplifyVertices(chunkData.vertices, 2 ** i);
      const simplifiedFaces = this.simplifyFaces(chunkData.faces, simplifiedVerts.length);
      if (simplifiedFaces.length > 0) {
        const simplifiedGeom = this.createGeometry(simplifiedVerts, simplifiedFaces);
        const simplifiedMesh = new THREE.Mesh(simplifiedGeom, baseMaterial);
        lod.addLevel(simplifiedMesh, LOD_DISTANCES[i - 1]);
      }
    }

    if (chunkData.bounds && chunkData.bounds.center) {
      lod.position.set(0, 0, 0);
      lod.userData = {
        chunkIndex: chunkData.chunk_index,
        bounds: chunkData.bounds,
        stratIndex,
        vertexCount: chunkData.vertices.length
      };
    }

    this.scene.add(lod);
    this.chunks.set(key, { lod, stratIndex, bounds: chunkData.bounds });
  }

  createGeometry(vertices, faces) {
    const geometry = new THREE.BufferGeometry();
    const vertArray = new Float32Array(vertices.length * 3);
    vertices.forEach((v, i) => {
      vertArray[i * 3] = v[0];
      vertArray[i * 3 + 1] = v[2];
      vertArray[i * 3 + 2] = v[1];
    });
    geometry.setAttribute('position', new THREE.BufferAttribute(vertArray, 3));

    if (faces && faces.length > 0) {
      const indexArray = new Uint32Array(faces.length * 3);
      faces.forEach((f, i) => {
        indexArray[i * 3] = f[0];
        indexArray[i * 3 + 1] = f[1];
        indexArray[i * 3 + 2] = f[2];
      });
      geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
    }

    geometry.computeVertexNormals();
    return geometry;
  }

  simplifyVertices(vertices, factor) {
    if (factor <= 1) return vertices;
    return vertices.filter((_, i) => i % factor === 0);
  }

  simplifyFaces(faces, newVertexCount) {
    return faces.filter(f => f[0] < newVertexCount && f[1] < newVertexCount && f[2] < newVertexCount);
  }

  removeChunk(chunkIndex) {
    const key = this.getChunkKey(chunkIndex);
    const chunk = this.chunks.get(key);
    if (chunk) {
      this.scene.remove(chunk.lod);
      chunk.lod.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      this.chunks.delete(key);
    }
  }

  updateLOD(camera) {
    this.chunks.forEach((chunk) => {
      chunk.lod.update(camera);
    });
  }

  cullChunks(frustum) {
    const toRemove = [];
    this.chunks.forEach((chunk, key) => {
      if (chunk.bounds) {
        const center = new THREE.Vector3(
          (chunk.bounds.min_x + chunk.bounds.max_x) / 2,
          100,
          (chunk.bounds.min_y + chunk.bounds.max_y) / 2
        );
        const radius = Math.sqrt(
          Math.pow((chunk.bounds.max_x - chunk.bounds.min_x) / 2, 2) +
          Math.pow((chunk.bounds.max_y - chunk.bounds.min_y) / 2, 2)
        );
        const sphere = new THREE.Sphere(center, radius);
        if (!frustum.intersectsSphere(sphere)) {
          toRemove.push(chunk.bounds.chunk_index || chunk.lod.userData.chunkIndex);
        }
      }
    });
    return toRemove;
  }

  clearAll() {
    this.chunks.forEach((chunk) => {
      this.scene.remove(chunk.lod);
      chunk.lod.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    });
    this.chunks.clear();
  }

  getMemoryUsage() {
    let totalVertices = 0;
    let totalTriangles = 0;
    this.chunks.forEach((chunk) => {
      chunk.lod.levels.forEach((level, levelIndex) => {
        if (level.object.geometry) {
          const vertexCount = level.object.geometry.attributes.position.count;
          const triangleCount = level.object.geometry.index ? level.object.geometry.index.count / 3 : vertexCount / 3;
          if (levelIndex === chunk.lod.getCurrentLevel()) {
            totalVertices += vertexCount;
            totalTriangles += triangleCount;
          }
        }
      });
    });
    return { vertices: totalVertices, triangles: totalTriangles };
  }
}

class BoreholeManager {
  constructor(scene) {
    this.scene = scene;
    this.boreholes = [];
    this.boreholeMeshes = new Map();
    this.renderDistance = 500;
  }

  setBoreholes(boreholes) {
    this.boreholes = boreholes;
  }

  renderVisibleBoreholes(cameraPosition) {
    const toRemove = [];
    
    this.boreholeMeshes.forEach((group, id) => {
      const distance = cameraPosition.distanceTo(group.position);
      if (distance > this.renderDistance) {
        toRemove.push(id);
      }
    });

    toRemove.forEach(id => this.removeBorehole(id));

    this.boreholes.forEach(bh => {
      if (!this.boreholeMeshes.has(bh.id)) {
        const bhPos = new THREE.Vector3(bh.x, 0, bh.y);
        if (cameraPosition.distanceTo(bhPos) <= this.renderDistance) {
          this.createBoreholeMesh(bh);
        }
      }
    });
  }

  createBoreholeMesh(bh) {
    const group = new THREE.Group();
    
    let prevElev = bh.surface_elevation;
    bh.layers.forEach((layer) => {
      const height = prevElev - layer.elevation;
      if (height > 0) {
        const geometry = new THREE.CylinderGeometry(2, 2, height, 8);
        const color = LITHOLOGY_COLORS[layer.lithology] || 0x888888;
        const material = new THREE.MeshPhongMaterial({ color, transparent: true, opacity: 0.9 });
        const cylinder = new THREE.Mesh(geometry, material);
        cylinder.position.set(0, layer.elevation + height / 2, 0);
        cylinder.rotation.x = Math.PI / 2;
        group.add(cylinder);
      }
      prevElev = layer.elevation;
    });

    const labelGeom = new THREE.SphereGeometry(3);
    const labelMat = new THREE.MeshPhongMaterial({ color: 0xe94560 });
    const label = new THREE.Mesh(labelGeom, labelMat);
    label.position.set(0, bh.surface_elevation + 10, 0);
    group.add(label);

    group.position.set(bh.x, 0, bh.y);
    group.userData = { boreholeId: bh.id };
    
    this.scene.add(group);
    this.boreholeMeshes.set(bh.id, group);
  }

  removeBorehole(id) {
    const group = this.boreholeMeshes.get(id);
    if (group) {
      this.scene.remove(group);
      group.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      this.boreholeMeshes.delete(id);
    }
  }

  clearAll() {
    this.boreholeMeshes.forEach((group, id) => {
      this.scene.remove(group);
      group.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    });
    this.boreholeMeshes.clear();
  }
}

class PerformanceMonitor {
  constructor() {
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.fps = 0;
    this.callbacks = [];
  }

  update() {
    this.frameCount++;
    const currentTime = performance.now();
    if (currentTime - this.lastTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastTime = currentTime;
      this.callbacks.forEach(cb => cb(this.fps));
    }
  }

  onFPSUpdate(callback) {
    this.callbacks.push(callback);
  }
}

class GeologicalModeler {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.boreholes = [];
    this.surfaces = [];
    this.chunkManagers = new Map();
    this.boreholeManager = null;
    this.performanceMonitor = new PerformanceMonitor();
    this.frustum = new THREE.Frustum();
    this.projScreenMatrix = new THREE.Matrix4();
    this.isStreaming = false;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.drillMarkers = [];
    this.groundPlane = null;
    
    this.initScene();
    this.setupEventListeners();
    this.animate();
  }

  initScene() {
    const canvas = document.getElementById('threeCanvas');
    
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);
    
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      10000
    );
    this.camera.position.set(300, 400, 300);
    
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth - 320, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    
    this.boreholeManager = new BoreholeManager(this.scene);
    
    this.addLights();
    this.addGrid();
    this.addAxes();
    
    this.setupPerformanceMonitoring();
    
    window.addEventListener('resize', () => this.onResize());
  }

  addLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(100, 200, 100);
    this.scene.add(directionalLight);
    
    const pointLight = new THREE.PointLight(0x4cc9f0, 0.5, 500);
    pointLight.position.set(0, 100, 0);
    this.scene.add(pointLight);
  }

  addGrid() {
    const gridHelper = new THREE.GridHelper(1000, 100, 0x0f3460, 0x1a4a7a);
    gridHelper.position.y = 50;
    this.scene.add(gridHelper);
    
    const planeGeometry = new THREE.PlaneGeometry(1000, 1000);
    const planeMaterial = new THREE.MeshBasicMaterial({ 
      visible: false,
      transparent: true,
      opacity: 0 
    });
    this.groundPlane = new THREE.Mesh(planeGeometry, planeMaterial);
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.groundPlane.position.y = 50;
    this.scene.add(this.groundPlane);
  }

  addAxes() {
    const axesHelper = new THREE.AxesHelper(100);
    this.scene.add(axesHelper);
  }

  setupPerformanceMonitoring() {
    this.performanceMonitor.onFPSUpdate((fps) => {
      const fpsElement = document.getElementById('fpsCounter');
      if (fpsElement) {
        fpsElement.textContent = `FPS: ${fps}`;
        fpsElement.style.color = fps < 30 ? '#e94560' : '#228b22';
      }
    });
  }

  async loadSampleBoreholes() {
    try {
      const count = parseInt(document.getElementById('boreholeCount').value) || 50;
      const response = await fetch(`/api/sample-boreholes?count=${count}`);
      this.boreholes = await response.json();
      this.boreholeManager.setBoreholes(this.boreholes);
      this.updateBoreholeList();
      this.updateMemoryStats();
    } catch (error) {
      console.error('加载钻孔数据失败:', error);
    }
  }

  updateBoreholeList() {
    const listEl = document.getElementById('boreholeList');
    listEl.innerHTML = '';
    
    const summary = document.createElement('div');
    summary.className = 'borehole-summary';
    summary.textContent = `已加载 ${this.boreholes.length} 个钻孔`;
    listEl.appendChild(summary);
  }

  async generateSurface() {
    if (this.boreholes.length < 3) {
      alert('至少需要3个钻孔数据');
      return;
    }

    const method = document.getElementById('interpolationMethod').value;
    const stratIndex = parseInt(document.getElementById('stratIndex').value);
    const gridSize = parseFloat(document.getElementById('gridSize').value);
    const useStreaming = document.getElementById('enableStreaming').checked;

    if (useStreaming) {
      await this.generateSurfaceStreaming(method, stratIndex, gridSize);
    } else {
      await this.generateSurfaceChunks(method, stratIndex, gridSize);
    }
  }

  async generateSurfaceChunks(method, stratIndex, gridSize) {
    try {
      const xCoords = this.boreholes.map(bh => bh.x);
      const yCoords = this.boreholes.map(bh => bh.y);
      const minX = Math.min(...xCoords) - 50;
      const maxX = Math.max(...xCoords) + 50;
      const minY = Math.min(...yCoords) - 50;
      const maxY = Math.max(...yCoords) + 50;

      const numChunksX = Math.ceil((maxX - minX) / CHUNK_SIZE);
      const numChunksY = Math.ceil((maxY - minY) / CHUNK_SIZE);
      const totalChunks = numChunksX * numChunksY;

      const colors = [0x4cc9f0, 0xe94560, 0xffd700, 0x228b22, 0x8b4513];
      const color = colors[stratIndex % colors.length];

      if (!this.chunkManagers.has(stratIndex)) {
        this.chunkManagers.set(stratIndex, new ChunkManager(this.scene));
      }
      const chunkManager = this.chunkManagers.get(stratIndex);

      let loadedChunks = 0;
      const progressEl = document.getElementById('loadingProgress');

      for (let i = 0; i < numChunksX; i++) {
        for (let j = 0; j < numChunksY; j++) {
          const response = await fetch('/api/chunk/interpolate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              boreholes: this.boreholes,
              stratigraphic_index: stratIndex,
              method,
              grid_size: gridSize,
              chunk_index: [i, j],
              chunk_size: CHUNK_SIZE,
              lod_level: 0
            })
          });

          const chunkData = await response.json();
          chunkManager.addChunk(chunkData, stratIndex, color);

          loadedChunks++;
          const progress = Math.round((loadedChunks / totalChunks) * 100);
          if (progressEl) {
            progressEl.style.width = `${progress}%`;
            progressEl.textContent = `${progress}%`;
          }
          
          this.updateMemoryStats();
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

    } catch (error) {
      console.error('生成地层曲面失败:', error);
    }
  }

  async generateSurfaceStreaming(method, stratIndex, gridSize) {
    try {
      const colors = [0x4cc9f0, 0xe94560, 0xffd700, 0x228b22, 0x8b4513];
      const color = colors[stratIndex % colors.length];

      if (!this.chunkManagers.has(stratIndex)) {
        this.chunkManagers.set(stratIndex, new ChunkManager(this.scene));
      }
      const chunkManager = this.chunkManagers.get(stratIndex);

      const progressEl = document.getElementById('loadingProgress');

      const response = await fetch('/api/stream/interpolate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boreholes: this.boreholes,
          stratigraphic_index: stratIndex,
          method,
          grid_size: gridSize
        })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.trim()) {
            try {
              const data = JSON.parse(line);
              if (data.type === 'chunk') {
                chunkManager.addChunk(data, stratIndex, color);
                const progress = Math.round(data.progress * 100);
                if (progressEl) {
                  progressEl.style.width = `${progress}%`;
                  progressEl.textContent = `${progress}%`;
                }
                this.updateMemoryStats();
              }
            } catch (e) {
              console.error('解析流数据失败:', e);
            }
          }
        }
      }

    } catch (error) {
      console.error('流式生成地层曲面失败:', error);
    }
  }

  async generateSection() {
    if (this.boreholes.length < 1) {
      alert('请先加载钻孔数据');
      return;
    }

    const startX = parseFloat(document.getElementById('sectionStartX').value);
    const startY = parseFloat(document.getElementById('sectionStartY').value);
    const endX = parseFloat(document.getElementById('sectionEndX').value);
    const endY = parseFloat(document.getElementById('sectionEndY').value);

    try {
      const response = await fetch('/api/section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boreholes: this.boreholes,
          start_point: [startX, startY],
          end_point: [endX, endY],
          width: 20
        })
      });

      const data = await response.json();
      this.renderSection(data);
      document.getElementById('sectionOverlay').classList.remove('hidden');
    } catch (error) {
      console.error('生成剖面失败:', error);
    }
  }

  renderSection(data) {
    const canvas = document.getElementById('sectionCanvas');
    const ctx = canvas.getContext('2d');
    
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    ctx.scale(dpr, dpr);
    
    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;
    const padding = 40;
    
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    
    if (!data.boreholes || data.boreholes.length === 0) {
      ctx.fillStyle = '#333';
      ctx.font = '14px sans-serif';
      ctx.fillText('该剖面线上无钻孔数据', width / 2 - 60, height / 2);
      return;
    }
    
    const allElevations = data.boreholes.flatMap(bh => [
      bh.surface_elevation,
      ...bh.layers.map(l => l.elevation)
    ]);
    const minElev = Math.min(...allElevations) - 20;
    const maxElev = Math.max(...allElevations) + 20;
    const elevRange = maxElev - minElev;
    
    const xScale = (width - 2 * padding) / data.length;
    const yScale = (height - 2 * padding) / elevRange;
    
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = padding + (yScale * elevRange * i / 5);
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
      
      const elev = maxElev - (elevRange * i / 5);
      ctx.fillStyle = '#666';
      ctx.font = '10px sans-serif';
      ctx.fillText(elev.toFixed(0) + 'm', 5, y + 3);
    }
    
    ctx.fillStyle = '#333';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`地质剖面 (长度: ${data.length.toFixed(1)}m)`, width / 2, 20);
    
    data.boreholes.forEach(bh => {
      const x = padding + bh.distance * xScale / data.length * (width - 2 * padding);
      
      let prevY = padding + (maxElev - bh.surface_elevation) * yScale;
      ctx.fillStyle = '#e94560';
      ctx.beginPath();
      ctx.arc(x, prevY, 4, 0, Math.PI * 2);
      ctx.fill();
      
      bh.layers.forEach(layer => {
        const y = padding + (maxElev - layer.elevation) * yScale;
        
        const color = LITHOLOGY_COLORS[layer.lithology];
        ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
        ctx.fillRect(x - 10, prevY, 20, y - prevY);
        
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 10, prevY, 20, y - prevY);
        
        prevY = y;
      });
      
      ctx.fillStyle = '#333';
      ctx.font = '10px sans-serif';
      ctx.fillText(bh.borehole_id, x, height - padding + 15);
    });
    
    const legendY = 30;
    let legendX = width - padding - 100;
    Object.entries(LITHOLOGY_COLORS).forEach(([name, color]) => {
      ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
      ctx.fillRect(legendX, legendY, 15, 15);
      ctx.fillStyle = '#333';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(name, legendX + 20, legendY + 12);
      legendY += 20;
    });
  }

  async calculateVolume() {
    if (this.chunkManagers.size === 0) {
      alert('请先生成至少一个地层曲面');
      return;
    }

    alert('体积计算功能需要合并所有分块网格，对于大数据集建议在后端进行计算');
  }

  async exportGLTF() {
    try {
      const exporter = new GLTFExporter();
      
      exporter.parse(
        this.scene,
        (gltf) => {
          const blob = new Blob([JSON.stringify(gltf)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'geological_model.gltf';
          a.click();
          URL.revokeObjectURL(url);
        },
        { binary: false }
      );
    } catch (error) {
      console.error('导出失败:', error);
    }
  }

  resetView() {
    this.camera.position.set(300, 400, 300);
    this.controls.target.set(200, 100, 200);
    this.controls.update();
  }

  toggleWireframe() {
    this.chunkManagers.forEach((manager) => {
      manager.chunks.forEach((chunk) => {
        chunk.lod.levels.forEach((level) => {
          if (level.object.material) {
            level.object.material.wireframe = !level.object.material.wireframe;
          }
        });
      });
    });
  }

  clearAll() {
    this.chunkManagers.forEach((manager) => manager.clearAll());
    this.chunkManagers.clear();
    this.boreholeManager.clearAll();
    this.boreholes = [];
    this.updateBoreholeList();
    this.updateMemoryStats();
  }

  updateFrustum() {
    this.camera.updateMatrixWorld();
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.projScreenMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);
  }

  updateMemoryStats() {
    let totalVerts = 0;
    let totalTris = 0;
    this.chunkManagers.forEach((manager) => {
      const usage = manager.getMemoryUsage();
      totalVerts += usage.vertices;
      totalTris += usage.triangles;
    });

    const vertsEl = document.getElementById('vertexCount');
    const trisEl = document.getElementById('triangleCount');
    const chunksEl = document.getElementById('chunkCount');

    if (vertsEl) vertsEl.textContent = `顶点: ${totalVerts.toLocaleString()}`;
    if (trisEl) trisEl.textContent = `三角形: ${totalTris.toLocaleString()}`;
    if (chunksEl) {
      let chunkCount = 0;
      this.chunkManagers.forEach(m => chunkCount += m.chunks.size);
      chunksEl.textContent = `分块: ${chunkCount}`;
    }
  }

  async handleDrillClick(event) {
    if (this.boreholes.length === 0) {
      console.log('请先加载钻孔数据');
      return;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersects = this.raycaster.intersectObject(this.groundPlane);
    
    if (intersects.length > 0) {
      const point = intersects[0].point;
      await this.performVirtualDrill(point.x, point.z);
    }
  }

  async performVirtualDrill(x, y) {
    try {
      const method = document.getElementById('drillMethod').value;

      const response = await fetch('/api/virtual-drill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boreholes: this.boreholes,
          point_x: x,
          point_y: y,
          method: method
        })
      });

      const result = await response.json();
      this.addDrillMarker(x, y, result.surface_elevation);
      this.displayDrillResult(result);
    } catch (error) {
      console.error('虚拟钻探失败:', error);
      alert('虚拟钻探失败，请检查控制台');
    }
  }

  addDrillMarker(x, y, elevation) {
    const group = new THREE.Group();

    const baseGeometry = new THREE.CylinderGeometry(2, 5, 5, 8);
    const baseMaterial = new THREE.MeshPhongMaterial({ color: 0xe94560 });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.position.y = elevation;
    group.add(base);

    const poleGeometry = new THREE.CylinderGeometry(0.5, 0.5, 30, 8);
    const poleMaterial = new THREE.MeshPhongMaterial({ color: 0xffd700 });
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.position.y = elevation + 17.5;
    group.add(pole);

    const flagGeometry = new THREE.PlaneGeometry(8, 5);
    const flagMaterial = new THREE.MeshPhongMaterial({ 
      color: 0xe94560, 
      side: THREE.DoubleSide 
    });
    const flag = new THREE.Mesh(flagGeometry, flagMaterial);
    flag.position.set(4, elevation + 30, 0);
    group.add(flag);

    const sphereGeo = new THREE.SphereGeometry(1.5, 16, 16);
    const sphereMat = new THREE.MeshPhongMaterial({ color: 0x4cc9f0, emissive: 0x1a4a7a });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.position.set(0, elevation + 32, 0);
    group.add(sphere);

    group.position.set(x, 0, y);
    this.scene.add(group);
    this.drillMarkers.push(group);
  }

  displayDrillResult(result) {
    const overlay = document.getElementById('drillOverlay');
    overlay.classList.remove('hidden');

    document.getElementById('drillCoords').textContent = 
      `(${result.point_x.toFixed(1)}, ${result.point_y.toFixed(1)})`;
    document.getElementById('drillElevation').textContent = 
      `${result.surface_elevation.toFixed(2)} m`;
    document.getElementById('drillNearest').textContent = 
      result.nearest_borehole_id;
    document.getElementById('drillDistance').textContent = 
      `${result.nearest_borehole_distance.toFixed(2)} m`;

    const confValue = result.overall_confidence.toFixed(1);
    document.getElementById('confidenceBar').style.width = `${confValue}%`;
    document.getElementById('confidenceValue').textContent = `${confValue}%`;

    const columnContainer = document.getElementById('lithologyColumn');
    columnContainer.innerHTML = '';

    result.stratigraphy.forEach((layer) => {
      const layerEl = document.createElement('div');
      layerEl.className = 'lithology-layer';
      
      const colorHex = LITHOLOGY_COLORS[layer.lithology] || 0x888888;
      const colorStr = '#' + colorHex.toString(16).padStart(6, '0');
      
      layerEl.style.background = `linear-gradient(135deg, ${colorStr}, ${this.shadeColor(colorStr, -20)})`;
      
      layerEl.innerHTML = `
        <div class="lithology-color" style="background: ${colorStr}"></div>
        <div class="lithology-name">${layer.lithology}</div>
        <div class="lithology-depth">${layer.depth_from.toFixed(1)} - ${layer.depth_to.toFixed(1)}m</div>
        <div class="lithology-conf">${layer.confidence.toFixed(0)}%</div>
      `;
      
      columnContainer.appendChild(layerEl);
    });
  }

  shadeColor(color, percent) {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return '#' + (0x1000000 + 
      (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 + 
      (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 + 
      (B < 255 ? B < 1 ? 0 : B : 255)
    ).toString(16).slice(1);
  }

  clearDrillMarkers() {
    this.drillMarkers.forEach(marker => {
      this.scene.remove(marker);
      marker.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    });
    this.drillMarkers = [];
    document.getElementById('drillOverlay').classList.add('hidden');
  }

  clearAll() {
    this.clearDrillMarkers();
    this.chunkManagers.forEach((manager) => manager.clearAll());
    this.chunkManagers.clear();
    this.boreholeManager.clearAll();
    this.boreholes = [];
    this.updateBoreholeList();
    this.updateMemoryStats();
  }

  setupEventListeners() {
    document.getElementById('loadSampleBtn').addEventListener('click', () => this.loadSampleBoreholes());
    document.getElementById('generateSurfaceBtn').addEventListener('click', () => this.generateSurface());
    document.getElementById('generateSectionBtn').addEventListener('click', () => this.generateSection());
    document.getElementById('calculateVolumeBtn').addEventListener('click', () => this.calculateVolume());
    document.getElementById('exportGLTFBtn').addEventListener('click', () => this.exportGLTF());
    document.getElementById('resetViewBtn').addEventListener('click', () => this.resetView());
    document.getElementById('toggleWireframeBtn').addEventListener('click', () => this.toggleWireframe());
    document.getElementById('clearAllBtn').addEventListener('click', () => this.clearAll());
    document.getElementById('closeSectionBtn').addEventListener('click', () => {
      document.getElementById('sectionOverlay').classList.add('hidden');
    });
    document.getElementById('clearDrillMarkersBtn').addEventListener('click', () => this.clearDrillMarkers());
    document.getElementById('closeDrillBtn').addEventListener('click', () => {
      document.getElementById('drillOverlay').classList.add('hidden');
    });

    this.renderer.domElement.addEventListener('click', (e) => {
      if (!e.ctrlKey && !e.shiftKey) {
        this.handleDrillClick(e);
      }
    });
  }

  onResize() {
    this.camera.aspect = (window.innerWidth - 320) / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth - 320, window.innerHeight);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    
    this.controls.update();
    this.performanceMonitor.update();
    
    this.updateFrustum();
    
    this.chunkManagers.forEach((manager) => {
      manager.updateLOD(this.camera);
    });
    
    this.boreholeManager.renderVisibleBoreholes(
      new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld)
    );
    
    if (this.frameCount % 60 === 0) {
      this.updateMemoryStats();
    }
    
    this.renderer.render(this.scene, this.camera);
    this.frameCount = (this.frameCount || 0) + 1;
  }
}

const app = new GeologicalModeler();
