const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const versionService = require('../services/versionService');
const roomService = require('../services/roomService');
const fileService = require('../services/fileService');
const { OTManager } = require('../utils/ot');

const router = express.Router();
const otManager = new OTManager();

router.get('/:roomId/versions', authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { fileId, limit = 50, offset = 0 } = req.query;

    const room = roomService.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!room.users.has(req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fileId) {
      return res.status(400).json({ error: 'fileId is required' });
    }

    const versions = await versionService.getHistory(roomId, fileId, {
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json(versions);
  } catch (error) {
    console.error('Get versions error:', error);
    res.status(500).json({ error: 'Failed to get versions' });
  }
});

router.get('/:roomId/versions/:commitHash', authenticateToken, async (req, res) => {
  try {
    const { roomId, commitHash } = req.params;

    const room = roomService.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!room.users.has(req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const version = await versionService.getVersion(roomId, commitHash);

    if (!version) {
      return res.status(404).json({ error: 'Version not found' });
    }

    res.json(version);
  } catch (error) {
    console.error('Get version error:', error);
    res.status(500).json({ error: 'Failed to get version' });
  }
});

router.post('/:roomId/versions/compare', authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { fileId, fromCommit, toCommit } = req.body;

    if (!fileId || !fromCommit || !toCommit) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const room = roomService.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!room.users.has(req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const diff = await versionService.compareVersions(roomId, fileId, fromCommit, toCommit);

    res.json(diff);
  } catch (error) {
    console.error('Compare versions error:', error);
    res.status(500).json({ error: 'Failed to compare versions' });
  }
});

router.post('/:roomId/versions/:commitHash/rollback', authenticateToken, async (req, res) => {
  try {
    const { roomId, commitHash } = req.params;
    const { fileId } = req.body;

    if (!fileId) {
      return res.status(400).json({ error: 'fileId is required' });
    }

    const room = roomService.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!room.users.has(req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!roomService.canEdit(roomId, req.user.id)) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const userData = room.users.get(req.user.id);

    const result = await versionService.rollbackToVersion({
      roomId,
      fileId,
      commitHash,
      authorId: req.user.id,
      authorName: userData?.username || req.user.id
    });

    fileService.updateFileContent(room, fileId, result.content);

    const doc = otManager.getOrCreateDocument(fileId, result.content);
    const newState = doc.getState();

    req.io?.to(roomId).emit('operation', {
      userId: req.user.id,
      fileId,
      operation: {
        type: 'rollback',
        commitHash
      },
      state: newState
    });

    req.io?.to(roomId).emit('version-rolled-back', {
      fileId,
      commitHash,
      version: result.version
    });

    res.json(result);
  } catch (error) {
    console.error('Rollback error:', error);
    if (error.message === 'Version not found') {
      return res.status(404).json({ error: 'Version not found' });
    }
    res.status(500).json({ error: 'Failed to rollback' });
  }
});

router.post('/:roomId/versions/save', authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { fileId, message, fileName } = req.body;

    if (!fileId) {
      return res.status(400).json({ error: 'fileId is required' });
    }

    const room = roomService.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!room.users.has(req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!roomService.canEdit(roomId, req.user.id)) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const fileData = fileService.getFileContent(room, fileId);
    if (!fileData) {
      return res.status(404).json({ error: 'File not found' });
    }

    const userData = room.users.get(req.user.id);

    const version = await versionService.saveVersion({
      roomId,
      fileId,
      fileName: fileName || `${fileId}.txt`,
      content: fileData.content,
      language: fileData.language,
      authorId: req.user.id,
      authorName: userData?.username || req.user.id,
      message: message || 'Manual save'
    });

    if (version) {
      req.io?.to(roomId).emit('version-saved', {
        fileId,
        version
      });
    }

    res.json({ success: true, version });
  } catch (error) {
    console.error('Save version error:', error);
    res.status(500).json({ error: 'Failed to save version' });
  }
});

module.exports = router;
