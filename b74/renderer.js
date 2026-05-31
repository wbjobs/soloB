const THREE = require('three');
const { OrbitControls } = require('three/examples/jsm/controls/OrbitControls');
const { ipcRenderer } = require('electron');

const GRID_SIZE = 16;
const BLOCK_SIZE = 1;
const SIGNAL_HISTORY_LENGTH = 200;
const HIGH_FREQ_THRESHOLD = 0.25;

let scene, camera, renderer, controls;
let blocks = new Map();
let gridHelper;
let raycaster, mouse;
let selectedComponent = 'air';
let componentRotation = 0;
let ws = null;
let isPlaying = false;
let tickCount = 0;
let playInterval = null;
let ticksPerSecond = 5;
let signalHistory = new Array(SIGNAL_HISTORY_LENGTH).fill(0);
let allSignalHistory = new Map();
let monitoringPosition = null;
let autoMonitorMode = true;
let waveformCanvas, waveformCtx;
let monitoringMarker = null;

const componentNames = {
  air: 'Eraser',
  block: 'Block',
  redstone: 'Redstone',
  repeater: 'Repeater',
  comparator: 'Comparator',
  torch: 'Torch',
  lever: 'Lever',
  piston: 'Piston',
  lamp: 'Lamp'
};

function getSignalColor(strength) {
  const t = strength / 15;
  const r = Math.floor(255 * t);
  const g = Math.floor(50 * (1 - t));
  const b = Math.floor(50 * (1 - t));
  return new THREE.Color(r / 255, g / 255, b / 255);
}

function init() {
  const container = document.getElementById('canvas-container');
  
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  
  camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.set(20, 20, 20);
  camera.lookAt(GRID_SIZE / 2, 0, GRID_SIZE / 2);
  
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);
  
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(GRID_SIZE / 2, GRID_SIZE / 2, GRID_SIZE / 2);
  controls.enableDamping = true;
  
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(20, 30, 20);
  directionalLight.castShadow = true;
  scene.add(directionalLight);
  
  gridHelper = new THREE.GridHelper(GRID_SIZE, GRID_SIZE, 0x444444, 0x333333);
  gridHelper.position.set(GRID_SIZE / 2, 0, GRID_SIZE / 2);
  scene.add(gridHelper);
  
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();
  
  setupEventListeners(container);
  connectWebSocket();
  animate();
}

function setupEventListeners(container) {
  container.addEventListener('click', onMouseClick);
  container.addEventListener('contextmenu', onRightClick);
  container.addEventListener('mousemove', onMouseMove);
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('keydown', onKeyDown);
  
  document.querySelectorAll('.component-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.component-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedComponent = btn.dataset.component;
      document.getElementById('selected-component').textContent = componentNames[selectedComponent];
      componentRotation = 0;
    });
  });
  
  document.getElementById('btn-play').addEventListener('click', togglePlay);
  document.getElementById('btn-step').addEventListener('click', stepTick);
  document.getElementById('btn-reset').addEventListener('click', resetSimulation);
  document.getElementById('btn-export').addEventListener('click', exportLayout);
  document.getElementById('btn-import').addEventListener('click', importLayout);
  
  const speedSlider = document.getElementById('speed-slider');
  speedSlider.addEventListener('input', () => {
    ticksPerSecond = parseInt(speedSlider.value);
    document.getElementById('speed-value').textContent = ticksPerSecond;
    if (playInterval) {
      clearInterval(playInterval);
      playInterval = setInterval(stepTick, 1000 / ticksPerSecond);
    }
  });
}

function connectWebSocket() {
  ws = new WebSocket('ws://localhost:8765');
  
  ws.onopen = () => {
    console.log('Connected to backend');
    document.getElementById('connection-status').textContent = '● Connected';
    document.getElementById('connection-status').className = 'status-connected';
    sendFullState();
  };
  
  ws.onclose = () => {
    console.log('Disconnected from backend');
    document.getElementById('connection-status').textContent = '● Disconnected';
    document.getElementById('connection-status').className = 'status-disconnected';
    setTimeout(connectWebSocket, 2000);
  };
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'tick') {
      updateSignalVisuals(data.signals);
      recordSignal(data.signals);
      tickCount = data.tick;
      document.getElementById('tick-count').textContent = tickCount;
    }
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

