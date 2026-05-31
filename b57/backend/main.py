import asyncio
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import os
from data_generator import TickDataGenerator

data_generator = TickDataGenerator(ticks_per_second=100)

@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(data_generator.start())
    try:
        yield
    finally:
        data_generator.stop()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

app = FastAPI(lifespan=lifespan, title="Crypto Trading Dashboard")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.websocket("/ws/ticks")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    await data_generator.add_client(websocket)

frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

@app.get("/")
async def get_index():
    return FileResponse(os.path.join(frontend_dir, "index.html"))

@app.get("/chart_manager.js")
async def get_chart_manager():
    return FileResponse(os.path.join(frontend_dir, "chart_manager.js"))

@app.get("/app.js")
async def get_app():
    return FileResponse(os.path.join(frontend_dir, "app.js"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
