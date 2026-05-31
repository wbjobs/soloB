const express = require('express');
const roomService = require('../services/roomService');
const fileService = require('../services/fileService');

const router = express.Router();

router.post('/', (req, res) => {
  const { name, password } = req.body;
  const userId = req.user.id;

  const result = roomService.createRoom(userId, name || 'New Room', password);

  const room = roomService.getRoom(result.id);
  fileService.createFile(room, 'root', 'main.js', 'file', '// Welcome to Collaborative Editor!');
  fileService.createFile(room, 'root', 'README.md', 'file', '# Collaborative Code Editor\n\nEdit together in real-time!');

  res.status(201).json(result);
});

router.post('/join', (req, res) => {
  const { roomId, password } = req.body;
  const userId = req.user.id;

  const result = roomService.joinRoom(roomId, userId, password);

  if (result.error) {
    return res.status(400).json(result);
  }

  res.json(result);
});

router.get('/my-rooms', (req, res) => {
  const userId = req.user.id;
  const rooms = roomService.listUserRooms(userId);
  res.json(rooms);
});

router.get('/:roomId', (req, res) => {
  const { roomId } = req.params;
  const userId = req.user.id;

  const room = roomService.getRoom(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const role = roomService.getUserRole(roomId, userId);
  if (!role) {
    return res.status(403).json({ error: 'Not a member of this room' });
  }

  res.json({
    id: room.id,
    name: room.name,
    role,
    hasPassword: !!room.password,
    users: roomService.getRoomUsers(roomId)
  });
});

router.get('/:roomId/structure', (req, res) => {
  const { roomId } = req.params;
  const userId = req.user.id;

  const room = roomService.getRoom(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const role = roomService.getUserRole(roomId, userId);
  if (!role) {
    return res.status(403).json({ error: 'Not a member of this room' });
  }

  res.json({ structure: fileService.getStructure(room) });
});

router.post('/:roomId/role', (req, res) => {
  const { roomId } = req.params;
  const { targetUserId, role } = req.body;
  const ownerId = req.user.id;

  const result = roomService.setUserRole(roomId, ownerId, targetUserId, role);

  if (result.error) {
    return res.status(400).json(result);
  }

  res.json(result);
});

module.exports = router;
