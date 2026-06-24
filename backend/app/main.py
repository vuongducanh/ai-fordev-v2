import os
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.store import store
from app.core.ollama import ollama_client
from app import host
from app.orchestrator import orchestrator_router
from app.manager import manager_router
from app.registry import registry_router

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handles startup model warming, dynamic agent mounting, and shutdown model unloading."""
    logger.info("Starting up A2A Backend Server...")
    
    port = int(os.environ.get("BACKEND_PORT", 8090))
    agents = store.load_agents()
    
    # Mount active and installed agents, and warm up their models
    for agent in agents:
        if agent.get("enabled"):
            if agent.get("installed"):
                try:
                    host.mount_agent(app, agent, port)
                    model_name = agent.get("llm", {}).get("model")
                    if model_name:
                        logger.info(f"Warming model '{model_name}' for agent '{agent['id']}'")
                        asyncio.create_task(ollama_client.warm_model(model_name))
                except Exception as e:
                    logger.error(f"Failed to auto-mount agent '{agent['id']}': {e}")
                    
    yield
    
    logger.info("Shutting down A2A Backend Server...")
    # Unload models to save resources
    for agent in agents:
        model_name = agent.get("llm", {}).get("model")
        if model_name:
            logger.info(f"Unloading model '{model_name}'")
            asyncio.create_task(ollama_client.unload_model(model_name))

app = FastAPI(lifespan=lifespan)

# Allow CORS for development proxying
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(orchestrator_router)
app.include_router(manager_router)
app.include_router(registry_router)

@app.get("/health")
async def health_check():
    return {"status": "ok"}
