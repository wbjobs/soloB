import express from 'express';
import bcrypt from 'bcryptjs';
import Room from '../models/Room';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { name, password, hostId } = req.body;
    
    if (!name || !password || !hostId) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const room = new Room({
      name,
      passwordHash,
      hostId,
      participants: []
    });

    await room.save();

    res.json({ success: true, roomId: room._id, roomName: room.name });
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/:roomId', async (req, res) => {
  try {
    const room = await Room.findById(req.params.roomId);
    
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    res.json({
      id: room._id,
      name: room.name,
      participants: room.participants,
      hasVoiceprintLock: room.hasVoiceprintLock
    });
  } catch (error) {
    console.error('Get room error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/:roomId/verify', async (req, res) => {
  try {
    const { password } = req.body;
    const room = await Room.findById(req.params.roomId);
    
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    const isValid = await bcrypt.compare(password, room.passwordHash);
    
    res.json({ valid: isValid });
  } catch (error) {
    console.error('Verify room error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;
