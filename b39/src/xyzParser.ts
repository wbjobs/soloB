import type { Frame, XYZData } from './types';

export function parseXYZ(content: string): XYZData {
  const lines = content.split(/\r?\n/);
  const frames: Frame[] = [];
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    
    if (!line) {
      i++;
      continue;
    }
    
    const atomCount = parseInt(line, 10);
    
    if (isNaN(atomCount) || atomCount < 0) {
      throw new Error(`Invalid atom count at line ${i + 1}: "${line}"`);
    }
    
    if (i + 1 >= lines.length) {
      throw new Error(`Missing comment line after atom count at line ${i + 1}`);
    }
    
    const comment = lines[i + 1].trim();
    const atoms = [];
    
    for (let j = 0; j < atomCount; j++) {
      const atomLineIndex = i + 2 + j;
      
      if (atomLineIndex >= lines.length) {
        throw new Error(`Unexpected end of file: expected ${atomCount} atoms but found ${j}`);
      }
      
      const atomLine = lines[atomLineIndex].trim();
      if (!atomLine) {
        continue;
      }
      
      const parts = atomLine.split(/\s+/);
      
      if (parts.length < 4) {
        throw new Error(`Invalid atom line at line ${atomLineIndex + 1}: expected at least 4 columns`);
      }
      
      const element = parts[0];
      const x = parseFloat(parts[1]);
      const y = parseFloat(parts[2]);
      const z = parseFloat(parts[3]);
      
      if (isNaN(x) || isNaN(y) || isNaN(z)) {
        throw new Error(`Invalid coordinates at line ${atomLineIndex + 1}`);
      }
      
      atoms.push({ element, x, y, z });
    }
    
    frames.push({ atomCount, comment, atoms });
    i += 2 + atomCount;
  }
  
  if (frames.length === 0) {
    throw new Error('No frames found in XYZ file');
  }
  
  const atomCount = frames[0].atomCount;
  
  for (const frame of frames) {
    if (frame.atomCount !== atomCount) {
      throw new Error(`Inconsistent atom counts between frames: expected ${atomCount} but found ${frame.atomCount}`);
    }
  }
  
  return { frames, atomCount };
}

export async function loadXYZFromFile(file: File): Promise<XYZData> {
  const content = await file.text();
  return parseXYZ(content);
}

export function computeBounds(frames: { atoms: { x: number; y: number; z: number }[] }[]): {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  size: number;
} {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  
  for (const frame of frames) {
    for (const atom of frame.atoms) {
      minX = Math.min(minX, atom.x);
      minY = Math.min(minY, atom.y);
      minZ = Math.min(minZ, atom.z);
      maxX = Math.max(maxX, atom.x);
      maxY = Math.max(maxY, atom.y);
      maxZ = Math.max(maxZ, atom.z);
    }
  }
  
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;
  
  const sizeX = maxX - minX;
  const sizeY = maxY - minY;
  const sizeZ = maxZ - minZ;
  const size = Math.max(sizeX, sizeY, sizeZ);
  
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center: [centerX, centerY, centerZ],
    size,
  };
}
