import asyncio
import websockets
import json
from typing import Dict, Tuple, Optional, List

GRID_SIZE = 16

DIRECTIONS = [
    (0, 1, 0),   # up
    (0, -1, 0),  # down
    (1, 0, 0),   # east
    (-1, 0, 0),  # west
    (0, 0, 1),   # south
    (0, 0, -1)   # north
]

def get_opposite_direction(direction):
    dx, dy, dz = direction
    return (-dx, -dy, -dz)

def get_direction_from_rotation(rotation: int):
    directions = [
        (0, 0, -1),  # 0: north
        (1, 0, 0),   # 1: east
        (0, 0, 1),   # 2: south
        (-1, 0, 0)   # 3: west
    ]
    return directions[rotation % 4]

class RedstoneSimulator:
    def __init__(self):
        self.grid: Dict[Tuple[int, int, int], dict] = {}
        self.tick = 0
        self.grid_size = GRID_SIZE
        
    def set_block(self, x: int, y: int, z: int, block_type: str, rotation: int = 0, delay: int = 1, powered: bool = False, subtract: bool = False):
        if 0 <= x < self.grid_size and 0 <= y < self.grid_size and 0 <= z < self.grid_size:
            if block_type == 'air':
                if (x, y, z) in self.grid:
                    del self.grid[(x, y, z)]
            else:
                self.grid[(x, y, z)] = {
                    'type': block_type,
                    'rotation': rotation,
                    'delay': delay,
                    'powered': powered,
                    'subtract': subtract,
                    'signal': 0,
                    'locked': False,
                    'output_signal': 0,
                    'delay_counter': 0,
                    'input_signal': 0,
                    'side_signal': 0,
                    'was_locked': False
                }
    
    def get_block(self, x: int, y: int, z: int) -> Optional[dict]:
        return self.grid.get((x, y, z))
    
    def is_solid_block(self, x: int, y: int, z: int) -> bool:
        block = self.get_block(x, y, z)
        return block is not None and block['type'] in ['block', 'piston']
    
    def can_conduct(self, x: int, y: int, z: int) -> bool:
        block = self.get_block(x, y, z)
        if block is None:
            return False
        return block['type'] in ['redstone', 'block', 'piston']
    
    def calculate_redstone_signal(self, x: int, y: int, z: int) -> int:
        max_signal = 0
        
        for dx, dy, dz in DIRECTIONS:
            nx, ny, nz = x + dx, y + dy, z + dz
            neighbor = self.get_block(nx, ny, nz)
            
            if neighbor is None:
                continue
            
            if neighbor['type'] == 'redstone':
                max_signal = max(max_signal, neighbor.get('signal', 0) - 1)
            
            elif neighbor['type'] in ['repeater', 'comparator']:
                input_dir = get_direction_from_rotation(neighbor['rotation'])
                input_dir = get_opposite_direction(input_dir)
                if (dx, dy, dz) == input_dir:
                    continue
                output_dir = get_direction_from_rotation(neighbor['rotation'])
                if (dx, dy, dz) == output_dir:
                    max_signal = max(max_signal, neighbor.get('output_signal', 0))
            
            elif neighbor['type'] == 'torch':
                if (dx, dy, dz) != (0, -1, 0):
                    max_signal = max(max_signal, 15 if neighbor.get('signal', 0) > 0 else 0)
            
            elif neighbor['type'] == 'lever':
                if neighbor.get('powered', False):
                    max_signal = max(max_signal, 15)
            
            elif neighbor['type'] == 'block':
                block_signal = neighbor.get('signal', 0)
                if block_signal > 0:
                    max_signal = max(max_signal, block_signal - 1)
                
                for dx2, dy2, dz2 in DIRECTIONS:
                    torch_x, torch_y, torch_z = nx + dx2, ny + dy2, nz + dz2
                    if (dx2, dy2, dz2) == (-dx, -dy, -dz):
                        continue
                    torch = self.get_block(torch_x, torch_y, torch_z)
                    if torch and torch['type'] == 'torch' and torch.get('signal', 0) > 0:
                        max_signal = 15
        
        return max(0, min(15, max_signal))
    
    def calculate_torch_state(self, x: int, y: int, z: int) -> int:
        block = self.get_block(x, y, z)
        if block is None:
            return 0
        
        below = self.get_block(x, y - 1, z)
        if below and below.get('signal', 0) > 0:
            return 0
        
        return 15
    
    def calculate_repeater_state(self, x: int, y: int, z: int) -> Tuple[int, bool]:
        block = self.get_block(x, y, z)
        if block is None:
            return (0, False)
        
        rotation = block['rotation']
        delay = block.get('delay', 1)
        
        input_dir = get_opposite_direction(get_direction_from_rotation(rotation))
        dx, dy, dz = input_dir
        input_x, input_y, input_z = x + dx, y + dy, z + dz
        
        input_signal = 0
        input_block = self.get_block(input_x, input_y, input_z)
        
        if input_block:
            if input_block['type'] == 'redstone':
                input_signal = input_block.get('signal', 0)
            elif input_block['type'] == 'block':
                input_signal = input_block.get('signal', 0)
            elif input_block['type'] in ['repeater', 'comparator']:
                input_signal = input_block.get('output_signal', 0)
            elif input_block['type'] == 'torch':
                input_signal = input_block.get('signal', 0)
            elif input_block['type'] == 'lever':
                input_signal = 15 if input_block.get('powered', False) else 0
        
        side_signal = 0
        side_dirs = []
        if rotation in [0, 2]:
            side_dirs = [(1, 0, 0), (-1, 0, 0)]
        else:
            side_dirs = [(0, 0, 1), (0, 0, -1)]
        
        for dx, dy, dz in side_dirs:
            side_x, side_y, side_z = x + dx, y + dy, z + dz
            side_block = self.get_block(side_x, side_y, side_z)
            if side_block and side_block['type'] in ['repeater']:
                side_dir = get_direction_from_rotation(side_block['rotation'])
                if (dx, dy, dz) == side_dir:
                    side_signal = max(side_signal, side_block.get('output_signal', 0))
        
        locked = side_signal > 0
        was_locked = block.get('was_locked', False)
        output_signal = block.get('output_signal', 0)
        
        if not was_locked and locked:
            block['locked_output'] = output_signal
        elif was_locked and not locked:
            if 'locked_output' in block:
                del block['locked_output']
        
        if locked:
            output_signal = block.get('locked_output', output_signal)
        else:
            input_was_high = block.get('input_signal', 0) > 0
            input_is_high = input_signal > 0
            
            if input_is_high and not input_was_high:
                block['delay_counter'] = delay
            elif not input_is_high and input_was_high:
                block['delay_counter'] = delay
            
            if block.get('delay_counter', 0) > 0:
                block['delay_counter'] -= 1
            
            if block.get('delay_counter', 0) <= 0:
                output_signal = 15 if input_is_high else 0
        
        block['input_signal'] = input_signal
        block['side_signal'] = side_signal
        block['was_locked'] = locked
        
        return (output_signal, locked)
    
    def calculate_comparator_state(self, x: int, y: int, z: int) -> int:
        block = self.get_block(x, y, z)
        if block is None:
            return 0
        
        rotation = block['rotation']
        subtract_mode = block.get('subtract', False)
        
        input_dir = get_opposite_direction(get_direction_from_rotation(rotation))
        dx, dy, dz = input_dir
        input_x, input_y, input_z = x + dx, y + dy, z + dz
        
        input_signal = 0
        input_block = self.get_block(input_x, input_y, input_z)
        
        if input_block:
            if input_block['type'] == 'redstone':
                input_signal = input_block.get('signal', 0)
            elif input_block['type'] == 'block':
                input_signal = input_block.get('signal', 0)
            elif input_block['type'] in ['repeater', 'comparator']:
                input_signal = input_block.get('output_signal', 0)
            elif input_block['type'] == 'lever':
                input_signal = 15 if input_block.get('powered', False) else 0
        
        side_signal = 0
        side_dirs = []
        if rotation in [0, 2]:
            side_dirs = [(1, 0, 0), (-1, 0, 0)]
        else:
            side_dirs = [(0, 0, 1), (0, 0, -1)]
        
        for dx, dy, dz in side_dirs:
            side_x, side_y, side_z = x + dx, y + dy, z + dz
            side_block = self.get_block(side_x, side_y, side_z)
            if side_block and side_block['type'] in ['redstone', 'repeater']:
                if side_block['type'] == 'redstone':
                    side_signal = max(side_signal, side_block.get('signal', 0))
                else:
                    side_dir = get_direction_from_rotation(side_block['rotation'])
                    if (dx, dy, dz) == side_dir:
                        side_signal = max(side_signal, side_block.get('output_signal', 0))
        
        if subtract_mode:
            return max(0, input_signal - side_signal)
        else:
            return input_signal if input_signal >= side_signal else 0
    
    def update_block_signals(self):
        new_signals = {}
        new_outputs = {}
        
        for (x, y, z), block in self.grid.items():
            if block['type'] == 'redstone':
                new_signals[(x, y, z)] = self.calculate_redstone_signal(x, y, z)
            
            elif block['type'] == 'torch':
                new_signals[(x, y, z)] = self.calculate_torch_state(x, y, z)
            
            elif block['type'] == 'block':
                block_signal = 0
                for dx, dy, dz in DIRECTIONS:
                    nx, ny, nz = x + dx, y + dy, z + dz
                    neighbor = self.get_block(nx, ny, nz)
                    if neighbor and neighbor['type'] in ['redstone', 'torch', 'repeater', 'lever']:
                        if neighbor['type'] == 'torch' and (dx, dy, dz) == (0, -1, 0):
                            continue
                        if neighbor['type'] == 'lever' and neighbor.get('powered', False):
                            block_signal = 15
                        elif neighbor['type'] == 'torch':
                            if neighbor.get('signal', 0) > 0:
                                block_signal = 15
                        elif neighbor['type'] == 'repeater':
                            output_dir = get_direction_from_rotation(neighbor['rotation'])
                            if (dx, dy, dz) == output_dir:
                                block_signal = max(block_signal, neighbor.get('output_signal', 0))
                        elif neighbor['type'] == 'redstone':
                            block_signal = max(block_signal, neighbor.get('signal', 0))
                new_signals[(x, y, z)] = block_signal
        
        for (x, y, z), block in self.grid.items():
            if block['type'] == 'repeater':
                output_signal, locked = self.calculate_repeater_state(x, y, z)
                new_outputs[(x, y, z)] = (output_signal, locked)
            
            elif block['type'] == 'comparator':
                new_outputs[(x, y, z)] = (self.calculate_comparator_state(x, y, z), False)
        
        for (x, y, z), signal in new_signals.items():
            if (x, y, z) in self.grid:
                self.grid[(x, y, z)]['signal'] = signal
        
        for (x, y, z), (output, locked) in new_outputs.items():
            if (x, y, z) in self.grid:
                self.grid[(x, y, z)]['output_signal'] = output
                self.grid[(x, y, z)]['locked'] = locked
    
    def step(self) -> List[dict]:
        self.update_block_signals()
        self.tick += 1
        
        signals = []
        for (x, y, z), block in self.grid.items():
            signal = block.get('signal', 0)
            if block['type'] in ['repeater', 'comparator']:
                signal = block.get('output_signal', 0)
            signals.append({
                'x': x,
                'y': y,
                'z': z,
                'signal': signal
            })
        
        return signals
    
    def reset(self):
        self.tick = 0
        for block in self.grid.values():
            block['signal'] = 0
            block['output_signal'] = 0
            block['delay_counter'] = 0
            block['input_signal'] = 0
            block['side_signal'] = 0
            block['locked'] = False
            block['was_locked'] = False
            if 'locked_output' in block:
                del block['locked_output']

