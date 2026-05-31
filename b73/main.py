from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from plc_decompiler.api.routes import router

app = FastAPI(
    title="PLC Ladder Logic Decompiler",
    description="A service to decompile PLC ladder logic from XML to executable Python code",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/")
async def root():
    return {
        "message": "PLC Ladder Logic Decompiler API",
        "version": "1.0.0",
        "endpoints": {
            "POST /api/compile": "Compile XML ladder logic to Python code",
            "POST /api/compile/upload": "Upload XML file and compile",
            "POST /api/simulate": "Simulate execution of compiled program",
            "GET /api/program/{cache_key}": "Get compiled program",
            "GET /api/program/{cache_key}/history": "Get execution history",
            "DELETE /api/cache/cleanup": "Clean up old cache entries"
        }
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