function sendFullState() {
  const state = [];
  blocks.forEach((block, key) => {
    const [x, y, z] = key.split(',').map(Number);
    state.push({
      x, y, z,
      type: block.userData.type,
      rotation: block.userData.rotation || 0,
      delay: block.userData.delay || 1,
      powered: block.userData.powered || false,
      subtract: block.userData.subtract || false
    });
  });
  
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'init',
      grid_size: GRID_SIZE,
      blocks: state
    }));
  }
}

function snapToGrid(value) {
  return Math.floor(value + 0.5);
}

function getAdjacentGridPosition(point, normal) {
  return {
    x: snapToGrid(point.x + normal.x * 0.501),
    y: snapToGrid(point.y + normal.y * 0.501),
    z: snapToGrid(point.z + normal.z * 0.501)
  };
}

function onMouseClick(event) {
  if (event.button !== 0) return;
  
  const container = document.getElementById('canvas-container');
  const rect = container.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / container.clientWidth) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / container.clientHeight) * 2 + 1;
  
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(Array.from(blocks.values()));
  
  if (intersects.length > 0) {
    const point = intersects[0].point;
    const normal = intersects[0].face.normal;
    
    let x, y, z;
    if (selectedComponent === 'air') {
      x = snapToGrid(point.x);
      y = snapToGrid(point.y);
      z = snapToGrid(point.z);
      removeBlock(x, y, z);
    } else {
      const pos = getAdjacentGridPosition(point, normal);
      placeBlock(pos.x, pos.y, pos.z, selectedComponent);
    }
  }
}

function onRightClick(event) {
  event.preventDefault();
  
  const container = document.getElementById('canvas-container');
  const rect = container.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / container.clientWidth) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / container.clientHeight) * 2 + 1;
  
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(Array.from(blocks.values()));
  
  if (intersects.length > 0) {
    const point = intersects[0].point;
    const x = snapToGrid(point.x);
    const y = snapToGrid(point.y);
    const z = snapToGrid(point.z);
    rotateBlock(x, y, z);
  }
}

function onMouseMove(event) {
}

function onKeyDown(event) {
  if (event.code === 'Space') {
    event.preventDefault();
    togglePlay();
  }
}

function onWindowResize() {
  const container = document.getElementById('canvas-container');
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}

function placeBlock(x, y, z, type) {
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE || z < 0 || z >= GRID_SIZE) return;
  
  const key = `${x},${y},${z}`;
  if (blocks.has(key)) {
    removeBlock(x, y, z);
  }
  
  const geometry = getComponentGeometry(type);
  const material = getComponentMaterial(type);
  const mesh = new THREE.Mesh(geometry, material);
  
  mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
  mesh.userData.type = type;
  mesh.userData.rotation = componentRotation;
  mesh.userData.delay = 1;
  mesh.userData.subtract = false;
  mesh.userData.signal = 0;
  mesh.userData.powered = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  
  if (type === 'repeater' || type === 'comparator' || type === 'piston') {
    mesh.rotation.y = componentRotation * Math.PI / 2;
  }
  
  scene.add(mesh);
  blocks.set(key, mesh);
  
  updateComponentCount();
  sendBlockChange(x, y, z, type, 'place');
}

function removeBlock(x, y, z) {
  const key = `${x},${y},${z}`;
  if (blocks.has(key)) {
    const mesh = blocks.get(key);
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    blocks.delete(key);
    
    allSignalHistory.delete(key);
    if (monitoringPosition && 
        monitoringPosition.x === x && 
        monitoringPosition.y === y && 
        monitoringPosition.z === z) {
      monitoringPosition = null;
      removeMonitoringMarker();
      updateMonitorDisplay();
    }
    
    updateComponentCount();
    sendBlockChange(x, y, z, 'air', 'remove');
  }
}

