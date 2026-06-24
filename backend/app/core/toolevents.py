import contextvars
from typing import Callable, Optional, Dict, Any

# Task-local storage to track which agent is executing and where to route tool call updates
_current_agent_id: contextvars.ContextVar[str] = contextvars.ContextVar("current_agent_id", default="")
_reporter: contextvars.ContextVar[Optional[Callable[[Dict[str, Any]], None]]] = contextvars.ContextVar("reporter", default=None)

def set_agent(agent_id: str) -> None:
    _current_agent_id.set(agent_id)

def get_agent() -> str:
    return _current_agent_id.get()

def set_reporter(rep_fn: Optional[Callable[[Dict[str, Any]], None]]) -> None:
    _reporter.set(rep_fn)

def get_reporter() -> Optional[Callable[[Dict[str, Any]], None]]:
    return _reporter.get()

def report_tool_event(tool_name: str, status: str, detail: str = "") -> None:
    """Dispatches tool state changes (start, done, error) back to the main request stream."""
    agent_id = get_agent()
    rep = get_reporter()
    if rep:
        rep({
            "agent": agent_id,
            "tool": tool_name,
            "status": status,  # "start" | "done" | "error"
            "detail": detail
        })
