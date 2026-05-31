import { WebSocketServer, WebSocket } from 'ws';
import { createActor } from 'xstate';
import { v4 as uuidv4 } from 'uuid';
import { IncomingMessage, OutgoingMessage, Player, PlayerState, Direction, Room, Monster, Position } from './types';
import { createPlayerFSM, PlayerFSMEvents } from './playerFSM';
import { isPassable, getNewPosition } from './map';
import { getMonsterNextMove } from './monsterAI';
import {
  getOrCreateRoom,
  getRoom,
  getRooms,
  addPlayerToRoom,
  removePlayer,
  getPlayerConnection,
  getConnection,
  getConnections,
} from './roomManager';

const wss = new WebSocketServer({ port: 8080 });

interface PlayerStateMachine {
  actor: ReturnType<typeof createActor<any>>;
  currentState: PlayerState;
}

const playerStateMachines = new Map<string, PlayerStateMachine>();

const getPositionKey = (roomId: string, x: number, y: number): string => {
  return `${roomId}:${x}:${y}`;
};

const positionLocks = new Map<string, string>();

const tryLockPosition = (roomId: string, x: number, y: number, playerId: string): boolean => {
  const key = getPositionKey(roomId, x, y);
  if (positionLocks.has(key)) {
    return false;
  }
  positionLocks.set(key, playerId);
  return true;
};

const unlockPosition = (roomId: string, x: number, y: number, playerId: string): boolean => {
  const key = getPositionKey(roomId, x, y);
  if (positionLocks.get(key) === playerId) {
    positionLocks.delete(key);
    return true;
  }
  return false;
};

const isPositionLockedByOthers = (roomId: string, x: number, y: number, playerId: string): boolean => {
  const key = getPositionKey(roomId, x, y);
  const lockOwner = positionLocks.get(key);
  return lockOwner !== undefined && lockOwner !== playerId;
};

const releaseAllLocksForPlayer = (playerId: string): void => {
  const keysToDelete: string[] = [];
  for (const [key, ownerId] of positionLocks) {
    if (ownerId === playerId) {
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) {
    positionLocks.delete(key);
  }
};

const generateId = (): string => {
  return uuidv4();
};

const sendMessage = (ws: WebSocket, message: OutgoingMessage): void => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
};

const broadcastToRoom = (roomId: string, message: OutgoingMessage, excludePlayerId?: string): void => {
  const room = getRoom(roomId);
  if (!room) return;
  
  for (const [playerId] of room.players) {
    if (excludePlayerId && playerId === excludePlayerId) continue;
    const connection = getConnection(playerId);
    if (connection && connection.ws.readyState === WebSocket.OPEN) {
      sendMessage(connection.ws, message);
    }
  }
};

const handleJoin = (ws: WebSocket, data: { roomId: string; playerName: string }): void => {
  const playerId = generateId();
  
  const existingConnection = getPlayerConnection(ws);
  if (existingConnection) {
    sendMessage(ws, { type: 'error', message: 'You are already in a room. Leave first.' });
    return;
  }
  
  const player = addPlayerToRoom(data.roomId, playerId, data.playerName, ws);
  const room = getOrCreateRoom(data.roomId);
  
  const fsm = createPlayerFSM(playerId);
  const actor = createActor(fsm);
  actor.start();
  
  playerStateMachines.set(playerId, {
    actor,
    currentState: 'idle',
  });
  
  actor.subscribe((state: any) => {
    const stateMachine = playerStateMachines.get(playerId);
    if (stateMachine) {
      stateMachine.currentState = state.value as PlayerState;
    }
  });
  
  const roomPlayers = Array.from(room.players.values());
  const roomMonsters = Array.from(room.monsters.values());
  
  sendMessage(ws, {
    type: 'roomJoined',
    roomId: data.roomId,
    playerId,
    map: room.map,
    players: roomPlayers,
    monsters: roomMonsters,
  });
  
  broadcastToRoom(data.roomId, {
    type: 'playerJoined',
    player,
  }, playerId);
  
  console.log(`Player ${playerId} (${data.playerName}) joined room ${data.roomId}`);
};

