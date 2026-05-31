import { Room, Player, Monster, MonsterAIType, Position } from './types';
import { createGameMap, isPassable } from './map';
import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';

interface PlayerConnection {
  player: Player;
  ws: WebSocket;
  roomId: string;
}

const rooms = new Map<string, Room>();
const connections = new Map<string, PlayerConnection>();

const getRandomPassablePosition = (room: Room, excludePositions: Position[] = []): Position | null => {
  const { map } = room;
  const candidates: Position[] = [];
  
  for (let y = 1; y < map.height - 1; y++) {
    for (let x = 1; x < map.width - 1; x++) {
      const pos = { x, y };
      if (isPassable(map, pos)) {
        const isExcluded = excludePositions.some(ep => ep.x === pos.x && ep.y === pos.y);
        const hasPlayer = Array.from(room.players.values()).some(p => p.position.x === pos.x && p.position.y === pos.y);
        const hasMonster = Array.from(room.monsters.values()).some(m => m.position.x === pos.x && m.position.y === pos.y);
        
        if (!isExcluded && !hasPlayer && !hasMonster) {
          candidates.push(pos);
        }
      }
    }
  }
  
  if (candidates.length === 0) {
    return null;
  }
  
  return candidates[Math.floor(Math.random() * candidates.length)];
};

const createMonster = (room: Room, aiType: MonsterAIType, excludePositions: Position[] = []): Monster | null => {
  const position = getRandomPassablePosition(room, excludePositions);
  if (!position) {
    return null;
  }
  
  const monster: Monster = {
    id: uuidv4(),
    name: aiType === 'chase' ? 'Hunter' : 'Wanderer',
    position,
    hp: 50,
    maxHp: 50,
    aiType,
  };
  
  return monster;
};

const populateRoomWithMonsters = (room: Room): void => {
  const numMonsters = 3;
  const placedPositions: Position[] = [];
  
  for (let i = 0; i < numMonsters; i++) {
    const aiType: MonsterAIType = i % 2 === 0 ? 'random' : 'chase';
    const monster = createMonster(room, aiType, placedPositions);
    if (monster) {
      room.monsters.set(monster.id, monster);
      placedPositions.push(monster.position);
    }
  }
};

export const getOrCreateRoom = (roomId: string): Room => {
  if (!rooms.has(roomId)) {
    const room: Room = {
      id: roomId,
      name: `Room ${roomId}`,
      map: createGameMap(15, 15),
      players: new Map(),
      monsters: new Map(),
    };
    
    populateRoomWithMonsters(room);
    rooms.set(roomId, room);
  }
  return rooms.get(roomId)!;
};

export const getRoom = (roomId: string): Room | undefined => {
  return rooms.get(roomId);
};

export const getRooms = (): Map<string, Room> => {
  return rooms;
};

export const getPlayerConnection = (ws: WebSocket): PlayerConnection | undefined => {
  for (const [id, conn] of connections) {
    if (conn.ws === ws) {
      return conn;
    }
  }
  return undefined;
};

export const addPlayerToRoom = (
  roomId: string,
  playerId: string,
  playerName: string,
  ws: WebSocket
): Player => {
  const room = getOrCreateRoom(roomId);
  
  const position = getRandomPassablePosition(room);
  if (!position) {
    throw new Error('No available positions in the room');
  }
  
  const player: Player = {
    id: playerId,
    name: playerName,
    position,
    hp: 100,
    maxHp: 100,
  };
  
  room.players.set(playerId, player);
  
  connections.set(playerId, {
    player,
    ws,
    roomId,
  });
  
  return player;
};

export const removePlayer = (playerId: string): { roomId: string; player: Player } | null => {
  const connection = connections.get(playerId);
  if (!connection) {
    return null;
  }
  
  const { player, roomId } = connection;
  const room = rooms.get(roomId);
  
  if (room) {
    room.players.delete(playerId);
    
    if (room.players.size === 0) {
      rooms.delete(roomId);
    }
  }
  
  connections.delete(playerId);
  
  return { roomId, player };
};

export const getConnection = (playerId: string): PlayerConnection | undefined => {
  return connections.get(playerId);
};

export const getConnections = (): Map<string, PlayerConnection> => {
  return connections;
};
