let scene, camera, renderer, controls;
let voxelEngine, marchingCubes, mesh;
let raycaster, mouse;
let currentMode = 'dig';
let currentVoxelType = 1;
let brushSize = 1;
let needsUpdate = false;
let sliceEnabled = false;
let currentSliceAxis = 'y';
let currentSlicePosition = 50;
let clipPlane;
let slicePlaneHelper;

const GRID_SIZE = 100;
const CELL_SIZE = 1;

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  const aspect = window.innerWidth / window.innerHeight;
  camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
  camera.position.set(GRID_SIZE, GRID_SIZE, GRID_SIZE * 1.5);
  camera.lookAt(GRID_SIZE / 2, GRID_SIZE / 2, GRID_SIZE / 2);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.localClippingEnabled = true;
  document.getElementById('container').appendChild(renderer.domElement);
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();
  voxelEngine = new VoxelEngine(GRID_SIZE);
  marchingCubes = new MarchingCubes(voxelEngine);
  regenerateMesh();
  setupEventListeners();
  loadFileList();
  animate();
}

function updateClipPlane() {
  if (!clipPlane) return;
  
  let normal = new THREE.Vector3();
  let constant = -currentSlicePosition;
  
  switch (currentSliceAxis) {
    case 'x':
      normal.set(1, 0, 0);
      break;
    case 'y':
      normal.set(0, 1, 0);
      break;
    case 'z':
      normal.set(0, 0, 1);
      break;
  }
  
  clipPlane.normal.copy(normal);
  clipPlane.constant = constant;
  
  if (slicePlaneHelper) {
    scene.remove(slicePlaneHelper);
    slicePlaneHelper.geometry.dispose();
    slicePlaneHelper.material.dispose();
  }
  
  if (sliceEnabled) {
    const planeGeom = new THREE.PlaneGeometry(GRID_SIZE * 2, GRID_SIZE * 2);
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x4ecdc4,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide
    });
    slicePlaneHelper = new THREE.Mesh(planeGeom, planeMat);
    
    const plane = new THREE.Plane(normal, constant);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1), 
      plane.normal
    );
    slicePlaneHelper.quaternion.copy(quaternion);
    slicePlaneHelper.position.copy(plane.normal.clone().multiplyScalar(-plane.constant));
    
    scene.add(slicePlaneHelper);
  }
}

function regenerateMesh() {
  while (scene.children.length > 0) {
    const child = scene.children[0];
    scene.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach(m => m.dispose());
      } else {
        child.material.dispose();
      }
    }
  }
  
  if (!clipPlane) {
    clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -50);
  }
  
  const meshData = marchingCubes.generateMesh();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(meshData.vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(meshData.colors, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(meshData.normals, 3));
  geometry.setIndex(meshData.indices);
  
  const materialOptions = {
    vertexColors: true,
    flatShading: false,
    roughness: 0.8,
    metalness: 0.05,
    side: THREE.DoubleSide
  };
  
  if (sliceEnabled) {
    materialOptions.clippingPlanes = [clipPlane];
    materialOptions.clipShadows = true;
  }
  
  const material = new THREE.MeshStandardMaterial(materialOptions);
  mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  
  updateClipPlane();
  
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(50, 100, 50);
  scene.add(directionalLight);
  const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
  directionalLight2.position.set(-50, 50, -50);
  scene.add(directionalLight2);
  const backLight = new THREE.DirectionalLight(0x8888aa, 0.3);
  backLight.position.set(0, -100, -50);
  scene.add(backLight);
}

function toggleSliceMode() {
  sliceEnabled = !sliceEnabled;
  const btn = document.getElementById('btn-toggle-slice');
  const sliceControls = document.getElementById('slice-controls');
  const slicePosControls = document.getElementById('slice-position-controls');
  const sliceExportControls = document.getElementById('slice-export-controls');
  
  if (sliceEnabled) {
    btn.textContent = '关闭切片';
    btn.classList.add('selected');
    sliceControls.style.display = 'block';
    slicePosControls.style.display = 'block';
    sliceExportControls.style.display = 'block';
  } else {
    btn.textContent = '开启切片';
    btn.classList.remove('selected');
    sliceControls.style.display = 'none';
    slicePosControls.style.display = 'none';
    sliceExportControls.style.display = 'none';
  }
  
  regenerateMesh();
}

function onSliceAxisChange(e) {
  currentSliceAxis = e.target.value;
  if (sliceEnabled) {
    regenerateMesh();
  }
}

function onSlicePositionChange(e) {
  currentSlicePosition = parseInt(e.target.value);
  document.getElementById('slice-position-label').textContent = currentSlicePosition;
  if (sliceEnabled) {
    updateClipPlane();
  }
}

