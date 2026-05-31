const express = require('express');
const axios = require('axios');
const roomService = require('../services/roomService');

const router = express.Router();

const SANDBOX_URL = process.env.SANDBOX_URL || 'http://localhost:3002';

router.post('/execute', async (req, res) => {
  const { language, code, roomId } = req.body;
  const userId = req.user.id;

  if (!roomService.canEdit(roomId, userId)) {
    return res.status(403).json({ error: 'You do not have permission to execute code' });
  }

  if (!['javascript', 'python', 'java'].includes(language)) {
    return res.status(400).json({ error: 'Unsupported language' });
  }

  try {
    const response = await axios.post(`${SANDBOX_URL}/execute`, {
      language,
      code
    });

    res.json(response.data);
  } catch (error) {
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ error: 'Code execution service unavailable' });
    }
  }
});

module.exports = router;