function rotateBlock(x, y, z) {
  const key = `${x},${y},${z}`;
  if (blocks.has(key)) {
    if (event.ctrlKey || event.metaKey) {
      setMonitoringPosition(x, y, z);
      autoMonitorMode = false;
      document.getElementById('btn-auto-monitor').textContent = 'Auto: OFF';
      return;
    }
    
    const mesh = blocks.get(key);
    const type = mesh.userData.type;
    
    if (type === 'lever') {
      mesh.userData.powered = !mesh.userData.powered;
      updateLeverVisual(mesh);
      sendBlockChange(x, y, z, type, 'toggle', 0, mesh.userData.powered);
    } else if (type === 'repeater') {
      if (event.shiftKey) {
        mesh.userData.delay = ((mesh.userData.delay || 1) % 4) + 1;
        sendBlockChange(x, y, z, type, 'delay', mesh.userData.delay);
        updateRepeaterVisual(mesh);
      } else {
        mesh.userData.rotation = (mesh.userData.rotation + 1) % 4;
        mesh.rotation.y = mesh.userData.rotation * Math.PI / 2;
        sendBlockChange(x, y, z, type, 'rotate', mesh.userData.rotation);
      }
    } else if (type === 'comparator') {
      if (event.shiftKey) {
        mesh.userData.subtract = !mesh.userData.subtract;
        sendBlockChange(x, y, z, type, 'mode');
        updateComparatorVisual(mesh);
      } else {
        mesh.userData.rotation = (mesh.userData.rotation + 1) % 4;
        mesh.rotation.y = mesh.userData.rotation * Math.PI / 2;
        sendBlockChange(x, y, z, type, 'rotate', mesh.userData.rotation);
      }
    } else if (type === 'piston') {
      mesh.userData.rotation = (mesh.userData.rotation + 1) % 4;
      mesh.rotation.y = mesh.userData.rotation * Math.PI / 2;
      sendBlockChange(x, y, z, type, 'rotate', mesh.userData.rotation);
    } else {
      setMonitoringPosition(x, y, z);
      autoMonitorMode = false;
      document.getElementById('btn-auto-monitor').textContent = 'Auto: OFF';
    }
  }
}

function sendBlockChange(x, y, z, type, action, rotation = 0, powered = false) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'block_change',
      x, y, z,
      block_type: type,
      action,
      rotation,
      powered
    }));
  }
}

function getComponentGeometry(type) {
  switch (type) {
    case 'block':
      return new THREE.BoxGeometry(BLOCK_SIZE * 0.95, BLOCK_SIZE * 0.95, BLOCK_SIZE * 0.95);
    case 'redstone':
      return new THREE.BoxGeometry(BLOCK_SIZE * 0.9, BLOCK_SIZE * 0.1, BLOCK_SIZE * 0.9);
    case 'repeater':
      return new THREE.BoxGeometry(BLOCK_SIZE * 0.8, BLOCK_SIZE * 0.15, BLOCK_SIZE * 0.6);
    case 'comparator':
      return new THREE.BoxGeometry(BLOCK_SIZE * 0.8, BLOCK_SIZE * 0.15, BLOCK_SIZE * 0.7);
    case 'torch':
      return new THREE.CylinderGeometry(BLOCK_SIZE * 0.1, BLOCK_SIZE * 0.15, BLOCK_SIZE * 0.6, 8);
    case 'lever':
      return new THREE.BoxGeometry(BLOCK_SIZE * 0.3, BLOCK_SIZE * 0.6, BLOCK_SIZE * 0.15);
    case 'piston':
      return new THREE.BoxGeometry(BLOCK_SIZE * 0.95, BLOCK_SIZE * 0.95, BLOCK_SIZE * 0.95);
    case 'lamp':
      return new THREE.BoxGeometry(BLOCK_SIZE * 0.9, BLOCK_SIZE * 0.9, BLOCK_SIZE * 0.9);
    default:
      return new THREE.BoxGeometry(BLOCK_SIZE * 0.95, BLOCK_SIZE * 0.95, BLOCK_SIZE * 0.95);
  }
}

function getComponentMaterial(type) {
  const colors = {
    block: 0x8b7355,
    redstone: 0x8b0000,
    repeater: 0x4a4a4a,
    comparator: 0x5a5a5a,
    torch: 0x333333,
    lever: 0x666666,
    piston: 0x707070,
    lamp: 0xffffaa
  };
  
  return new THREE.MeshStandardMaterial({
    color: colors[type] || 0x888888,
    roughness: 0.7,
    metalness: 0.1
  });
}

