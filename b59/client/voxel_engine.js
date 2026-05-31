class VoxelEngine {
  constructor(size = 100) {
    this.size = size;
    this.grid = new Uint8Array(size * size * size);
    this.initDefaultTerrain();
  }

  getIndex(x, y, z) {
    if (x < 0 || x >= this.size || y < 0 || y >= this.size || z < 0 || z >= this.size) {
      return -1;
    }
    return x + y * this.size + z * this.size * this.size;
  }

  getVoxel(x, y, z) {
    const index = this.getIndex(x, y, z);
    if (index === -1) return 0;
    return this.grid[index];
  }

  setVoxel(x, y, z, value) {
    const index = this.getIndex(x, y, z);
    if (index === -1) return false;
    this.grid[index] = value;
    return true;
  }

  initDefaultTerrain() {
    const midY = Math.floor(this.size / 2);
    for (let x = 0; x < this.size; x++) {
      for (let z = 0; z < this.size; z++) {
        for (let y = 0; y < this.size; y++) {
          let value = 0;
          const noise = Math.sin(x * 0.1) * Math.cos(z * 0.1) * 3;
          const groundLevel = midY + Math.floor(noise);
          if (y < groundLevel) {
            if (y < groundLevel - 10 && Math.random() > 0.9) {
              value = 2;
            } else {
              value = 1;
            }
          }
          this.setVoxel(x, y, z, value);
        }
      }
    }
  }

  getVoxelTypeColor(type) {
    switch (type) {
      case 1:
        return { r: 139, g: 90, b: 43 };
      case 2:
        return { r: 255, g: 215, b: 0 };
      default:
        return { r: 0, g: 0, b: 0 };
    }
  }

  exportData() {
    return {
      size: this.size,
      grid: Array.from(this.grid)
    };
  }

  importData(data) {
    if (data.size !== this.size) {
      this.size = data.size;
      this.grid = new Uint8Array(data.size * data.size * data.size);
    }
    this.grid.set(data.grid);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VoxelEngine;
}
