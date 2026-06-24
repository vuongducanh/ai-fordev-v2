import json
import asyncio
from typing import List, Dict, Any, Callable, AsyncGenerator, Optional

from google.adk.runners import Event
from google.genai import types
from app.core import adk_engine

def system_message(content: str) -> Dict[str, str]:
    """Helper to build a system message dictionary."""
    return {"role": "system", "content": content}

def build_user_content(text: str, images: Optional[List[str]] = None) -> Any:
    """Builds user message content block supporting multimodality data URIs."""
    if not images:
        return text
    
    content_list = [{"type": "text", "text": text}]
    for img in images:
        content_list.append({
            "type": "image_url",
            "image_url": {"url": img}
        })
    return content_list

async def chat_text(cfg: Dict[str, Any], messages: List[Dict[str, Any]]) -> str:
    """Executes a non-streaming text chat completion."""
    runner, other_messages = await adk_engine.prepare_runner_and_messages(cfg, messages)
    new_message = await adk_engine.seed_session_history(runner, other_messages)
    
    text_parts = []
    try:
        async for event in runner.run_async(user_id="user", session_id="session", new_message=new_message):
            if event.content and event.content.parts:
                for part in event.content.parts:
                    if part.text:
                        text_parts.append(part.text)
    except Exception as e:
        err_str = str(e).lower()
        if "does not support tools" in err_str or "tool" in err_str:
            raise adk_engine.ToolsUnsupported(str(e))
        raise e
        
    return "".join(text_parts)

async def chat_json(cfg: Dict[str, Any], messages: List[Dict[str, Any]], schema: Dict[str, Any]) -> Dict[str, Any]:
    """Executes a JSON chat completion, forcing the response to conform to the schema."""
    model_cls = adk_engine.schema_to_model(schema)
    runner, other_messages = await adk_engine.prepare_runner_and_messages(
        cfg, messages, output_schema=model_cls
    )
    new_message = await adk_engine.seed_session_history(runner, other_messages)
    
    res_obj = None
    text_fallback = []
    try:
        async for event in runner.run_async(user_id="user", session_id="session", new_message=new_message):
            if event.output:
                res_obj = event.output
            elif event.content and event.content.parts:
                for part in event.content.parts:
                    if part.text:
                        text_fallback.append(part.text)
    except Exception as e:
        err_str = str(e).lower()
        if "does not support tools" in err_str or "tool" in err_str:
            raise adk_engine.ToolsUnsupported(str(e))
        raise e

    if res_obj:
        if hasattr(res_obj, "model_dump"):
            # Output is a Pydantic model instance
            return res_obj.model_dump()
        elif isinstance(res_obj, dict):
            return res_obj
        else:
            try:
                return json.loads(str(res_obj))
            except Exception:
                pass
                
    # Fallback to parsing text output
    if text_fallback:
        fallback_text = "".join(text_fallback)
        try:
            # clean any markdown wrappers
            clean_text = fallback_text.strip()
            if clean_text.startswith("```json"):
                clean_text = clean_text[7:]
            if clean_text.endswith("```"):
                clean_text = clean_text[:-3]
            return json.loads(clean_text.strip())
        except Exception:
            pass
            
    return {}

async def stream_text(
    cfg: Dict[str, Any],
    messages: List[Dict[str, Any]],
    on_meta: Optional[Callable[[Dict[str, int]], None]] = None
) -> AsyncGenerator[str, None]:
    """Asynchronous generator yielding streamed text chunks from the runner."""
    runner, other_messages = await adk_engine.prepare_runner_and_messages(cfg, messages)
    new_message = await adk_engine.seed_session_history(runner, other_messages)
    
    try:
        async for event in runner.run_async(user_id="user", session_id="session", new_message=new_message):
            # Parse text delta
            if event.content and event.content.parts:
                for part in event.content.parts:
                    if part.text:
                        yield part.text
            
            # Report token counts metadata
            if event.usage_metadata and on_meta:
                on_meta({
                    "prompt_tokens": event.usage_metadata.prompt_token_count or 0,
                    "completion_tokens": event.usage_metadata.candidates_token_count or 0,
                    "total_tokens": event.usage_metadata.total_token_count or 0
                })
    except Exception as e:
        err_str = str(e).lower()
        if "does not support tools" in err_str or "tool" in err_str:
            raise adk_engine.ToolsUnsupported(str(e))
        raise e
