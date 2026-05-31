export interface Atom {
  element: string;
  x: number;
  y: number;
  z: number;
}

export interface Frame {
  atomCount: number;
  comment: string;
  atoms: Atom[];
}

export interface XYZData {
  frames: Frame[];
  atomCount: number;
}

export interface Camera {
  rotationX: number;
  rotationY: number;
  zoom: number;
  panX: number;
  panY: number;
}

export interface Uniforms {
  viewProjectionMatrix: Float32Array;
  cameraPosition: Float32Array;
  lightDirection: Float32Array;
  lightColor: Float32Array;
  ambientLight: Float32Array;
  atomScale: number;
  padding: number[];
}

export interface ElementInfo {
  color: [number, number, number];
  radius: number;
}

export const ELEMENT_INFO: Record<string, ElementInfo> = {
  H:  { color: [1.0, 1.0, 1.0], radius: 0.31 },
  C:  { color: [0.3, 0.3, 0.3], radius: 0.77 },
  N:  { color: [0.2, 0.4, 0.9], radius: 0.75 },
  O:  { color: [0.9, 0.2, 0.2], radius: 0.73 },
  F:  { color: [0.2, 0.9, 0.2], radius: 0.71 },
  P:  { color: [0.9, 0.6, 0.2], radius: 1.06 },
  S:  { color: [0.9, 0.9, 0.2], radius: 1.02 },
  Cl: { color: [0.2, 0.9, 0.2], radius: 0.99 },
  Na: { color: [0.9, 0.4, 0.2], radius: 1.54 },
  Mg: { color: [0.2, 0.6, 0.2], radius: 1.36 },
  K:  { color: [0.9, 0.3, 0.3], radius: 1.96 },
  Ca: { color: [0.2, 0.2, 0.9], radius: 1.74 },
  Fe: { color: [0.6, 0.3, 0.1], radius: 1.26 },
  Zn: { color: [0.6, 0.6, 0.6], radius: 1.22 },
  Cu: { color: [0.8, 0.4, 0.2], radius: 1.28 },
  Au: { color: [0.9, 0.8, 0.2], radius: 1.34 },
};

export function getElementInfo(element: string): ElementInfo {
  const info = ELEMENT_INFO[element];
  if (info) return info;
  const firstChar = element[0];
  if (firstChar && ELEMENT_INFO[firstChar]) return ELEMENT_INFO[firstChar];
  return { color: [0.5, 0.5, 0.5], radius: 1.0 };
}
