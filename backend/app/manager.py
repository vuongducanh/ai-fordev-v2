import json
import logging
from typing import Dict, Any, List
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse

from app.core.store import store
from app.core.ollama import ollama_client
from app.core.mcp import open_tools
from app import host

logger = logging.getLogger(__name__)
manager_router = APIRouter()

@manager_router.get("/api/agents")
async def get_agents():
    return store.load_agents()

@manager_router.post("/api/agents")
async def upsert_agent(agent: Dict[str, Any], request: Request):
    agents = store.load_agents()
    agent_id = agent.get("id")
    if not agent_id:
        raise HTTPException(status_code=400, detail="Missing agent id")
        
    # Replace or append
    idx = next((i for i, a in enumerate(agents) if a["id"] == agent_id), -1)
    if idx != -1:
        agents[idx] = agent
    else:
        agents.append(agent)
    store.save_agents(agents)
    
    # Mount/unmount dynamically based on state
    port = request.url.port or 8090
    if agent.get("enabled") and agent.get("installed"):
        host.mount_agent(request.app, agent, port)
    else:
        host.unmount_agent(request.app, agent_id)
        
    return {"status": "success", "agent": agent}

@manager_router.delete("/api/agents/{agent_id}")
async def delete_agent(agent_id: str, request: Request):
    agents = store.load_agents()
    agents = [a for a in agents if a["id"] != agent_id]
    store.save_agents(agents)
    
    host.unmount_agent(request.app, agent_id)
    return {"status": "success"}

@manager_router.post("/api/agents/{agent_id}/connect")
async def connect_agent(agent_id: str, request: Request):
    agents = store.load_agents()
    agent = next((a for a in agents if a["id"] == agent_id), None)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
        
    agent["enabled"] = True
    store.save_agents(agents)
    
    port = request.url.port or 8090
    if agent.get("installed"):
        host.mount_agent(request.app, agent, port)
        
    return {"status": "success", "agent": agent}

@manager_router.post("/api/agents/{agent_id}/disconnect")
async def disconnect_agent(agent_id: str, request: Request):
    agents = store.load_agents()
    agent = next((a for a in agents if a["id"] == agent_id), None)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
        
    agent["enabled"] = False
    store.save_agents(agents)
    
    host.unmount_agent(request.app, agent_id)
    return {"status": "success", "agent": agent}

@manager_router.post("/api/agents/{agent_id}/install")
async def install_agent_model(agent_id: str, request: Request):
    """Pulls agent model and mounts agent dynamically once finished."""
    agents = store.load_agents()
    agent = next((a for a in agents if a["id"] == agent_id), None)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
        
    model_name = agent.get("llm", {}).get("model")
    if not model_name:
        raise HTTPException(status_code=400, detail="Agent has no model configured")
        
    port = request.url.port or 8090
    
    async def install_generator():
        yield f"event: progress\ndata: {json.dumps({'status': 'starting', 'message': f'Starting pull for {model_name}'})}\n\n"
        
        success = False
        async for progress in ollama_client.pull_model_stream(model_name):
            if progress.get("status") == "success":
                success = True
            yield f"event: progress\ndata: {json.dumps(progress, ensure_ascii=False)}\n\n"
            
        if success:
            # Refresh agent list to avoid write race conditions
            curr_agents = store.load_agents()
            cur_ag = next((a for a in curr_agents if a["id"] == agent_id), None)
            if cur_ag:
                cur_ag["installed"] = True
                store.save_agents(curr_agents)
                if cur_ag.get("enabled"):
                    host.mount_agent(request.app, cur_ag, port)
            yield f"event: progress\ndata: {json.dumps({'status': 'completed', 'message': 'Installation completed!'})}\n\n"
        else:
            yield f"event: progress\ndata: {json.dumps({'status': 'failed', 'message': 'Failed to pull model'})}\n\n"
            
    return StreamingResponse(install_generator(), media_type="text/event-stream")

@manager_router.get("/api/plugins")
async def get_plugins():
    return store.load_plugins()

@manager_router.post("/api/plugins")
async def upsert_plugin(plugin: Dict[str, Any]):
    plugins = store.load_plugins()
    plugin_id = plugin.get("id")
    if not plugin_id:
        raise HTTPException(status_code=400, detail="Missing plugin id")
        
    idx = next((i for i, p in enumerate(plugins) if p["id"] == plugin_id), -1)
    if idx != -1:
        plugins[idx] = plugin
    else:
        plugins.append(plugin)
    store.save_plugins(plugins)
    return {"status": "success", "plugin": plugin}

@manager_router.delete("/api/plugins/{plugin_id}")
async def delete_plugin(plugin_id: str):
    plugins = store.load_plugins()
    plugins = [p for p in plugins if p["id"] != plugin_id]
    store.save_plugins(plugins)
    return {"status": "success"}

@manager_router.post("/api/plugins/{plugin_id}/install")
async def install_plugin(plugin_id: str):
    """Verifies MCP plugin tool connection and registers it as installed."""
    plugins = store.load_plugins()
    plugin = next((p for p in plugins if p["id"] == plugin_id), None)
    if not plugin:
        raise HTTPException(status_code=404, detail="Plugin not found")
        
    async def plugin_install_generator():
        yield f"event: progress\ndata: {json.dumps({'status': 'installing', 'message': f'Installing plugin {plugin_id}'})}\n\n"
        
        if plugin["type"] == "builtin":
            plugin["installed"] = True
            plugin["enabled"] = True
            store.save_plugins(plugins)
            yield f"event: progress\ndata: {json.dumps({'status': 'completed', 'message': 'Built-in plugin ready immediately'})}\n\n"
        else:
            # Try to connect and fetch tools
            yield f"event: progress\ndata: {json.dumps({'status': 'connecting', 'message': 'Connecting to MCP Server...'})}\n\n"
            try:
                # We temporarily enable it to test the mcp connection
                plugin["enabled"] = True
                store.save_plugins(plugins)
                
                async with open_tools([plugin_id]) as (openai_tools, _):
                    if openai_tools:
                        # Success: save state
                        plugin["installed"] = True
                        plugin["tools"] = [t["name"] for t in openai_tools]
                        store.save_plugins(plugins)
                        yield f"event: progress\ndata: {json.dumps({'status': 'completed', 'message': f'Success! Found tools: {', '.join(plugin['tools'])}'})}\n\n"
                    else:
                        plugin["installed"] = False
                        plugin["enabled"] = False
                        store.save_plugins(plugins)
                        yield f"event: progress\ndata: {json.dumps({'status': 'failed', 'message': 'MCP server did not expose any tools'})}\n\n"
            except Exception as e:
                plugin["installed"] = False
                plugin["enabled"] = False
                store.save_plugins(plugins)
                yield f"event: progress\ndata: {json.dumps({'status': 'failed', 'message': f'Failed to connect: {e}'})}\n\n"
                
    return StreamingResponse(plugin_install_generator(), media_type="text/event-stream")

@manager_router.get("/api/models")
async def get_ollama_models():
    """Lists currently installed models on the local Ollama backend."""
    return await ollama_client.list_models()
