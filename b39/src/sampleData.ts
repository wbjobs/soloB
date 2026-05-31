import type { XYZData } from './types';

export function generateSampleXYZ(): XYZData {
  const frames: XYZData['frames'] = [];
  const frameCount = 100;
  
  const atoms = [
    { element: 'C', baseX: 0, baseY: 0, baseZ: 0 },
    { element: 'H', baseX: 1.08, baseY: 0, baseZ: 0 },
    { element: 'H', baseX: -0.36, baseY: 1.02, baseZ: 0 },
    { element: 'H', baseX: -0.36, baseY: -0.51, baseZ: 0.88 },
    { element: 'H', baseX: -0.36, baseY: -0.51, baseZ: -0.88 },
    
    { element: 'C', baseX: 3.0, baseY: 0, baseZ: 0 },
    { element: 'O', baseX: 4.2, baseY: 0, baseZ: 0 },
    
    { element: 'N', baseX: -3.0, baseY: 0, baseZ: 0 },
    { element: 'H', baseX: -3.8, baseY: 0.6, baseZ: 0 },
    { element: 'H', baseX: -3.8, baseY: -0.6, baseZ: 0 },
    { element: 'H', baseX: -3.2, baseY: 0, baseZ: 0.8 },
    
    { element: 'C', baseX: 0, baseY: 0, baseZ: 4.0 },
    { element: 'C', baseX: 1.4, baseY: 0, baseZ: 4.0 },
    { element: 'C', baseX: 2.1, baseY: 1.2, baseZ: 4.0 },
    { element: 'C', baseX: 1.4, baseY: 2.4, baseZ: 4.0 },
    { element: 'C', baseX: 0, baseY: 2.4, baseZ: 4.0 },
    { element: 'C', baseX: -0.7, baseY: 1.2, baseZ: 4.0 },
    
    { element: 'H', baseX: 2.0, baseY: -0.9, baseZ: 4.0 },
    { element: 'H', baseX: 3.2, baseY: 1.2, baseZ: 4.0 },
    { element: 'H', baseX: 2.0, baseY: 3.3, baseZ: 4.0 },
    { element: 'H', baseX: -0.6, baseY: 3.3, baseZ: 4.0 },
    { element: 'H', baseX: -1.8, baseY: 1.2, baseZ: 4.0 },
  ];
  
  const atomCount = atoms.length;
  
  for (let f = 0; f < frameCount; f++) {
    const t = f / frameCount;
    const angle = t * Math.PI * 4;
    
    const frameAtoms = atoms.map((atom, i) => {
      let x = atom.baseX;
      let y = atom.baseY;
      let z = atom.baseZ;
      
      const freq = 0.5 + (i % 5) * 0.1;
      const amp = 0.05 + (i % 3) * 0.02;
      
      x += Math.sin(angle * freq) * amp;
      y += Math.cos(angle * freq * 1.3) * amp;
      z += Math.sin(angle * freq * 0.7 + 1.0) * amp;
      
      const groupCenterX = i < 5 ? 0 : (i < 7 ? 3.0 : (i < 11 ? -3.0 : 0));
      const groupCenterY = i < 16 ? 0 : 1.2;
      
      const relX = x - groupCenterX;
      const relY = y - groupCenterY;
      const rotAngle = angle * 0.3 * (i % 2 === 0 ? 1 : -1);
      
      x = groupCenterX + relX * Math.cos(rotAngle) - relY * Math.sin(rotAngle);
      y = groupCenterY + relX * Math.sin(rotAngle) + relY * Math.cos(rotAngle);
      
      return { element: atom.element, x, y, z };
    });
    
    frames.push({
      atomCount,
      comment: `Frame ${f + 1}/${frameCount} - Sample molecular dynamics trajectory`,
      atoms: frameAtoms,
    });
  }
  
  return { frames, atomCount };
}
