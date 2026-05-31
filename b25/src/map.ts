import { GameMap, Position, TileType } from './types';

export const createGameMap = (width: number, height: number): GameMap => {
  const tiles: TileType[][] = [];
  
  for (let y = 0; y < height; y++) {
    const row: TileType[] = [];
    for (let x = 0; x < width; x++) {
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        row.push('wall');
      } else {
        row.push('floor');
      }
    }
    tiles.push(row);
  }
  
  return { width, height, tiles };
};

export const isPassable = (map: GameMap, position: Position): boolean => {
  if (position.x < 0 || position.x >= map.width || position.y < 0 || position.y >= map.height) {
    return false;
  }
  return map.tiles[position.y][position.x] !== 'wall';
};

export const getNewPosition = (current: Position, direction: 'up' | 'down' | 'left' | 'right'): Position => {
  switch (direction) {
    case 'up':
      return { x: current.x, y: current.y - 1 };
    case 'down':
      return { x: current.x, y: current.y + 1 };
    case 'left':
      return { x: current.x - 1, y: current.y };
    case 'right':
      return { x: current.x + 1, y: current.y };
    default:
      return current;
  }
};