function updateSignalVisuals(signals) {
  signals.forEach(({ x, y, z, signal }) => {
    const key = `${x},${y},${z}`;
    if (blocks.has(key)) {
      const mesh = blocks.get(key);
      mesh.userData.signal = signal;
      
      if (mesh.userData.type === 'redstone') {
        mesh.material.color.copy(getSignalColor(signal));
        mesh.material.emissive = getSignalColor(signal);
        mesh.material.emissiveIntensity = signal / 30;
      } else if (mesh.userData.type === 'torch') {
        const isLit = signal > 0;
        mesh.material.color.setHex(isLit ? 0xff4444 : 0x333333);
        mesh.material.emissive.setHex(isLit ? 0xff4444 : 0x000000);
        mesh.material.emissiveIntensity = isLit ? 0.5 : 0;
      } else if (mesh.userData.type === 'lamp') {
        const isLit = signal > 0;
        mesh.material.color.setHex(isLit ? 0xffff00 : 0x666600);
        mesh.material.emissive.setHex(isLit ? 0xffff00 : 0x000000);
        mesh.material.emissiveIntensity = isLit ? 0.8 : 0;
      } else if (mesh.userData.type === 'repeater' || mesh.userData.type === 'comparator') {
        const isLit = signal > 0;
        mesh.material.emissive.setHex(isLit ? 0xff0000 : 0x000000);
        mesh.material.emissiveIntensity = isLit ? 0.3 : 0;
      }
    }
  });
}

function updateLeverVisual(mesh) {
  const isPowered = mesh.userData.powered;
  mesh.rotation.x = isPowered ? -Math.PI / 4 : Math.PI / 4;
  mesh.material.color.setHex(isPowered ? 0x44ff44 : 0x666666);
}

function updateRepeaterVisual(mesh) {
  const delay = mesh.userData.delay || 1;
  const colors = [0x4a4a4a, 0x5a5a3a, 0x6a6a2a, 0x7a7a1a];
  mesh.material.color.setHex(colors[delay - 1]);
}

function updateComparatorVisual(mesh) {
  const isSubtract = mesh.userData.subtract || false;
  mesh.material.color.setHex(isSubtract ? 0x7a5a5a : 0x5a5a5a);
}

function updateComponentCount() {
  document.getElementById('component-count').textContent = blocks.size;
}

function togglePlay() {
  isPlaying = !isPlaying;
  const btn = document.getElementById('btn-play');
  
  if (isPlaying) {
    btn.textContent = '⏸ Pause';
    playInterval = setInterval(stepTick, 1000 / ticksPerSecond);
  } else {
    btn.textContent = '▶ Play';
    if (playInterval) {
      clearInterval(playInterval);
      playInterval = null;
    }
  }
}

function stepTick() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'step' }));
  }
}

function resetSimulation() {
  tickCount = 0;
  document.getElementById('tick-count').textContent = '0';
  
  if (isPlaying) {
    togglePlay();
  }
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'reset' }));
  }
}

async function exportLayout() {
  const layout = {
    grid_size: GRID_SIZE,
    tick: tickCount,
    blocks: []
  };
  
  blocks.forEach((block, key) => {
    const [x, y, z] = key.split(',').map(Number);
    layout.blocks.push({
      x, y, z,
      type: block.userData.type,
      rotation: block.userData.rotation || 0,
      delay: block.userData.delay || 1,
      powered: block.userData.powered || false,
      subtract: block.userData.subtract || false
    });
  });
  
  const result = await ipcRenderer.invoke('export-json', layout);
  if (result.success) {
    console.log('Layout exported successfully');
  }
}

