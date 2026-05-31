const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const aiService = require('../services/aiService');
const roomService = require('../services/roomService');

const router = express.Router();

router.get('/status', authenticateToken, (req, res) => {
  res.json({
    enabled: aiService.isEnabled(),
    model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo'
  });
});

router.post('/:roomId/suggestions', authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { code, language, cursorPosition, prefix, suffix } = req.body;

    const room = roomService.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!room.users.has(req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await aiService.getCodeSuggestions({
      code,
      language,
      cursorPosition,
      prefix,
      suffix
    });

    res.json(result);
  } catch (error) {
    console.error('AI suggestions error:', error);
    if (error.message === 'AI service is not configured') {
      return res.status(503).json({ error: 'AI service is not configured', enabled: false });
    }
    res.status(500).json({ error: 'Failed to get suggestions' });
  }
});

router.post('/:roomId/explain', authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { code, language, selectedCode } = req.body;

    if (!code && !selectedCode) {
      return res.status(400).json({ error: 'code or selectedCode is required' });
    }

    const room = roomService.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!room.users.has(req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await aiService.explainCode({
      code: code || '',
      language,
      selectedCode
    });

    res.json(result);
  } catch (error) {
    console.error('AI explain error:', error);
    if (error.message === 'AI service is not configured') {
      return res.status(503).json({ error: 'AI service is not configured', enabled: false });
    }
    res.status(500).json({ error: 'Failed to explain code' });
  }
});

router.post('/:roomId/detect-bugs', authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { code, language } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'code is required' });
    }

    const room = roomService.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!room.users.has(req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await aiService.detectBugs({
      code,
      language
    });

    res.json(result);
  } catch (error) {
    console.error('AI bug detection error:', error);
    if (error.message === 'AI service is not configured') {
      return res.status(503).json({ error: 'AI service is not configured', enabled: false });
    }
    res.status(500).json({ error: 'Failed to detect bugs' });
  }
});

router.post('/:roomId/refactor', authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { code, language } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'code is required' });
    }

    const room = roomService.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!room.users.has(req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await aiService.refactorSuggestions({
      code,
      language
    });

    res.json(result);
  } catch (error) {
    console.error('AI refactor error:', error);
    if (error.message === 'AI service is not configured') {
      return res.status(503).json({ error: 'AI service is not configured', enabled: false });
    }
    res.status(500).json({ error: 'Failed to get refactor suggestions' });
  }
});

module.exports = router;
