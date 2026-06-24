import os
import re
import base64
import inspect
import asyncio
from typing import List, Dict, Any, Type, Tuple, Optional, AsyncGenerator, Callable

from google.adk.agents import LlmAgent, RunConfig
from google.adk.runners import InMemoryRunner, Event
from google.adk.models.lite_llm import LiteLlm
from google.adk.tools.base_tool import BaseTool
from google.genai import types
from pydantic import BaseModel, create_model, Field
from enum import Enum

from app.core.ollama import OLLAMA_HOST
from app.core import toolevents

# Set environment variables for Ollama
os.environ["OLLAMA_API_BASE"] = OLLAMA_HOST
os.environ["OLLAMA_HOST"] = OLLAMA_HOST

class ToolsUnsupported(Exception):
    """Custom exception raised when a model does not support tool calling."""
    pass

def dict_to_adk_schema(d: dict) -> types.Schema:
    """Recursively converts standard JSON Schema to Google ADK types.Schema."""
    if not isinstance(d, dict):
        return d
    out = d.copy()
    if "type" in out and isinstance(out["type"], str):
        out["type"] = out["type"].upper()
    if "properties" in out and isinstance(out["properties"], dict):
        out["properties"] = {k: dict_to_adk_schema(v) for k, v in out["properties"].items()}
    if "items" in out and isinstance(out["items"], dict):
        out["items"] = dict_to_adk_schema(out["items"])
    return types.Schema(**out)

def schema_to_model(schema: dict, model_name: str = "DynamicModel") -> Type[BaseModel]:
    """Dynamically creates a Pydantic model subclass from a JSON Schema dictionary."""
    properties = schema.get("properties", {})
    required = schema.get("required", [])
    fields = {}
    for name, prop in properties.items():
        ptype = prop.get("type", "string")
        pdesc = prop.get("description", "")
        penum = prop.get("enum", None)
        py_type = Any
        if ptype == "string":
            if penum:
                py_type = Enum(f"{name.capitalize()}Enum", {val: val for val in penum})
            else:
                py_type = str
        elif ptype == "integer":
            py_type = int
        elif ptype == "number":
            py_type = float
        elif ptype == "boolean":
            py_type = bool
        elif ptype == "array":
            items = prop.get("items", {})
            if items:
                if items.get("type") == "object":
                    py_type = List[schema_to_model(items, f"{name.capitalize()}Item")]
                else:
                    item_type = str
                    itype = items.get("type", "string")
                    if itype == "integer":
                        item_type = int
                    elif itype == "number":
                        item_type = float
                    elif itype == "boolean":
                        item_type = bool
                    py_type = List[item_type]
            else:
                py_type = List[Any]
        elif ptype == "object":
            py_type = schema_to_model(prop, f"{name.capitalize()}Model")
        
        if name not in required:
            py_type = Optional[py_type]
            default = None
        else:
            default = ...
        fields[name] = (py_type, Field(default=default, description=pdesc))
    return create_model(model_name, **fields)

def parse_openai_content(content: Any, role: str) -> types.Content:
    """Parses OpenAI message content (text or multimodality lists) to types.Content."""
    parts = []
    if isinstance(content, str):
        parts.append(types.Part.from_text(text=content))
    elif isinstance(content, list):
        for item in content:
            if not isinstance(item, dict):
                continue
            itype = item.get("type")
            if itype == "text":
                parts.append(types.Part.from_text(text=item.get("text", "")))
            elif itype == "image_url":
                url = item.get("image_url", {}).get("url", "")
                match = re.match(r"data:([^;]+);base64,(.+)", url)
                if match:
                    mime_type = match.group(1)
                    b64_data = match.group(2)
                    raw_data = base64.b64decode(b64_data)
                    parts.append(types.Part(inline_data=types.Blob(data=raw_data, mime_type=mime_type)))
    return types.Content(role=role, parts=parts)