async function importLayout() {
  const result = await ipcRenderer.invoke('import-json');
  if (result.success) {
    blocks.forEach((block) => {
      scene.remove(block);
      block.geometry.dispose();
      block.material.dispose();
    });
    blocks.clear();
    
    monitoringPosition = null;
    removeMonitoringMarker();
    allSignalHistory.clear();
    signalHistory = new Array(SIGNAL_HISTORY_LENGTH).fill(0);
    updateMonitorDisplay();
    
    result.data.blocks.forEach(block => {
      componentRotation = block.rotation || 0;
      placeBlock(block.x, block.y, block.z, block.type);
      const key = `${block.x},${block.y},${block.z}`;
      if (blocks.has(key)) {
        const mesh = blocks.get(key);
        mesh.userData.delay = block.delay || 1;
        mesh.userData.powered = block.powered || false;
        mesh.userData.subtract = block.subtract || false;
        
        if (block.type === 'lever') {
          updateLeverVisual(mesh);
        }
        if (block.type === 'repeater') {
          updateRepeaterVisual(mesh);
        }
        if (block.type === 'comparator') {
          updateComparatorVisual(mesh);
        }
      }
    });
    
    tickCount = result.data.tick || 0;
    document.getElementById('tick-count').textContent = tickCount;
    componentRotation = 0;
    
    setTimeout(sendFullState, 100);
  }
}

function initFrequencyAnalyzer() {
  waveformCanvas = document.getElementById('waveform-canvas');
  waveformCtx = waveformCanvas.getContext('2d');
  
  document.getElementById('btn-clear-analyzer').addEventListener('click', clearAnalyzer);
  document.getElementById('btn-auto-monitor').addEventListener('click', toggleAutoMonitor);
}

function clearAnalyzer() {
  signalHistory = new Array(SIGNAL_HISTORY_LENGTH).fill(0);
  allSignalHistory.clear();
  monitoringPosition = null;
  removeMonitoringMarker();
  updateMonitorDisplay();
  drawWaveform();
}

function toggleAutoMonitor() {
  autoMonitorMode = !autoMonitorMode;
  const btn = document.getElementById('btn-auto-monitor');
  btn.textContent = autoMonitorMode ? 'Auto: ON' : 'Auto: OFF';
}

function recordSignal(signals) {
  signals.forEach(({ x, y, z, signal }) => {
    const key = `${x},${y},${z}`;
    
    if (!allSignalHistory.has(key)) {
      allSignalHistory.set(key, new Array(SIGNAL_HISTORY_LENGTH).fill(0));
    }
    
    const history = allSignalHistory.get(key);
    history.shift();
    history.push(signal);
  });
  
  if (autoMonitorMode) {
    findHighestFrequencyNode();
  }
  
  if (monitoringPosition) {
    const key = `${monitoringPosition.x},${monitoringPosition.y},${monitoringPosition.z}`;
    const history = allSignalHistory.get(key);
    if (history) {
      signalHistory = [...history];
      const freq = calculateFrequency(history);
      const duty = calculateDutyCycle(history);
      
      document.getElementById('signal-frequency').textContent = freq.toFixed(2) + ' Hz';
      document.getElementById('duty-cycle').textContent = duty.toFixed(1) + '%';
    }
  }
  
  updateHighFrequencyNodes();
  drawWaveform();
}

function calculateFrequency(history) {
  let transitions = 0;
  for (let i = 1; i < history.length; i++) {
    if ((history[i] > 0 && history[i-1] === 0) || 
        (history[i] === 0 && history[i-1] > 0)) {
      transitions++;
    }
  }
  return transitions / 2 / (history.length / ticksPerSecond);
}

function calculateDutyCycle(history) {
  const highTicks = history.filter(s => s > 0).length;
  return (highTicks / history.length) * 100;
}

function findHighestFrequencyNode() {
  let maxFreq = -1;
  let maxKey = null;
  
  allSignalHistory.forEach((history, key) => {
    const freq = calculateFrequency(history);
    if (freq > maxFreq) {
      maxFreq = freq;
      maxKey = key;
    }
  });
  
  if (maxKey && maxFreq >= 0.1) {
    const [x, y, z] = maxKey.split(',').map(Number);
    monitoringPosition = { x, y, z };
    updateMonitorDisplay();
  }
}

function updateMonitorDisplay() {
  if (monitoringPosition) {
    document.getElementById('monitoring-pos').textContent = 
      `(${monitoringPosition.x}, ${monitoringPosition.y}, ${monitoringPosition.z})`;
  } else {
    document.getElementById('monitoring-pos').textContent = 'None';
  }
}

