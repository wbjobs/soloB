const express = require('express');
const path = require('path');
const { saveVoxelData, loadVoxelData, listSavedFiles } = require('./save_handler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'client')));

app.post('/api/save', (req, res) => {
  try {
    const { filename, data } = req.body;
    const result = saveVoxelData(filename || `voxel_data_${Date.now()}.json`, data);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/load/:filename', (req, res) => {
  try {
    const result = loadVoxelData(req.params.filename);
    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/files', (req, res) => {
  try {
    const files = listSavedFiles();
    res.json({ success: true, files });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Voxel Editor Server running at http://localhost:${PORT}`);
});
