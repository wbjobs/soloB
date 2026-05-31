import asyncio
import json
import websockets
import os
import sys
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from simulation.solver import FluidSolver

solver = FluidSolver(nx=32, ny=32, nz=32, dx=1.0, dt=0.02, nu=0.05, rho=1.0)
step_count = 0
connected_clients = set()

async def simulate_and_broadcast():
    global step_count
    while True:
        solver.step()
        step_count += 1
        
        state = {
            'step': step_count,
            'nx': solver.nx,
            'ny': solver.ny,
            'nz': solver.nz,
            'dx': solver.dx,
            'dt': solver.dt,
        }
        
        slice_data = extract_mid_slice(solver)
        state.update(slice_data)
        
        message = json.dumps(state)
        
        if connected_clients:
            await asyncio.gather(
                *[client.send(message) for client in connected_clients]
            )
        
        await asyncio.sleep(0.05)

def extract_mid_slice(solver):
    mid_z = solver.nz // 2
    mid_y = solver.ny // 2
    
    z_slices = [solver.nz // 4, mid_z, 3 * solver.nz // 4]
    
    u_3d = []
    v_3d = []
    w_3d = []
    p_3d = []
    
    for z in z_slices:
        u_3d.append(solver.u[:, :, z].tolist())
        v_3d.append(solver.v[:, :, z].tolist())
        w_3d.append(solver.w[:, :, z].tolist())
        p_3d.append(solver.p[:, :, z].tolist())
    
    u_mid = solver.u[:, :, mid_z]
    v_mid = solver.v[:, :, mid_z]
    w_mid = solver.w[:, :, mid_z]
    
    max_velocity = float(np.max(np.sqrt(u_mid**2 + v_mid**2 + w_mid**2)))
    
    return {
        'slice_z': mid_z,
        'z_slices': z_slices,
        'u_3d': u_3d,
        'v_3d': v_3d,
        'w_3d': w_3d,
        'p_3d': p_3d,
        'u_slice': u_mid.tolist(),
        'v_slice': v_mid.tolist(),
        'w_slice': w_mid.tolist(),
        'p_slice': solver.p[:, :, mid_z].tolist(),
        'max_velocity': max_velocity,
        'centerline_u': u_mid[:, mid_y].tolist()
    }

async def handle_client(websocket):
    print('Client connected')
    connected_clients.add(websocket)
    
    try:
        initial_state = {
            'type': 'init',
            'nx': solver.nx,
            'ny': solver.ny,
            'nz': solver.nz,
            'dx': solver.dx,
            'dt': solver.dt,
        }
        await websocket.send(json.dumps(initial_state))
        
        async for message in websocket:
            data = json.loads(message)
            if data.get('type') == 'reset':
                solver.__init__(
                    nx=solver.nx, ny=solver.ny, nz=solver.nz,
                    dx=solver.dx, dt=solver.dt, nu=solver.nu, rho=solver.rho
                )
                print('Simulation reset')
            elif data.get('type') == 'pause':
                pass
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.remove(websocket)
        print('Client disconnected')

async def main():
    server = await websockets.serve(
        handle_client,
        'localhost',
        8765
    )
    
    print('WebSocket server started on ws://localhost:8765')
    print('Waiting for clients...')
    
    await asyncio.gather(
        server.wait_closed(),
        simulate_and_broadcast()
    )

if __name__ == '__main__':
    asyncio.run(main())
