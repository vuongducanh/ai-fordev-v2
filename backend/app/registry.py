import json
import logging
from typing import Dict, Any
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.core.ollama import ollama_client

logger = logging.getLogger(__name__)
registry_router = APIRouter()

# Suggested catalog database
SUGGESTED_MODELS = [
    {
        "name": "qwen3:4b",
        "description": "Mô hình điều phối chính và phân tích chuyên sâu (Khuyến nghị).",
        "size": "4B",
        "vision": False,
        "tools": True
    },
    {
        "name": "qwen2.5-coder:1.5b",
        "description": "Mô hình tối ưu cho các tác vụ lập trình và viết code.",
        "size": "1.5B",
        "vision": False,
        "tools": True
    },
    {
        "name": "gemma3:1b",
        "description": "Mô hình siêu nhẹ, phản hồi cực nhanh cho tác vụ thông thường.",
        "size": "1B",
        "vision": False,
        "tools": False
    },
    {
        "name": "qwen2.5vl:3b",
        "description": "Mô hình đa phương tiện (Vision) hỗ trợ đọc hiểu hình ảnh.",
        "size": "3B",
        "vision": True,
        "tools": True
    }
]

@registry_router.get("/api/registry/models")
async def get_suggested_models():
    return SUGGESTED_MODELS

@registry_router.post("/api/models/pull")
async def pull_model(body: Dict[str, Any]):
    model_name = body.get("name")
    if not model_name:
        raise HTTPException(status_code=400, detail="Missing model name")
        
    async def pull_generator():
        yield f"event: progress\ndata: {json.dumps({'status': 'starting', 'message': f'Pulling model {model_name}'})}\n\n"
        async for progress in ollama_client.pull_model_stream(model_name):
            yield f"event: progress\ndata: {json.dumps(progress, ensure_ascii=False)}\n\n"
            
    return StreamingResponse(pull_generator(), media_type="text/event-stream")

@registry_router.post("/api/models/delete")
async def delete_model(body: Dict[str, Any]):
    model_name = body.get("name")
    if not model_name:
        raise HTTPException(status_code=400, detail="Missing model name")
        
    success = await ollama_client.delete_model(model_name)
    if success:
        return {"status": "success"}
    raise HTTPException(status_code=500, detail=f"Failed to delete model {model_name}")
