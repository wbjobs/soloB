const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  getScores,
  uploadScore,
  getScore,
  deleteScore,
  shareScore
} = require('../controllers/scoreController');
const {
  getAnnotations,
  addAnnotation,
  updateAnnotation,
  deleteAnnotation
} = require('../controllers/annotationController');
const {
  getVersions,
  createVersion,
  restoreVersion
} = require('../controllers/versionController');
const {
  detectBeats,
  applyBeatMarks,
  getBeatMarks,
  updateBeatMark
} = require('../controllers/beatController');
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');

const router = express.Router();

const uploadDir = process.env.UPLOAD_PATH || './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('只支持 PDF 文件'));
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

router.get('/', auth, getScores);
router.post('/', auth, upload.single('file'), uploadScore);
router.get('/:id', auth, checkPermission(['creator', 'editor', 'viewer']), getScore);
router.delete('/:id', auth, checkPermission(['creator']), deleteScore);
router.post('/:id/share', auth, checkPermission(['creator']), shareScore);

router.get('/:scoreId/annotations', auth, checkPermission(['creator', 'editor', 'viewer']), getAnnotations);
router.post('/:scoreId/annotations', auth, checkPermission(['creator', 'editor']), addAnnotation);
router.put('/annotations/:id', auth, updateAnnotation);
router.delete('/annotations/:id', auth, deleteAnnotation);

router.get('/:scoreId/versions', auth, checkPermission(['creator', 'editor', 'viewer']), getVersions);
router.post('/:scoreId/versions', auth, checkPermission(['creator', 'editor']), createVersion);
router.post('/versions/:id/restore', auth, restoreVersion);

router.get('/:scoreId/beats/:page', auth, checkPermission(['creator', 'editor', 'viewer']), getBeatMarks);
router.post('/:scoreId/beats/:page/detect', auth, checkPermission(['creator', 'editor']), detectBeats);
router.post('/:scoreId/beats/:page/apply', auth, checkPermission(['creator', 'editor']), applyBeatMarks);
router.put('/beats/:id', auth, updateBeatMark);

module.exports = router;