function exportSliceImage() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const scale = 4;
  canvas.width = GRID_SIZE * scale;
  canvas.height = GRID_SIZE * scale;
  
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  let dim1, dim2;
  switch (currentSliceAxis) {
    case 'x':
      dim1 = 'y';
      dim2 = 'z';
      break;
    case 'y':
      dim1 = 'x';
      dim2 = 'z';
      break;
    case 'z':
      dim1 = 'x';
      dim2 = 'y';
      break;
  }
  
  for (let i = 0; i < GRID_SIZE; i++) {
    for (let j = 0; j < GRID_SIZE; j++) {
      let x, y, z;
      switch (currentSliceAxis) {
        case 'x':
          x = currentSlicePosition;
          y = i;
          z = j;
          break;
        case 'y':
          x = i;
          y = currentSlicePosition;
          z = j;
          break;
        case 'z':
          x = i;
          y = j;
          z = currentSlicePosition;
          break;
      }
      
      const voxelType = voxelEngine.getVoxel(x, y, z);
      if (voxelType > 0) {
        const color = voxelEngine.getVoxelTypeColor(voxelType);
        ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
        ctx.fillRect(i * scale, j * scale, scale, scale);
      }
    }
  }
  
  ctx.strokeStyle = '#4ecdc4';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  
  ctx.fillStyle = 'white';
  ctx.font = '16px Arial';
  ctx.fillText(`切片: ${currentSliceAxis.toUpperCase()} = ${currentSlicePosition}`, 10, 25);
  
  const link = document.createElement('a');
  link.download = `slice_${currentSliceAxis}_${currentSlicePosition}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function setupEventListeners() {
  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('click', onMouseClick);
  document.getElementById('btn-dig').addEventListener('click', () => setMode('dig'));
  document.getElementById('btn-fill').addEventListener('click', () => setMode('fill'));
  document.getElementById('voxel-type').addEventListener('change', (e) => {
    currentVoxelType = parseInt(e.target.value);
  });
  document.getElementById('brush-size').addEventListener('input', (e) => {
    brushSize = parseInt(e.target.value);
    document.getElementById('brush-size-label').textContent = brushSize;
  });
  document.getElementById('btn-save').addEventListener('click', saveVoxelData);
  document.getElementById('btn-load').addEventListener('click', loadVoxelData);
  document.getElementById('btn-toggle-slice').addEventListener('click', toggleSliceMode);
  document.getElementById('slice-axis').addEventListener('change', onSliceAxisChange);
  document.getElementById('slice-position').addEventListener('input', onSlicePositionChange);
  document.getElementById('btn-export-slice').addEventListener('click', exportSliceImage);
}

function setMode(mode) {
  currentMode = mode;
  document.getElementById('btn-dig').classList.toggle('selected', mode === 'dig');
  document.getElementById('btn-fill').classList.toggle('selected', mode === 'fill');
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onMouseClick(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObject(mesh);
  if (intersects.length > 0) {
    const point = intersects[0].point;
    const normal = intersects[0].face ? intersects[0].face.normal : new THREE.Vector3(0, 1, 0);
    let voxelX, voxelY, voxelZ;
    if (currentMode === 'dig') {
      voxelX = Math.floor(point.x);
      voxelY = Math.floor(point.y);
      voxelZ = Math.floor(point.z);
    } else {
      voxelX = Math.floor(point.x + normal.x * 0.5);
      voxelY = Math.floor(point.y + normal.y * 0.5);
      voxelZ = Math.floor(point.z + normal.z * 0.5);
    }
    applyBrush(voxelX, voxelY, voxelZ);
    needsUpdate = true;
  }
}

function applyBrush(centerX, centerY, centerZ) {
  for (let dx = -brushSize + 1; dx < brushSize; dx++) {
    for (let dy = -brushSize + 1; dy < brushSize; dy++) {
      for (let dz = -brushSize + 1; dz < brushSize; dz++) {
        const x = centerX + dx;
        const y = centerY + dy;
        const z = centerZ + dz;
        if (currentMode === 'dig') {
          voxelEngine.setVoxel(x, y, z, 0);
        } else {
          voxelEngine.setVoxel(x, y, z, currentVoxelType);
        }
      }
    }
  }
}

async function saveVoxelData() {
  const filename = `voxel_data_${Date.now()}.json`;
  const data = voxelEngine.exportData();
  try {
    const response = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, data })
    });
    const result = await response.json();
    if (result.success) {
      alert('保存成功: ' + filename);
      loadFileList();
    } else {
      alert('保存失败: ' + result.error);
    }
  } catch (error) {
    alert('保存失败: ' + error.message);
  }
}

async function loadVoxelData() {
  const select = document.getElementById('file-list');
  const filename = select.value;
  if (!filename) {
    alert('请选择一个文件');
    return;
  }
  try {
    const response = await fetch(`/api/load/${filename}`);
    const result = await response.json();
    if (result.success) {
      voxelEngine.importData(result.data);
      regenerateMesh();
      alert('加载成功');
    } else {
      alert('加载失败: ' + result.error);
    }
  } catch (error) {
    alert('加载失败: ' + error.message);
  }
}

async function loadFileList() {
  try {
    const response = await fetch('/api/files');
    const result = await response.json();
    const select = document.getElementById('file-list');
    select.innerHTML = '';
    if (result.success) {
      result.files.forEach(file => {
        const option = document.createElement('option');
        option.value = file;
        option.textContent = file;
        select.appendChild(option);
      });
    }
  } catch (error) {
    console.error('加载文件列表失败:', error);
  }
}

function animate() {
  requestAnimationFrame(animate);
  if (needsUpdate) {
    regenerateMesh();
    needsUpdate = false;
  }
  controls.update();
  renderer.render(scene, camera);
}

init();
