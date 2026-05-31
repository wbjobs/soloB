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
}

export type TaskStatus = 'queued' | 'rendering' | 'completed' | 'error';

export interface RenderTask {
  id: string;
  status: TaskStatus;
  params: RenderParams;
  objData: string;
  progress: number;
  totalTiles: number;
  completedTiles: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface TileResult {
  type: 'tile_result';
  taskId: string;
  tileX: number;
  tileY: number;
  tileWidth: number;
  tileHeight: number;
  pixels: number[];
  samplesCompleted: number;
}

export interface TaskStatusMessage {
  type: 'task_status';
  taskId: string;
  status: TaskStatus;
  progress: number;
  totalTiles: number;
  completedTiles: number;
}

export interface RenderRequest {
  type: 'render_request';
  taskId: string;
  objData: string;
  params: RenderParams;
}

export interface DebugPixelRequest {
  type: 'debug_pixel';
  taskId: string;
  x: number;
  y: number;
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
  type: 'debug_pixel_result';
  taskId: string;
  x: number;
  y: number;
  rayTree: RayNode[];
  intersections: IntersectionData[];
  shadingValues: ShadingValue[];
}

export type WebSocketMessage = 
  | TileResult
  | TaskStatusMessage
  | DebugPixelResult;

export type WebSocketRequest = 
  | RenderRequest
  | DebugPixelRequest;

export interface PixelData {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  a: number;
}