function updateHighFrequencyNodes() {
  let highFreqCount = 0;
  
  allSignalHistory.forEach((history, key) => {
    const freq = calculateFrequency(history);
    const [x, y, z] = key.split(',').map(Number);
    const blockKey = key;
    
    if (blocks.has(blockKey)) {
      const mesh = blocks.get(blockKey);
      if (freq > HIGH_FREQ_THRESHOLD) {
        highFreqCount++;
        if (!mesh.userData.highlight) {
          mesh.userData.originalEmissive = mesh.material.emissive.getHex();
          mesh.userData.highlight = true;
        }
        const pulse = Math.sin(Date.now() * 0.01) * 0.5 + 0.5;
        mesh.material.emissive.setRGB(1, pulse * 0.5, 0);
        mesh.material.emissiveIntensity = 0.8;
      } else if (mesh.userData.highlight) {
        mesh.material.emissive.setHex(mesh.userData.originalEmissive || 0);
        mesh.material.emissiveIntensity = mesh.userData.signal > 0 ? 0.3 : 0;
        mesh.userData.highlight = false;
      }
    }
  });
  
  document.getElementById('high-freq-count').textContent = highFreqCount;
}

function drawWaveform() {
  if (!waveformCtx) return;
  
  const width = waveformCanvas.width;
  const height = waveformCanvas.height;
  
  waveformCtx.fillStyle = '#0a1628';
  waveformCtx.fillRect(0, 0, width, height);
  
  waveformCtx.strokeStyle = '#1a2a48';
  waveformCtx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const y = (height / 4) * (i + 1);
    waveformCtx.beginPath();
    waveformCtx.moveTo(0, y);
    waveformCtx.lineTo(width, y);
    waveformCtx.stroke();
  }
  
  waveformCtx.beginPath();
  waveformCtx.strokeStyle = '#e94560';
  waveformCtx.lineWidth = 2;
  
  const stepX = width / signalHistory.length;
  const maxSignal = 15;
  
  for (let i = 0; i < signalHistory.length; i++) {
    const x = i * stepX;
    const normalizedSignal = signalHistory[i] / maxSignal;
    const y = height - normalizedSignal * height * 0.8 - 5;
    
    if (i === 0) {
      waveformCtx.moveTo(x, y);
    } else {
      waveformCtx.lineTo(x, y);
    }
  }
  waveformCtx.stroke();
  
  const gradient = waveformCtx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, 'rgba(233, 69, 96, 0.4)');
  gradient.addColorStop(1, 'rgba(233, 69, 96, 0)');
  waveformCtx.fillStyle = gradient;
  
  waveformCtx.beginPath();
  for (let i = 0; i < signalHistory.length; i++) {
    const x = i * stepX;
    const normalizedSignal = signalHistory[i] / maxSignal;
    const y = height - normalizedSignal * height * 0.8 - 5;
    
    if (i === 0) {
      waveformCtx.moveTo(x, y);
    } else {
      waveformCtx.lineTo(x, y);
    }
  }
  waveformCtx.lineTo(width, height);
  waveformCtx.lineTo(0, height);
  waveformCtx.closePath();
  waveformCtx.fill();
}

function createMonitoringMarker(x, y, z) {
  if (monitoringMarker) {
    scene.remove(monitoringMarker);
  }
  
  const geometry = new THREE.RingGeometry(0.6, 0.8, 32);
  const material = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide
  });
  monitoringMarker = new THREE.Mesh(geometry, material);
  monitoringMarker.position.set(x + 0.5, y + 0.5, z + 0.5);
  monitoringMarker.lookAt(x + 0.5, y + 1.5, z + 0.5);
  scene.add(monitoringMarker);
}

function removeMonitoringMarker() {
  if (monitoringMarker) {
    scene.remove(monitoringMarker);
    monitoringMarker = null;
  }
}

function setMonitoringPosition(x, y, z) {
  monitoringPosition = { x, y, z };
  createMonitoringMarker(x, y, z);
  updateMonitorDisplay();
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  
  if (monitoringMarker) {
    monitoringMarker.rotateZ(0.05);
    const pulse = Math.sin(Date.now() * 0.005) * 0.2 + 0.6;
    monitoringMarker.material.opacity = pulse;
  }
  
  renderer.render(scene, camera);
}

init();
initFrequencyAnalyzer();
