import datetime
import inspect
import asyncio
import httpx
from bs4 import BeautifulSoup
from contextlib import AsyncExitStack, asynccontextmanager
from typing import List, Dict, Any, Tuple, Callable
from app.core.store import store

# Builtin function implementations
def builtin_add(a: float, b: float) -> str:
    return str(a + b)

def builtin_multiply(a: float, b: float) -> str:
    return str(a * b)

def builtin_get_current_time() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

async def builtin_fetch_content(url: str) -> str:
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, headers=headers, timeout=15.0)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        for script in soup(["script", "style"]):
            script.decompose()
        text = soup.get_text()
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        text = "\n".join(chunk for chunk in chunks if chunk)
        return text

async def builtin_search(query: str) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"https://html.duckduckgo.com/html/?q={query}", headers=headers, timeout=15.0)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        results = []
        for div in soup.find_all("div", class_="result"):
            title_a = div.find("a", class_="result__url")
            snippet_a = div.find("a", class_="result__snippet")
            if title_a and snippet_a:
                url = title_a["href"]
                from urllib.parse import urlparse, parse_qs
                if url.startswith("//"):
                    url = "https:" + url
                elif url.startswith("/"):
                    url = "https://duckduckgo.com" + url
                parsed = urlparse(url)
                if parsed.path == "/l/":
                    qs = parse_qs(parsed.query)
                    if "uddg" in qs:
                        url = qs["uddg"][0]
                results.append({
                    "title": title_a.get_text(strip=True),
                    "url": url,
                    "snippet": snippet_a.get_text(strip=True)
                })
        if not results:
            return "No results found."
        out = []
        for idx, r in enumerate(results[:5]):
            out.append(f"{idx+1}. {r['title']}\nURL: {r['url']}\nSnippet: {r['snippet']}\n")
        return "\n".join(out)

# Map name -> handler
BUILTINS: Dict[str, Callable] = {
    "add": builtin_add,
    "multiply": builtin_multiply,
    "get_current_time": builtin_get_current_time,
    "fetch_content": builtin_fetch_content,
    "search": builtin_search
}

BUILTIN_SCHEMAS: Dict[str, Dict[str, Any]] = {
    "add": {
        "name": "add",
        "description": "Cộng hai số",
        "parameters": {
            "type": "object",
            "properties": {
                "a": {"type": "number", "description": "Số thứ nhất"},
                "b": {"type": "number", "description": "Số thứ hai"}
            },
            "required": ["a", "b"]
        }
    },
    "multiply": {
        "name": "multiply",
        "description": "Nhân hai số",
        "parameters": {
            "type": "object",
            "properties": {
                "a": {"type": "number", "description": "Số thứ nhất"},
                "b": {"type": "number", "description": "Số thứ hai"}
            },
            "required": ["a", "b"]
        }
    },
    "get_current_time": {
        "name": "get_current_time",
        "description": "Lấy ngày giờ hiện tại của hệ thống",
        "parameters": {
            "type": "object",
            "properties": {}
        }
    },
    "fetch_content": {
        "name": "fetch_content",
        "description": "Tải và trích xuất nội dung văn bản thô từ địa chỉ URL",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL trang web cần tải"}
            },
            "required": ["url"]
        }
    },
    "search": {
        "name": "search",
        "description": "Tìm kiếm thông tin trên Internet qua DuckDuckGo",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Từ khoá tìm kiếm"}
            },
            "required": ["query"]
        }
    }
}

@asynccontextmanager
async def open_tools(plugin_ids: List[str]):
    """Async context manager that dynamically activates plugins and exposes tools/dispatch callback."""
    async with AsyncExitStack() as stack:
        openai_tools: List[Dict[str, Any]] = []
        dispatch_map: Dict[str, Callable] = {}
        
        plugins = store.load_plugins()
        active_plugins = {p["id"]: p for p in plugins if p["enabled"]}
        
        for pid in plugin_ids:
            if pid not in active_plugins:
                continue
            plugin = active_plugins[pid]
            ptype = plugin["type"]
            
            if ptype == "builtin":
                for tool_name in plugin.get("tools", []):
                    if tool_name in BUILTINS:
                        openai_tools.append(BUILTIN_SCHEMAS[tool_name])
                        dispatch_map[tool_name] = BUILTINS[tool_name]
            elif ptype == "mcp_stdio":
                try:
                    from mcp import StdioServerParameters, ClientSession
                    from mcp.client.stdio import stdio_client
                    
                    cmd = plugin["install"]["command"]
                    args = plugin["install"].get("args", [])
                    server_params = StdioServerParameters(command=cmd, args=args)
                    
                    read_stream, write_stream = await stack.enter_async_context(stdio_client(server_params))
                    session = await stack.enter_async_context(ClientSession(read_stream, write_stream))
                    await session.initialize()
                    
                    tools_result = await session.list_tools()
                    for tool in tools_result.tools:
                        openai_tools.append({
                            "name": tool.name,
                            "description": tool.description,
                            "parameters": tool.inputSchema or {}
                        })
                        # Bind local variables using a helper function to avoid closures catching loop state
                        def _bind_mcp(sess, tname):
                            async def _mcp_disp(args):
                                res = await sess.call_tool(tname, arguments=args)
                                return "\n".join(p.text for p in res.content if hasattr(p, "text"))
                            return _mcp_disp
                        dispatch_map[tool.name] = _bind_mcp(session, tool.name)
                except Exception as e:
                    print(f"Failed to load stdio MCP plugin {pid}: {e}")
            elif ptype == "mcp_url":
                try:
                    from mcp import ClientSession
                    from mcp.client.sse import sse_client
                    
                    url = plugin["url"]
                    read_stream, write_stream = await stack.enter_async_context(sse_client(url))
                    session = await stack.enter_async_context(ClientSession(read_stream, write_stream))
                    await session.initialize()
                    
                    tools_result = await session.list_tools()
                    for tool in tools_result.tools:
                        openai_tools.append({
                            "name": tool.name,
                            "description": tool.description,
                            "parameters": tool.inputSchema or {}
                        })
                        def _bind_mcp_url(sess, tname):
                            async def _mcp_disp_url(args):
                                res = await sess.call_tool(tname, arguments=args)
                                return "\n".join(p.text for p in res.content if hasattr(p, "text"))
                            return _mcp_disp_url
                        dispatch_map[tool.name] = _bind_mcp_url(session, tool.name)
                except Exception as e:
                    print(f"Failed to load URL MCP plugin {pid}: {e}")

        async def dispatch(name: str, args: Dict[str, Any]) -> str:
            if name in dispatch_map:
                fn = dispatch_map[name]
                if inspect.iscoroutinefunction(fn) or asyncio.iscoroutinefunction(fn):
                    return await fn(args)
                else:
                    sig = inspect.signature(fn)
                    if not sig.parameters:
                        return fn()
                    return fn(**args)
            raise ValueError(f"Tool '{name}' not found")
            
        yield openai_tools, dispatch
