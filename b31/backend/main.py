import asyncio
import json
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List
from wave_generator import WaveGenerator

app = FastAPI(title="Ocean Wave Simulator API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

wave_generator = WaveGenerator(grid_size=512)


class WaveParameters(BaseModel):
    wind_speed: float = Field(default=10.0, ge=1.0, le=50.0, description="风速 (m/s)")
    fetch: float = Field(default=10000.0, ge=1000.0, le=100000.0, description="风区长度 (m)")
    peak_frequency: Optional[float] = Field(default=None, ge=0.01, le=1.0, description="峰值频率 (Hz)")
    main_direction: float = Field(default=0.0, ge=0.0, le=360.0, description="浪向主传播方向 (度，0-360)")
    time: float = Field(default=0.0, description="时间参数 (s)")


class WaveResponse(BaseModel):
    parameters: WaveParameters
    grid_size: int
    min_height: float
    max_height: float
    mean_height: float
    data: List[List[float]]


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)


manager = ConnectionManager()


@app.get("/")
async def root():
    return {
        "message": "Ocean Wave Simulator API",
        "version": "1.0.0",
        "endpoints": {
            "GET /api/health": "Health check",
            "POST /api/wave": "Generate single wave field",
            "GET /api/wave": "Generate single wave field with query params",
            "WebSocket /ws/wave": "Real-time wave simulation"
        }
    }


@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}


@app.post("/api/wave", response_model=WaveResponse)
async def generate_wave(params: WaveParameters):
    try:
        height_field = wave_generator.generate_wave_field(
            wind_speed=params.wind_speed,
            fetch=params.fetch,
            peak_frequency=params.peak_frequency,
            main_direction=params.main_direction,
            time=params.time
        )
        
        return WaveResponse(
            parameters=params,
            grid_size=512,
            min_height=float(height_field.min()),
            max_height=float(height_field.max()),
            mean_height=float(height_field.mean()),
            data=height_field.tolist()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/wave", response_model=WaveResponse)
async def generate_wave_get(
    wind_speed: float = Query(default=10.0, ge=1.0, le=50.0),
    fetch: float = Query(default=10000.0, ge=1000.0, le=100000.0),
    peak_frequency: Optional[float] = Query(default=None, ge=0.01, le=1.0),
    main_direction: float = Query(default=0.0, ge=0.0, le=360.0),
    time: float = Query(default=0.0)
):
    try:
        params = WaveParameters(
            wind_speed=wind_speed,
            fetch=fetch,
            peak_frequency=peak_frequency,
            main_direction=main_direction,
            time=time
        )
        
        height_field = wave_generator.generate_wave_field(
            wind_speed=params.wind_speed,
            fetch=params.fetch,
            peak_frequency=params.peak_frequency,
            main_direction=params.main_direction,
            time=params.time
        )
        
        return WaveResponse(
            parameters=params,
            grid_size=512,
            min_height=float(height_field.min()),
            max_height=float(height_field.max()),
            mean_height=float(height_field.mean()),
            data=height_field.tolist()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.websocket("/ws/wave")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    print(f"New WebSocket connection. Total connections: {len(manager.active_connections)}")
    
    current_params = {
        "wind_speed": 10.0,
        "fetch": 10000.0,
        "peak_frequency": None,
        "main_direction": 0.0
    }
    time = 0.0
    time_step = 0.1
    random_seed = np.random.randint(0, 10000)
    
    try:
        while True:
            try:
                data = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=0.05
                )
                
                if data:
                    message = json.loads(data)
                    message_type = message.get("type", "")
                    
                    if message_type == "update_params":
                        params = message.get("params", {})
                        current_params["wind_speed"] = float(params.get("wind_speed", current_params["wind_speed"]))
                        current_params["fetch"] = float(params.get("fetch", current_params["fetch"]))
                        pf = params.get("peak_frequency")
                        current_params["peak_frequency"] = float(pf) if pf is not None else None
                        current_params["main_direction"] = float(params.get("main_direction", current_params["main_direction"]))
                        random_seed = np.random.randint(0, 10000)
                        time = 0.0
                        
                        await websocket.send_json({
                            "type": "params_updated",
                            "params": current_params
                        })
                    
                    elif message_type == "ping":
                        await websocket.send_json({"type": "pong"})
            
            except asyncio.TimeoutError:
                pass
            
            try:
                height_field = wave_generator.generate_wave_field(
                    wind_speed=current_params["wind_speed"],
                    fetch=current_params["fetch"],
                    peak_frequency=current_params["peak_frequency"],
                    main_direction=current_params["main_direction"],
                    time=time,
                    random_seed=random_seed
                )
            except Exception as e:
                print(f"Wave generation error: {e}")
                height_field = np.zeros((512, 512), dtype=np.float32)
            
            height_field = np.nan_to_num(height_field, nan=0.0, posinf=0.0, neginf=0.0)
            
            flattened = height_field.flatten().tolist()
            flattened = [0.0 if not (np.isfinite(v)) else float(v) for v in flattened]
            
            response = {
                "type": "wave_data",
                "time": time,
                "grid_size": 512,
                "min_height": float(height_field.min()),
                "max_height": float(height_field.max()),
                "data": flattened
            }
            
            await websocket.send_json(response)
            
            time += time_step
            
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        print(f"WebSocket disconnected. Total connections: {len(manager.active_connections)}")
    except Exception as e:
        print(f"WebSocket error: {e}")
        manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