const handleMove = (ws: WebSocket, direction: Direction): void => {
  const connection = getPlayerConnection(ws);
  if (!connection) {
    sendMessage(ws, { type: 'error', message: 'You are not in a room.' });
    return;
  }
  
  const { player, roomId } = connection;
  const room = getRoom(roomId);
  const stateMachine = playerStateMachines.get(player.id);
  
  if (!room || !stateMachine) {
    sendMessage(ws, { type: 'error', message: 'Room or state machine not found.' });
    return;
  }
  
  if (stateMachine.currentState !== 'idle') {
    sendMessage(ws, { type: 'error', message: 'Cannot move right now. You are ' + stateMachine.currentState });
    return;
  }
  
  const newPosition = getNewPosition(player.position, direction);
  
  if (!isPassable(room.map, newPosition)) {
    sendMessage(ws, { type: 'error', message: 'Cannot move to that position.' });
    return;
  }
  
  if (isPositionLockedByOthers(roomId, newPosition.x, newPosition.y, player.id)) {
    sendMessage(ws, { type: 'error', message: 'That position is currently occupied or being moved to.' });
    return;
  }
  
  for (const [otherId, otherPlayer] of room.players) {
    if (otherId !== player.id && otherPlayer.position.x === newPosition.x && otherPlayer.position.y === newPosition.y) {
      sendMessage(ws, { type: 'error', message: 'Another player is already there.' });
      return;
    }
  }
  
  for (const [, monster] of room.monsters) {
    if (monster.position.x === newPosition.x && monster.position.y === newPosition.y) {
      sendMessage(ws, { type: 'error', message: 'A monster is already there.' });
      return;
    }
  }
  
  const locked = tryLockPosition(roomId, newPosition.x, newPosition.y, player.id);
  
  if (!locked) {
    sendMessage(ws, { type: 'error', message: 'Cannot move to that position.' });
    return;
  }
  
  try {
    stateMachine.actor.send({ type: 'MOVE', direction } as PlayerFSMEvents);
    
    player.position = newPosition;
    
    setTimeout(() => {
      stateMachine.actor.send({ type: 'MOVE_COMPLETE' } as PlayerFSMEvents);
      unlockPosition(roomId, newPosition.x, newPosition.y, player.id);
    }, 100);
    
    broadcastToRoom(roomId, {
      type: 'playerMoved',
      playerId: player.id,
      newPosition: player.position,
      newState: stateMachine.currentState,
    });
    
    console.log(`Player ${player.id} moved ${direction} to (${newPosition.x}, ${newPosition.y})`);
  } catch (error) {
    unlockPosition(roomId, newPosition.x, newPosition.y, player.id);
    console.error('Error during move:', error);
    sendMessage(ws, { type: 'error', message: 'An error occurred while moving.' });
  }
};

const handleAttack = (ws: WebSocket, targetId: string): void => {
  const connection = getPlayerConnection(ws);
  if (!connection) {
    sendMessage(ws, { type: 'error', message: 'You are not in a room.' });
    return;
  }
  
  const { player, roomId } = connection;
  const room = getRoom(roomId);
  const stateMachine = playerStateMachines.get(player.id);
  
  if (!room || !stateMachine) {
    sendMessage(ws, { type: 'error', message: 'Room or state machine not found.' });
    return;
  }
  
  if (stateMachine.currentState !== 'idle') {
    sendMessage(ws, { type: 'error', message: 'Cannot attack right now. You are ' + stateMachine.currentState });
    return;
  }
  
  const target = room.players.get(targetId);
  if (!target) {
    sendMessage(ws, { type: 'error', message: 'Target player not found.' });
    return;
  }
  
  const dx = Math.abs(player.position.x - target.position.x);
  const dy = Math.abs(player.position.y - target.position.y);
  if (dx > 1 || dy > 1 || (dx === 0 && dy === 0)) {
    sendMessage(ws, { type: 'error', message: 'Target is too far away.' });
    return;
  }
  
  stateMachine.actor.send({ type: 'ATTACK', targetId } as PlayerFSMEvents);
  
  const damage = Math.floor(Math.random() * 20) + 10;
  target.hp = Math.max(0, target.hp - damage);
  
  setTimeout(() => {
    stateMachine.actor.send({ type: 'ATTACK_COMPLETE' } as PlayerFSMEvents);
  }, 200);
  
  broadcastToRoom(roomId, {
    type: 'playerAttacked',
    attackerId: player.id,
    targetId,
    damage,
  });
  
  console.log(`Player ${player.id} attacked ${targetId} for ${damage} damage. ${targetId} HP: ${target.hp}`);
};

