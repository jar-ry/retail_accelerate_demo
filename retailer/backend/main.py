import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from backend.routes import battlecard, clv, elasticity, competitive, agent

app = FastAPI(title="Baby Mart Category Manager API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(clv.router, prefix="/api/clv", tags=["CLV"])
app.include_router(elasticity.router, prefix="/api/elasticity", tags=["Elasticity"])
app.include_router(competitive.router, prefix="/api/competitive", tags=["Competitive"])
app.include_router(battlecard.router, prefix="/api/battlecard", tags=["Battlecard"])
app.include_router(agent.router, prefix="/api/agent", tags=["Agent"])


@app.get("/health")
def health():
    return {"status": "ok"}


STATIC_DIR = Path(__file__).parent.parent / "static"
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = STATIC_DIR / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(STATIC_DIR / "index.html"))
