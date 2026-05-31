export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Position {
  x: number;
  y: number;
}

export type TileType = 'floor' | 'wall';

export type PlayerState = 'idle' | 'moving' | 'attacking';

export type MonsterAIType = 'random' | 'chase';

export interface Monster {
  id: string;
  name: string;
  position: Position;
  hp: number;
  maxHp: number;
  aiType: MonsterAIType;
}

export interface Player {
  id: string;
  name: string;
  position: Position;
  hp: number;
  maxHp: number;
}

export interface GameMap {
  width: number;
  height: number;
  tiles: TileType[][];
}

export interface Room {
  id: string;
  name: string;
  map: GameMap;
  players: Map<string, Player>;
  monsters: Map<string, Monster>;
}

export type IncomingMessage = 
  | { type: 'join'; roomId: string; playerName: string }
  | { type: 'move'; direction: Direction }
  | { type: 'attack'; targetId: string }
  | { type: 'leave' };

export type OutgoingMessage =
  | { type: 'roomJoined'; roomId: string; playerId: string; map: GameMap; players: Player[]; monsters: Monster[] }
  | { type: 'playerJoined'; player: Player }
  | { type: 'playerMoved'; playerId: string; newPosition: Position; newState: PlayerState }
  | { type: 'playerAttacked'; attackerId: string; targetId: string; damage: number }
  | { type: 'playerLeft'; playerId: string }
  | { type: 'monsterMoved'; monsterId: string; newPosition: Position }
  | { type: 'monstersUpdated'; monsters: Monster[] }
  | { type: 'monsterAttacked'; monsterId: string; targetId: string; damage: number }
  | { type: 'error'; message: string };
