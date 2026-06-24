import re
from typing import List, Dict, Any
from app.core import llm, mcp, adk_engine, toolevents

async def run_with_tools(agent: Dict[str, Any], messages: List[Dict[str, Any]]) -> str:
    """Executes a chat request with tool calling support, performing deterministic RAG pre-fetch first."""
    plugins = agent.get("plugins", [])
    if not plugins:
        return await llm.chat_text(agent["llm"], messages)
        
    # Extract last user query
    user_text = ""
    for msg in reversed(messages):
        if msg["role"] == "user":
            if isinstance(msg["content"], str):
                user_text = msg["content"]
            elif isinstance(msg["content"], list):
                user_text = "\n".join(item["text"] for item in msg["content"] if item.get("type") == "text")
            break
            
    async with mcp.open_tools(plugins) as (openai_tools, dispatch):
        if not openai_tools:
            return await llm.chat_text(agent["llm"], messages)
            
        # Directive to prompt the model to call tools appropriately
        directive = (
            "You are equipped with tools. You must use tools when needed to check facts, "
            "fetch URLs or search. You must NOT hallucinate or pretend you checked if you didn't. "
            "If no tool is relevant, reply directly based on context."
        )
        
        llm_cfg = agent["llm"].copy()
        llm_cfg["system_prompt"] = llm_cfg.get("system_prompt", "") + "\n\n" + directive
        
        # RAG Pre-fetch (Deterministic)
        urls = re.findall(r"https?://[^\s()<>]+", user_text)
        rag_contents = []
        
        if urls:
            # Query contains URL(s) -> fetch them directly
            fetch_fn = mcp.BUILTINS["fetch_content"]
            for url in urls:
                toolevents.report_tool_event("fetch_content", "start", url)
                try:
                    content = await fetch_fn(url)
                    toolevents.report_tool_event("fetch_content", "done", url)
                    rag_contents.append(f"--- CONTENT FOR URL {url} ---\n{content}\n--- END CONTENT ---")
                except Exception:
                    toolevents.report_tool_event("fetch_content", "error", url)
        else:
            # Search available -> fetch DDG search and top 2 results
            has_search = any(t["name"] == "search" for t in openai_tools)
            if has_search and user_text:
                toolevents.report_tool_event("search", "start", user_text)
                try:
                    search_res = await mcp.BUILTINS["search"](user_text)
                    toolevents.report_tool_event("search", "done", user_text)
                    rag_contents.append(f"--- WEB SEARCH RESULTS FOR '{user_text}' ---\n{search_res}\n--- END WEB SEARCH RESULTS ---")
                    
                    # Extract top 2 result URLs and fetch their pages
                    found_urls = re.findall(r"URL:\s*(https?://[^\s()<>]+)", search_res)
                    fetch_fn = mcp.BUILTINS["fetch_content"]
                    for url in found_urls[:2]:
                        toolevents.report_tool_event("fetch_content", "start", url)
                        try:
                            content = await fetch_fn(url)
                            truncated_content = content[:3500]
                            toolevents.report_tool_event("fetch_content", "done", url)
                            rag_contents.append(f"--- CONTENT FOR RESULT {url} ---\n{truncated_content}\n--- END CONTENT ---")
                        except Exception:
                            toolevents.report_tool_event("fetch_content", "error", url)
                except Exception:
                    toolevents.report_tool_event("search", "error", user_text)
                    
        if rag_contents:
            rag_context = "\n\n[Deterministic RAG Context]\n" + "\n".join(rag_contents)
            llm_cfg["system_prompt"] = llm_cfg.get("system_prompt", "") + rag_context
            
        try:
            return await adk_engine.complete_with_tools(
                llm_cfg, messages, openai_tools, dispatch
            )
        except adk_engine.ToolsUnsupported:
            # Model does not support tool calling (e.g. gemma3)
            ans = await llm.chat_text(agent["llm"], messages)
            warning_msg = (
                f"[TOOL_WARNING]Agent '{agent.get('id', 'unknown')}' running model '{agent['llm']['model']}' "
                f"does not support tool calling. Fallback to direct completion was triggered. "
                f"To resolve this, select a model with tool capabilities (like qwen2.5-coder or qwen3).[/TOOL_WARNING]"
            )
            return warning_msg if not ans else f"{ans}\n\n{warning_msg}"
