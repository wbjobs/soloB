const { v4: uuidv4 } = require('uuid');

const rooms = new Map();
const userRoomMap = new Map();

const ROLES = {
  OWNER: 'owner',
  EDITOR: 'editor',
  VIEWER: 'viewer'
};

const generateId = () => Math.random().toString(36).substr(2, 8).toUpperCase();

const createRoom = (userId, roomName = 'New Room', password = null) => {
  const roomId = generateId();
  const room = {
    id: roomId,
    name: roomName,
    ownerId: userId,
    password: password,
    createdAt: Date.now(),
    users: new Map(),
    cursors: new Map(),
    files: new Map(),
    structure: {
      id: 'root',
      name: 'root',
      type: 'folder',
      children: []
    }
  };

  addUserToRoom(room, userId, ROLES.OWNER);
  rooms.set(roomId, room);

  return {
    id: room.id,
    name: room.name,
    createdAt: room.createdAt,
    role: ROLES.OWNER
  };
};

const joinRoom = (roomId, userId, password = null) => {
  const room = rooms.get(roomId);
  if (!room) {
    return { error: 'Room not found' };
  }

  if (room.password && room.password !== password) {
    return { error: 'Invalid password' };
  }

  if (room.users.has(userId)) {
    const user = room.users.get(userId);
    return {
      id: room.id,
      name: room.name,
      createdAt: room.createdAt,
      role: user.role
    };
  }

  const role = ROLES.VIEWER;
  addUserToRoom(room, userId, role);

  return {
    id: room.id,
    name: room.name,
    createdAt: room.createdAt,
    role
  };
};

const addUserToRoom = (room, userId, role) => {
  room.users.set(userId, {
    id: userId,
    role,
    joinedAt: Date.now(),
    color: getRandomColor()
  });
  userRoomMap.set(userId, room.id);
};

const getRandomColor = () => {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
    '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
    '#BB8FCE', '#85C1E9', '#F8B500', '#00CED1'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
};

const leaveRoom = (roomId, userId) => {
  const room = rooms.get(roomId);
  if (!room) return;

  room.users.delete(userId);
  room.cursors.delete(userId);
  userRoomMap.delete(userId);

  if (room.users.size === 0) {
    rooms.delete(roomId);
    return { roomDeleted: true };
  }

  return { roomDeleted: false };
};

const getRoom = (roomId) => {
  return rooms.get(roomId);
};

const getUserRole = (roomId, userId) => {
  const room = rooms.get(roomId);
  if (!room) return null;
  const user = room.users.get(userId);
  return user ? user.role : null;
};

const setUserRole = (roomId, ownerId, targetUserId, newRole) => {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  const owner = room.users.get(ownerId);
  if (!owner || owner.role !== ROLES.OWNER) {
    return { error: 'Only owner can change roles' };
  }

  if (![ROLES.EDITOR, ROLES.VIEWER].includes(newRole)) {
    return { error: 'Invalid role' };
  }

  const targetUser = room.users.get(targetUserId);
  if (!targetUser) {
    return { error: 'User not in room' };
  }

  targetUser.role = newRole;
  return { success: true, role: newRole };
};

const canEdit = (roomId, userId) => {
  const role = getUserRole(roomId, userId);
  return role === ROLES.OWNER || role === ROLES.EDITOR;
};

const getRoomUsers = (roomId) => {
  const room = rooms.get(roomId);
  if (!room) return [];

  return Array.from(room.users.values()).map(u => ({
    id: u.id,
    role: u.role,
    color: u.color
  }));
};

const getRoomCursors = (roomId) => {
  const room = rooms.get(roomId);
  if (!room) return [];

  return Array.from(room.cursors.entries()).map(([userId, cursor]) => ({
    userId,
    ...cursor,
    color: room.users.get(userId)?.color
  }));
};

const updateCursor = (roomId, userId, cursorData) => {
  const room = rooms.get(roomId);
  if (!room) return;

  room.cursors.set(userId, cursorData);
};

const listUserRooms = (userId) => {
  const userRooms = [];
  rooms.forEach((room, roomId) => {
    if (room.users.has(userId)) {
      const user = room.users.get(userId);
      userRooms.push({
        id: roomId,
        name: room.name,
        role: user.role,
        userCount: room.users.size
      });
    }
  });
  return userRooms;
};

module.exports = {
  ROLES,
  createRoom,
  joinRoom,
  leaveRoom,
  getRoom,
  getUserRole,
  setUserRole,
  canEdit,
  getRoomUsers,
  getRoomCursors,
  updateCursor,
  listUserRooms
};
