import { Monster, Room, Position, Direction, Player } from './types';
import { isPassable, getNewPosition } from './map';

const getDistance = (a: Position, b: Position): number => {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
};

const getRandomDirection = (): Direction => {
  const directions: Direction[] = ['up', 'down', 'left', 'right'];
  return directions[Math.floor(Math.random() * directions.length)];
};

const getPassableNeighbors = (
  room: Room,
  position: Position,
  excludeMonsterId: string
): { position: Position; direction: Direction }[] => {
  const neighbors: { position: Position; direction: Direction }[] = [];
  const directions: Direction[] = ['up', 'down', 'left', 'right'];
  
  for (const direction of directions) {
    const newPos = getNewPosition(position, direction);
    
    if (!isPassable(room.map, newPos)) {
      continue;
    }
    
    const hasPlayer = Array.from(room.players.values()).some(
      p => p.position.x === newPos.x && p.position.y === newPos.y
    );
    if (hasPlayer) {
      continue;
    }
    
    const hasMonster = Array.from(room.monsters.values()).some(
      m => m.id !== excludeMonsterId && m.position.x === newPos.x && m.position.y === newPos.y
    );
    if (hasMonster) {
      continue;
    }
    
    neighbors.push({ position: newPos, direction });
  }
  
  return neighbors;
};

const findNearestPlayer = (room: Room, monster: Monster): Player | null => {
  let nearest: Player | null = null;
  let minDistance = Infinity;
  
  for (const [, player] of room.players) {
    const distance = getDistance(monster.position, player.position);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = player;
    }
  }
  
  return nearest;
};

export const getRandomMove = (room: Room, monster: Monster): Position | null => {
  const neighbors = getPassableNeighbors(room, monster.position, monster.id);
  
  if (neighbors.length === 0) {
    return null;
  }
  
  if (Math.random() < 0.3) {
    return null;
  }
  
  const chosen = neighbors[Math.floor(Math.random() * neighbors.length)];
  return chosen.position;
};

export const getChaseMove = (room: Room, monster: Monster): Position | null => {
  const target = findNearestPlayer(room, monster);
  if (!target) {
    return getRandomMove(room, monster);
  }
  
  const distance = getDistance(monster.position, target.position);
  
  if (distance <= 1) {
    return null;
  }
  
  const neighbors = getPassableNeighbors(room, monster.position, monster.id);
  
  if (neighbors.length === 0) {
    return null;
  }
  
  let bestMove: Position | null = null;
  let bestDistance = distance;
  
  for (const { position } of neighbors) {
    const newDistance = getDistance(position, target.position);
    if (newDistance < bestDistance) {
      bestDistance = newDistance;
      bestMove = position;
    }
  }
  
  return bestMove;
};

export const getMonsterNextMove = (room: Room, monster: Monster): Position | null => {
  switch (monster.aiType) {
    case 'random':
      return getRandomMove(room, monster);
    case 'chase':
      return getChaseMove(room, monster);
    default:
      return getRandomMove(room, monster);
  }
};