simulator = RedstoneSimulator()

async def handle_connection(websocket):
    print("Client connected")
    try:
        async for message in websocket:
            data = json.loads(message)
            
            if data['type'] == 'init':
                simulator.grid_size = data.get('grid_size', GRID_SIZE)
                for block in data.get('blocks', []):
                    simulator.set_block(
                        block['x'], block['y'], block['z'],
                        block['type'],
                        block.get('rotation', 0),
                        block.get('delay', 1),
                        block.get('powered', False),
                        block.get('subtract', False)
                    )
            
            elif data['type'] == 'block_change':
                x, y, z = data['x'], data['y'], data['z']
                block_type = data['block_type']
                action = data['action']
                
                if action in ['place', 'remove']:
                    existing = simulator.get_block(x, y, z)
                    rotation = existing.get('rotation', 0) if existing else data.get('rotation', 0)
                    delay = existing.get('delay', 1) if existing else data.get('delay', 1)
                    powered = existing.get('powered', False) if existing else data.get('powered', False)
                    subtract = existing.get('subtract', False) if existing else data.get('subtract', False)
                    simulator.set_block(x, y, z, block_type, rotation, delay, powered, subtract)
                
                elif action == 'rotate':
                    block = simulator.get_block(x, y, z)
                    if block:
                        block['rotation'] = data['rotation']
                
                elif action == 'toggle':
                    block = simulator.get_block(x, y, z)
                    if block:
                        block['powered'] = data['powered']
                
                elif action == 'delay':
                    block = simulator.get_block(x, y, z)
                    if block:
                        block['delay'] = data['rotation']
                
                elif action == 'mode':
                    block = simulator.get_block(x, y, z)
                    if block:
                        block['subtract'] = not block.get('subtract', False)
            
            elif data['type'] == 'step':
                signals = simulator.step()
                await websocket.send(json.dumps({
                    'type': 'tick',
                    'tick': simulator.tick,
                    'signals': signals
                }))
            
            elif data['type'] == 'reset':
                simulator.reset()
                
    except websockets.exceptions.ConnectionClosed:
        print("Client disconnected")
    except Exception as e:
        print(f"Error: {e}")

async def main():
    async with websockets.serve(handle_connection, "localhost", 8765):
        print("Redstone simulator server started on ws://localhost:8765")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
