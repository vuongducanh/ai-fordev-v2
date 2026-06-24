import logging
from typing import Dict, List, Any
from fastapi import FastAPI
from starlette.routing import Route

from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.server.routes.agent_card_routes import create_agent_card_routes
from a2a.server.routes.jsonrpc_routes import create_jsonrpc_routes

from app.agents.card import build_card
from app.agents.executor import AgentLLMExecutor

logger = logging.getLogger(__name__)

# Tracks mounted routes per agent: agent_id -> list of starlette Route objects
_mounted: Dict[str, List[Route]] = {}

def mount_agent(app: FastAPI, agent: Dict[str, Any], port: int) -> None:
    """Creates AgentCard + DefaultRequestHandler, generates A2A routes, and extends FastAPI app router."""
    agent_id = agent["id"]
    unmount_agent(app, agent_id)
    
    try:
        # Build protobuf AgentCard
        card = build_card(agent, port)
        
        # Initialize Executor & TaskStore
        executor = AgentLLMExecutor(agent_id)
        task_store = InMemoryTaskStore()
        
        # Initialize A2A DefaultRequestHandler (maps to DefaultRequestHandlerV2)
        request_handler = DefaultRequestHandler(
            agent_executor=executor,
            task_store=task_store,
            agent_card=card
        )
        
        # Build Card and JSON-RPC routes
        card_routes = create_agent_card_routes(
            agent_card=card,
            card_url=f"/agents/{agent_id}/.well-known/agent-card.json"
        )
        rpc_routes = create_jsonrpc_routes(
            request_handler=request_handler,
            rpc_url=f"/agents/{agent_id}"
        )
        
        new_routes = card_routes + rpc_routes
        app.router.routes.extend(new_routes)
        
        _mounted[agent_id] = new_routes
        logger.info(f"Dynamically mounted A2A routes for agent '{agent_id}' on path /agents/{agent_id}")
    except Exception as e:
        logger.exception(f"Failed to mount agent '{agent_id}': {e}")
        raise e

def unmount_agent(app: FastAPI, agent_id: str) -> None:
    """Removes registered A2A routes for an agent from the FastAPI app router."""
    if agent_id in _mounted:
        routes_to_remove = _mounted[agent_id]
        removed_count = 0
        for r in routes_to_remove:
            if r in app.router.routes:
                app.router.routes.remove(r)
                removed_count += 1
        del _mounted[agent_id]
        logger.info(f"Unmounted A2A routes for agent '{agent_id}' (removed {removed_count} routes)")

def mounted_ids() -> List[str]:
    """Returns the list of currently mounted agent IDs."""
    return list(_mounted.keys())