class _McpTool(BaseTool):
    """ADK Tool adapter mapping MCP tools to Google ADK BaseTool."""
    def __init__(self, name: str, description: str, parameters: dict, dispatch_fn: Callable):
        super().__init__(name=name, description=description)
        self.parameters = parameters
        self.dispatch_fn = dispatch_fn

    def _get_declaration(self) -> types.FunctionDeclaration:
        return types.FunctionDeclaration(
            name=self.name,
            description=self.description,
            parameters=dict_to_adk_schema(self.parameters)
        )

    async def run_async(self, *, args: dict, tool_context) -> Any:
        detail = ""
        if "query" in args:
            detail = str(args["query"])
        elif "url" in args:
            detail = str(args["url"])
        elif args:
            detail = ", ".join(f"{k}={v}" for k, v in args.items())
        
        toolevents.report_tool_event(self.name, "start", detail)
        try:
            res = await self.dispatch_fn(self.name, args)
            toolevents.report_tool_event(self.name, "done", detail)
            return res
        except Exception as e:
            toolevents.report_tool_event(self.name, "error", detail)
            raise e

async def prepare_runner_and_messages(
    cfg: Dict[str, Any],
    messages: List[Dict[str, Any]],
    tools: Optional[List[BaseTool]] = None,
    output_schema: Optional[Type[BaseModel]] = None
) -> Tuple[InMemoryRunner, List[Dict[str, Any]]]:
    """Helper that creates an InMemoryRunner instance and filters system instructions."""
    instructions = []
    other_messages = []
    for msg in messages:
        if msg["role"] == "system":
            instructions.append(msg["content"])
        else:
            other_messages.append(msg)
            
    system_instruction = "\n\n".join(instructions)
    if not system_instruction:
        system_instruction = cfg.get("system_prompt", "")
        
    model_name = f"ollama_chat/{cfg['model']}"
    think_val = bool(cfg.get("thinking", False))
    num_ctx = cfg.get("num_ctx", 8192)
    
    # Instantiate LiteLlm model wrapper
    model = LiteLlm(model=model_name, think=think_val, num_ctx=num_ctx)
    
    # Configure GenerateContentConfig
    generate_content_config = types.GenerateContentConfig(
        temperature=cfg.get("temperature", 0.6),
        top_p=cfg.get("top_p", 0.9),
        top_k=cfg.get("top_k", 40),
    )
    
    agent = LlmAgent(
        name="a2a_agent",
        model=model,
        instruction=system_instruction,
        generate_content_config=generate_content_config,
        tools=tools or [],
        output_schema=output_schema
    )
    
    runner = InMemoryRunner(agent=agent)
    return runner, other_messages

async def seed_session_history(runner: InMemoryRunner, other_messages: List[Dict[str, Any]]) -> types.Content:
    """Helper that seeds historical messages into the runner session and returns the last message."""
    session = await runner.session_service.create_session(
        app_name=runner.app_name,
        user_id="user",
        session_id="session"
    )
    
    history = other_messages[:-1]
    new_msg_dict = other_messages[-1]
    
    for i, msg in enumerate(history):
        content = parse_openai_content(msg["content"], msg["role"])
        role = "user" if msg["role"] == "user" else "model"
        session.events.append(Event(
            id=f"hist_{i}",
            author=role,
            content=content,
            turn_complete=True
        ))
        
    new_message = parse_openai_content(new_msg_dict["content"], "user")
    return new_message

async def complete_with_tools(
    cfg: Dict[str, Any],
    messages: List[Dict[str, Any]],
    mcp_tools: List[Dict[str, Any]],
    dispatch_fn: Callable
) -> str:
    """Runs LlmAgent with registered tools, letting the ADK Runner handle the tool loop."""
    adk_tools = []
    for t in mcp_tools:
        adk_tools.append(_McpTool(
            name=t["name"],
            description=t["description"],
            parameters=t["parameters"],
            dispatch_fn=dispatch_fn
        ))
        
    runner, other_messages = await prepare_runner_and_messages(cfg, messages, tools=adk_tools)
    new_message = await seed_session_history(runner, other_messages)
    
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
            raise ToolsUnsupported(str(e))
        raise e
        
    return "".join(text_parts)