const handleLeave = (ws: WebSocket): void => {
  const connection = getPlayerConnection(ws);
  if (!connection) {
    return;
  }
  
  const { player, roomId } = connection;
  const result = removePlayer(player.id);
  
  if (result) {
    playerStateMachines.delete(player.id);
    releaseAllLocksForPlayer(player.id);
    
    broadcastToRoom(roomId, {
      type: 'playerLeft',
      playerId: player.id,
    });
    
    console.log(`Player ${player.id} (${player.name}) left room ${roomId}`);
  }
};

const handleMessage = (ws: WebSocket, data: string): void => {
  try {
    const message = JSON.parse(data) as IncomingMessage;
    
    switch (message.type) {
      case 'join':
        handleJoin(ws, { roomId: message.roomId, playerName: message.playerName });
        break;
      case 'move':
        handleMove(ws, message.direction);
        break;
      case 'attack':
        handleAttack(ws, message.targetId);
        break;
      case 'leave':
        handleLeave(ws);
        break;
      default:
        sendMessage(ws, { type: 'error', message: 'Unknown message type.' });
    }
  } catch (e) {
    sendMessage(ws, { type: 'error', message: 'Invalid message format.' });
  }
};

const isMonsterPositionBlocked = (
  room: Room,
  monsterId: string,
  position: Position
): boolean => {
  for (const [, player] of room.players) {
    if (player.position.x === position.x && player.position.y === position.y) {
      return true;
    }
  }
  
  for (const [otherMonsterId, otherMonster] of room.monsters) {
    if (otherMonsterId !== monsterId && 
        otherMonster.position.x === position.x && 
        otherMonster.position.y === position.y) {
      return true;
    }
  }
  
  return false;
};

const updateMonstersInRoom = (room: Room): void => {
  if (room.players.size === 0) {
    return;
  }
  
  const movedMonsters: { monster: Monster; oldPosition: Position }[] = [];
  
  for (const [, monster] of room.monsters) {
    const nextPosition = getMonsterNextMove(room, monster);
    
    if (nextPosition && !isMonsterPositionBlocked(room, monster.id, nextPosition)) {
      movedMonsters.push({
        monster,
        oldPosition: { ...monster.position },
      });
      monster.position = nextPosition;
    }
  }
  
  if (movedMonsters.length > 0) {
    const monstersList = Array.from(room.monsters.values());
    
    broadcastToRoom(room.id, {
      type: 'monstersUpdated',
      monsters: monstersList,
    });
  }
};

const gameTick = (): void => {
  const rooms = getRooms();
  
  for (const [, room] of rooms) {
    updateMonstersInRoom(room);
  }
};

const TICK_INTERVAL_MS = 100;
let gameTickInterval: NodeJS.Timeout | null = null;

const startGameLoop = (): void => {
  if (gameTickInterval) {
    return;
  }
  
  gameTickInterval = setInterval(() => {
    try {
      gameTick();
    } catch (error) {
      console.error('Error in game tick:', error);
    }
  }, TICK_INTERVAL_MS);
  
  console.log(`Game loop started with ${1000 / TICK_INTERVAL_MS} ticks per second`);
};

const stopGameLoop = (): void => {
  if (gameTickInterval) {
    clearInterval(gameTickInterval);
    gameTickInterval = null;
    console.log('Game loop stopped');
  }
};

startGameLoop();

process.on('SIGINT', () => {
  console.log('Stopping server...');
  stopGameLoop();
  wss.close(() => {
    process.exit(0);
  });
});

wss.on('connection', (ws: WebSocket) => {
  console.log('New client connected');
  
  ws.on('message', (data: Buffer) => {
    handleMessage(ws, data.toString());
  });
  
  ws.on('close', () => {
    handleLeave(ws);
    console.log('Client disconnected');
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

console.log('Roguelike server started on ws://localhost:8080');
