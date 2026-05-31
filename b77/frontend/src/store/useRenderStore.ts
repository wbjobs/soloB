import { create } from 'zustand';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface RenderParams {
  samples: number;
  maxDepth: number;
  lightPosition: Vec3;
  resolution: { width: number; height: number };
  adaptiveSampling: boolean;
  edgeThreshold: number;
  maxSamples: number;
}

export interface TileData {
  tileX: number;
  tileY: number;
  tileWidth: number;
  tileHeight: number;
  pixels: Uint8ClampedArray;
}

export interface RayNode {
  id: string;
  origin: Vec3;
  direction: Vec3;
  depth: number;
  children: string[];
  color: Vec3;
}

export interface IntersectionData {
  triangleIndex: number;
  point: Vec3;
  normal: Vec3;
  uv: { u: number; v: number };
  material: string;
}

export interface ShadingValue {
  step: string;
  value: Vec3;
  contribution: number;
  description: string;
}

export interface DebugPixelResult {
  x: number;
  y: number;
  rayTree: RayNode[];
  intersections: IntersectionData[];
  shadingValues: ShadingValue[];
}

export interface TaskStatus {
  taskId: string;
  status: 'queued' | 'rendering' | 'completed' | 'error';
  progress: number;
  totalTiles: number;
  completedTiles: number;
  renderTimeMs?: number;
  adaptiveSampling?: boolean;
  totalSamples?: number;
  samplesSaved?: number;
}

export interface RenderHistory {
  taskId: string;
  timestamp: number;
  renderTimeMs: number;
  adaptiveSampling: boolean;
  totalSamples: number;
  samplesSaved: number;
}

interface RenderState {
  objData: string | null;
  fileName: string | null;
  params: RenderParams;
  currentTask: TaskStatus | null;
  tiles: Map<string, TileData>;
  isConnected: boolean;
  debugMode: boolean;
  debugData: DebugPixelResult | null;
  selectedPixel: { x: number; y: number } | null;
  renderHistory: RenderHistory[];

  setObjData: (data: string, fileName: string) => void;
  setParams: (params: Partial<RenderParams>) => void;
  setCurrentTask: (task: TaskStatus | null) => void;
  addTile: (tile: TileData) => void;
  setConnected: (connected: boolean) => void;
  setDebugMode: (enabled: boolean) => void;
  setDebugData: (data: DebugPixelResult | null) => void;
  setSelectedPixel: (pixel: { x: number; y: number } | null) => void;
  addRenderHistory: (history: RenderHistory) => void;
  clearHistory: () => void;
  resetRender: () => void;
}

export const useRenderStore = create<RenderState>((set) => ({
  objData: null,
  fileName: null,
  params: {
    samples: 4,
    maxDepth: 5,
    lightPosition: { x: 5, y: 5, z: 5 },
    resolution: { width: 512, height: 512 },
    adaptiveSampling: true,
    edgeThreshold: 0.15,
    maxSamples: 16
  },
  currentTask: null,
  tiles: new Map(),
  isConnected: false,
  debugMode: false,
  debugData: null,
  selectedPixel: null,
  renderHistory: [],

  setObjData: (data, fileName) => set({ objData: data, fileName }),

  setParams: (newParams) => set((state) => ({
    params: { ...state.params, ...newParams }
  })),

  setCurrentTask: (task) => set({ currentTask: task }),

  addTile: (tile) => set((state) => {
    const key = `${tile.tileX}-${tile.tileY}`;
    const newTiles = new Map(state.tiles);
    newTiles.set(key, tile);
    return { tiles: newTiles };
  }),

  setConnected: (connected) => set({ isConnected: connected }),

  setDebugMode: (enabled) => set({ debugMode: enabled, debugData: null, selectedPixel: null }),

  setDebugData: (data) => set({ debugData: data }),

  setSelectedPixel: (pixel) => set({ selectedPixel: pixel }),

  addRenderHistory: (history) => set((state) => ({
    renderHistory: [...state.renderHistory, history].slice(-10)
  })),

  clearHistory: () => set({ renderHistory: [] }),

  resetRender: () => set({
    tiles: new Map(),
    currentTask: null,
    debugData: null,
    selectedPixel: null
  })
}));
