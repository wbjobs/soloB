const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function saveVoxelData(filename, voxelData) {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, filename);
  const data = JSON.stringify(voxelData);
  fs.writeFileSync(filePath, data);
  return { success: true, filename };
}

function loadVoxelData(filename) {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return { success: false, error: 'File not found' };
  }
  const data = fs.readFileSync(filePath, 'utf-8');
  return { success: true, data: JSON.parse(data) };
}

function listSavedFiles() {
  ensureDataDir();
  const files = fs.readdirSync(DATA_DIR);
  return files.filter(file => file.endsWith('.json'));
}

module.exports = {
  saveVoxelData,
  loadVoxelData,
  listSavedFiles
};
