import os
import httpx
from typing import List, Dict, Any, AsyncGenerator

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")

class OllamaClient:
    def __init__(self):
        self.base_url = OLLAMA_HOST

    async def list_models(self) -> List[Dict[str, Any]]:
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(f"{self.base_url}/api/tags", timeout=5.0)
                if resp.status_code == 200:
                    data = resp.json()
                    return data.get("models", [])
            except Exception:
                pass
            return []

    async def pull_model_stream(self, model_name: str) -> AsyncGenerator[Dict[str, Any], None]:
        async with httpx.AsyncClient() as client:
            try:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/api/pull",
                    json={"name": model_name},
                    timeout=None
                ) as response:
                    async for line in response.iter_lines():
                        if line:
                            yield httpx.Response(status_code=200, content=line).json()
            except Exception as e:
                yield {"status": "error", "error": str(e)}

    async def delete_model(self, model_name: str) -> bool:
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.request(
                    "DELETE",
                    f"{self.base_url}/api/delete",
                    json={"name": model_name},
                    timeout=10.0
                )
                return resp.status_code == 200
            except Exception:
                return False

    async def warm_model(self, model_name: str) -> bool:
        """Loads model into memory."""
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(
                    f"{self.base_url}/api/generate",
                    json={"model": model_name, "prompt": "", "keep_alive": -1},
                    timeout=30.0
                )
                return resp.status_code == 200
            except Exception:
                return False

    async def unload_model(self, model_name: str) -> bool:
        """Unloads model from memory."""
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(
                    f"{self.base_url}/api/generate",
                    json={"model": model_name, "prompt": "", "keep_alive": 0},
                    timeout=10.0
                )
                return resp.status_code == 200
            except Exception:
                return False

    async def get_model_capabilities(self, model_name: str) -> List[str]:
        """Gets capabilities (completion, tools, vision) for a model."""
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(
                    f"{self.base_url}/api/show",
                    json={"name": model_name},
                    timeout=5.0
                )
                if resp.status_code == 200:
                    data = resp.json()
                    caps = data.get("capabilities", [])
                    if caps:
                        return caps
                    
                    # Fallback detection if capabilities not returned
                    # vision models:
                    details = data.get("details", {})
                    family = details.get("family", "")
                    families = details.get("families", [])
                    
                    caps = ["completion"]
                    # If model family or name indicates tools
                    model_lower = model_name.lower()
                    if "coder" in model_lower or "qwen" in model_lower or "gemma2" in model_lower:
                        caps.append("tools")
                    # vision check
                    if "vl" in model_lower or "vision" in model_lower or "mplug" in model_lower:
                        caps.append("vision")
                    return caps
            except Exception:
                pass
            
            # Simple fallback by model name
            model_lower = model_name.lower()
            caps = ["completion"]
            if "coder" in model_lower or "qwen" in model_lower:
                caps.append("tools")
            if "vl" in model_lower or "vision" in model_lower:
                caps.append("vision")
            return caps

ollama_client = OllamaClient()
