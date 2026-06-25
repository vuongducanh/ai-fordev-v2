import re
import json
import time
import asyncio
import logging
import datetime
from typing import List, Dict, Any, Tuple, Optional, AsyncGenerator, Callable
import uuid
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
import httpx
from httpx import ASGITransport, AsyncClient

from app.core import llm, toolevents
from app.core.store import store
from app.core.ollama import ollama_client

logger = logging.getLogger(__name__)

MAX_AGENTS = 3

def orch_config() -> Dict[str, Any]:
    """Retrieves coordinator settings from store, with defaults."""
    settings = store.load_settings()
    cfg = settings.get("orchestrator", {}).copy()
    if "model" not in cfg:
        cfg["model"] = "qwen3:1.7b"
    if "temperature" not in cfg:
        cfg["temperature"] = 0.3
    if "top_p" not in cfg:
        cfg["top_p"] = 0.9
    if "top_k" not in cfg:
        cfg["top_k"] = 40
    return cfg

def runtime_snapshot(cands: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Returns snapshot dictionary describing available agent capacities."""
    return {
        "now": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "agents": [
            {
                "id": c["id"],
                "name": c["card"]["name"],
                "description": c["card"]["description"],
                "skills": c["card"].get("skills", []),
                "model": c["llm"]["model"]
            }
            for c in cands
        ]
    }

async def _route_decision(user_text: str, history: List[Dict[str, Any]], cands: List[Dict[str, Any]]) -> List[Tuple[str, str]]:
    """Analyzes prompt text and decides which specialized agents should handle subtasks."""
    # 1. Mention check — honor explicit @agent mentions (do not filter by vision)
    mention_tokens = {f"@{c['id']}": c["id"] for c in cands}
    found_mentions = [(aid, token) for token, aid in mention_tokens.items() if token in user_text]
    
    if found_mentions:
        # Xóa hết tất cả @token khỏi prompt, không xóa từng cái riêng lẻ
        cleaned_prompt = user_text
        for _, token in found_mentions:
            cleaned_prompt = cleaned_prompt.replace(token, "")
        cleaned_prompt = cleaned_prompt.strip()
        
        final_prompt = cleaned_prompt if cleaned_prompt else user_text
        mentions = [(aid, final_prompt) for aid, _ in found_mentions]
        return mentions[:MAX_AGENTS]

    # 2. If no candidates remain, return empty list
    if not cands:
        return []

    # 3. LLM Router decision
    cfg = orch_config()
    snapshot = runtime_snapshot(cands)
    agent_ids = [c["id"] for c in cands]
    
    # schema dùng để ép LLM trả về JSON đúng cấu trúc mà code có thể parse được.
    schema = {
        "type": "object",
        "properties": {
            "agents": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "agent": {"type": "string", "enum": agent_ids},
                        # Hướng dẫn rõ: task phải là prompt đầy đủ, có thể điều chỉnh focus
                        "task": {
                            "type": "string",
                            "description": (
                                "Prompt đầy đủ gửi cho agent này. "
                                "PHẢI bao gồm toàn bộ nội dung câu hỏi gốc của user. "
                                "Có thể thêm hướng dẫn focus vào phần agent đó phụ trách, "
                                "nhưng KHÔNG được rút gọn hay bỏ bớt thông tin gốc."
                            )
                        }
                    },
                    "required": ["agent", "task"]
                }
            }
        },
        "required": ["agents"]
    }

    sys_instruction = (
        "Bạn là điều phối viên hệ thống đa agent. Hãy phân tích yêu cầu của người dùng, "
        "chia nhỏ việc và định tuyến tới các agent thích hợp nhất dựa vào danh sách dưới đây.\n"
        "Quy tắc:\n"
        "- Sáng tác/vui vẻ -> Dùng các agent thích hợp, KHÔNG dùng researcher.\n"
        "- Tra cứu/tìm kiếm thông tin thực tế -> researcher.\n"
        "- Lập trình/code -> coder.\n"
        "- Dịch thuật -> translator.\n"
        "- Không chọn agent có vision/thiết kế nếu câu hỏi chỉ là văn bản/code thông thường.\n"
        "- Chỉ trả về mảng rỗng nếu chỉ là chào hỏi, xã giao hoặc hỏi về BFF.\n"
        "- Trường 'task' PHẢI chứa đầy đủ nội dung câu hỏi gốc, không được tóm tắt hay rút gọn.\n"
        f"Danh sách agent:\n{json.dumps(snapshot, indent=2, ensure_ascii=False)}"
    )

    # Thêm history vào messages để router có đủ context
    recent_history = history[-6:] if len(history) > 6 else history  # giới hạn để tránh context quá dài
    messages = [
        llm.system_message(sys_instruction),
        *recent_history,
        {"role": "user", "content": user_text}
    ]

    try:
        routing_res = await llm.chat_json(cfg, messages, schema)
        decision = []
        for item in routing_res.get("agents", []):
            aid = item.get("agent")
            task = item.get("task", "").strip()
            
            # Safety net: nếu LLM vẫn trả task rỗng/quá ngắn, fallback về user_text gốc
            if not task or len(task) < 10:
                task = user_text
                
            if aid in agent_ids:
                decision.append((aid, task))

        # Deduplicate
        seen = set()
        deduped = []
        for aid, t in decision:
            if aid not in seen:
                seen.add(aid)
                deduped.append((aid, t))
        return deduped[:MAX_AGENTS]
    except Exception as e:
        logger.error(f"Router decision LLM call failed: {e}")
        return []

async def call_agent(http_client: httpx.AsyncClient, port: int, agent: Dict[str, Any], prompt: str) -> str:
    """Invokes agent endpoint via JSON-RPC POST."""
    agent_id = agent["id"]
    url = f"http://localhost:{port}/agents/{agent_id}"
    payload = {
        "jsonrpc": "2.0",
        "id": "1",
        "method": "SendMessage",
        "params": {
            "message": {
                "message_id": str(uuid.uuid4()),
                "role": "ROLE_USER",
                "parts": [{"text": prompt}]
            }
        }
    }
    headers = {"X-Agent-ID": agent_id, "A2A-Version": "1.0"}
    try:
        resp = await http_client.post(url, json=payload, headers=headers, timeout=120.0)
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            # Agent returned JSON-RPC error; raise to be handled below
            raise ValueError(f"Agent JSON-RPC error: {data['error']}")
        result = data.get("result", {})
        logger.info(f" prompt ========= {prompt}")
        logger.info(f" result ========= {result}")
        parts = result.get("parts", [])
        return "".join(p.get("text", "") for p in parts if p.get("text"))
    except Exception as e:
        # If agent fails due to protocol/version or other agent runtime errors,
        # fallback to using the orchestrator's LLM with the agent's system_prompt
        logger.warning(f"Agent {agent_id} call failed, falling back to local LLM: {e}")
        try:
            cfg = {
                "model": agent.get("llm", {}).get("model", "qwen3:1.7b"),
                "temperature": agent.get("llm", {}).get("temperature", 0.3),
                "top_p": agent.get("llm", {}).get("top_p", 0.9),
                "top_k": agent.get("llm", {}).get("top_k", 40)
            }
            sys_prompt = agent.get("llm", {}).get("system_prompt", "Bạn là trợ lý.")
            messages = [llm.system_message(sys_prompt), {"role": "user", "content": prompt}]
            # Use chat_text (non-streaming) fallback
            text = await llm.chat_text(cfg, messages)
            return text
        except Exception as e2:
            logger.exception(f"Fallback local LLM also failed for agent {agent_id}: {e2}")
            raise e

async def _run_agents(cands: List[Dict[str, Any]], decisions: List[Tuple[str, str]], port: int, app: FastAPI) -> Dict[str, str]:
    """Triggers multiple agents parallel execution inside ASGITransport."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=f"http://localhost:{port}") as http_client:
        tasks = []
        agent_map = {c["id"]: c for c in cands}
        for agent_id, prompt in decisions:
            agent = agent_map[agent_id]
            async def _run_one(ag, pr):
                toolevents.set_agent(ag["id"])
                try:
                    reply = await call_agent(http_client, port, ag, pr)
                    return ag["id"], reply
                except Exception as e:
                    logger.error(f"Failed to execute agent {ag['id']}: {e}")
                    return ag["id"], f"Lỗi thực thi agent: {e}"
            tasks.append(_run_one(agent, prompt))
        results = await asyncio.gather(*tasks)
        return dict(results)

def _split_warnings(text: str) -> Tuple[str, List[str]]:
    """Extracts warning sections from text."""
    pattern = re.compile(r"\[TOOL_WARNING\].*?\[/TOOL_WARNING\]", re.DOTALL)
    warnings = pattern.findall(text)
    clean_text = pattern.sub("", text).strip()
    return clean_text, warnings

def _append_warnings(text: str, warnings: List[str]) -> str:
    """Appends warning blocks back to the synthesized response."""
    if not warnings:
        return text
    return text + "\n\n" + "\n".join(warnings)

async def _synth_response(
    cfg: Dict[str, Any],
    user_text: str,
    agent_replies: Dict[str, str],
    on_meta: Optional[Callable] = None
) -> AsyncGenerator[str, None]:
    """Generates a cohesive response synthesizing facts from other agents."""
    
    all_warnings = []
    clean_replies = {}
    for aid, reply in agent_replies.items():
        clean_rep, warnings = _split_warnings(reply)
        clean_replies[aid] = clean_rep
        all_warnings.extend(warnings)

    # Build agent block rõ ràng, đánh số để LLM dễ track
    agent_blocks = ""

    sys_instruction = (
        "Bạn là trợ lý tổng hợp thông tin. Nhiệm vụ của bạn là ghép kết quả từ nhiều agent "
        "thành một câu trả lời hoàn chỉnh cho người dùng.\n\n"
        "QUY TẮC BẮT BUỘC:\n"
        "1. Phải sử dụng thông tin từ TẤT CẢ các agent được liệt kê — không được bỏ sót agent nào.\n"
        "2. GIỮ NGUYÊN mọi số liệu, tên riêng, code, URL, dữ liệu cụ thể từ agent reply — "
        "TUYỆT ĐỐI không paraphrase làm mất thông tin.\n"
        "3. KHÔNG tự bịa thêm bất kỳ thông tin nào ngoài những gì agent đã cung cấp.\n"
        "4. Nếu các agent cung cấp thông tin bổ sung nhau → tích hợp liền mạch.\n"
        "5. Nếu các agent mâu thuẫn nhau → nêu rõ mâu thuẫn, trích dẫn cụ thể từng agent.\n"
        "6. Ngôn ngữ đầu ra: tiếng Việt (giữ nguyên thuật ngữ kỹ thuật, code, tên riêng bằng tiếng Anh).\n"
        "7. Không thêm lời mở đầu kiểu 'Dưới đây là tổng hợp...', đi thẳng vào nội dung."
    )

    prompt = (
        f"Câu hỏi của người dùng: {user_text}\n\n"
        f"Kết quả từ {len(clean_replies)} agent chuyên môn:\n\n"
        f"{agent_blocks}"
        "Hãy tổng hợp thành câu trả lời hoàn chỉnh, tích hợp đầy đủ thông tin từ tất cả agent trên."
    )

    messages = [
        llm.system_message(sys_instruction),
        {"role": "user", "content": prompt}
    ]

    accumulated_text = []
    async for chunk in llm.stream_text(cfg, messages, on_meta=on_meta):
        accumulated_text.append(chunk)
        yield chunk

    warnings_append = _append_warnings("", all_warnings)
    if warnings_append:
        yield warnings_append

# --- API Router and Endpoints ---
from fastapi import APIRouter, Response

orchestrator_router = APIRouter()

@orchestrator_router.get("/api/orchestrator")
async def get_orchestrator_settings():
    return store.load_settings().get("orchestrator", {})

@orchestrator_router.post("/api/orchestrator")
async def update_orchestrator_settings(settings: Dict[str, Any]):
    curr = store.load_settings()
    curr["orchestrator"] = settings
    store.save_settings(curr)
    return {"status": "success"}

@orchestrator_router.post("/api/chat")
async def rest_chat(req_data: Dict[str, Any], request: Request):
    """Stateless REST (non-streaming) fallback endpoint."""
    prompt = req_data.get("message", "")
    history = req_data.get("history", [])
    port = request.url.port or 8090
    
    # 1. Routing decision
    agents = store.load_agents()
    cands = [a for a in agents if a["enabled"] and a["installed"]]
    decisions = await _route_decision(prompt, history, cands)
    
    if not decisions:
        # Direct response from BFF
        cfg = orch_config()
        messages = [
            llm.system_message("Bạn là trợ lý ảo BFF. Hãy trả lời câu hỏi trực tiếp."),
            *history,
            {"role": "user", "content": prompt}
        ]
        ans = await llm.chat_text(cfg, messages)
        return {
            "answer": ans,
            "agents_used": [],
            "routing": "direct"
        }
    else:
        # Run parallel agents
        agent_replies = await _run_agents(cands, decisions, port, request.app)
        
        # Synth response
        cfg = orch_config()
        text_parts = []
        async for chunk in _synth_response(cfg, prompt, agent_replies):
            text_parts.append(chunk)
            
        routing = "auto-multi" if len(decisions) > 1 else "auto"
        # check mentions
        has_mention = any(f"@{c['id']}" in prompt for c in cands)
        if has_mention:
            routing = "mention-multi" if len(decisions) > 1 else "mention"
            
        return {
            "answer": "".join(text_parts),
            "agents_used": [d[0] for d in decisions],
            "routing": routing
        }

@orchestrator_router.post("/chat")
async def sse_chat(request: Request):
    """SSE streaming chat endpoint (primary endpoint used by UI)."""
    body = await request.json()
    prompt = body.get("message", "")
    history = body.get("history", [])
    port = request.url.port or 8090
    
    async def event_generator():
        async for event in chat_stream_generator(prompt, history, port, request.app):
            yield f"event: {event['event']}\ndata: {event['data']}\n\n"
            
    return StreamingResponse(event_generator(), media_type="text/event-stream")

async def chat_stream_generator(prompt: str, history: List[Dict[str, Any]], port: int, app: FastAPI) -> AsyncGenerator[Dict[str, str], None]:
    """Generates SSE payload dictionaries sequentially."""
    t0 = time.time()
    meta_stats = {"completion_tokens": 0, "prompt_tokens": 0, "gen_seconds": 0.0}
    
    def on_meta(meta):
        meta_stats["completion_tokens"] += meta["completion_tokens"]
        meta_stats["prompt_tokens"] += meta["prompt_tokens"]

    try:
        yield {"event": "status", "data": json.dumps({"text": "Đang định tuyến…"}, ensure_ascii=False)}
        
        agents = store.load_agents()
        cands = [a for a in agents if a["enabled"] and a["installed"]]
        decisions = await _route_decision(prompt, history, cands)
        
        if not decisions:
            yield {"event": "meta", "data": json.dumps({"agents_used": [], "routing": "direct"})}
            yield {"event": "status", "data": json.dumps({"text": "BFF đang trả lời trực tiếp…"}, ensure_ascii=False)}
            
            cfg = orch_config()
            messages = [
                llm.system_message("Bạn là trợ lý ảo BFF. Hãy trả lời câu hỏi trực tiếp một cách thân thiện."),
                *history,
                {"role": "user", "content": prompt}
            ]
            
            gen_t0 = time.time()
            async for delta in llm.stream_text(cfg, messages, on_meta=on_meta):
                yield {"event": "delta", "data": json.dumps({"text": delta}, ensure_ascii=False)}
            meta_stats["gen_seconds"] = time.time() - gen_t0
            
        else:
            routing = "auto"
            has_mention = any(f"@{c['id']}" in prompt for c in cands)
            if has_mention:
                routing = "mention-multi" if len(decisions) > 1 else "mention"
            else:
                routing = "auto-multi" if len(decisions) > 1 else "auto"
                
            agents_used = [d[0] for d in decisions]
            yield {"event": "meta", "data": json.dumps({"agents_used": agents_used, "routing": routing})}
            yield {
                "event": "status",
                "data": json.dumps({"text": f"Đang xử lý song song với {', '.join(agents_used)}…"}, ensure_ascii=False)
            }
            
            tool_queue = asyncio.Queue()
            toolevents.set_reporter(lambda ev: tool_queue.put_nowait(ev))
            
            run_task = asyncio.create_task(_run_agents(cands, decisions, port, app))
            
            while not run_task.done() or not tool_queue.empty():
                try:
                    event = tool_queue.get_nowait()
                    yield {"event": "tool", "data": json.dumps(event, ensure_ascii=False)}
                except asyncio.QueueEmpty:
                    if run_task.done():
                        break
                    await asyncio.sleep(0.05)
            
            agent_replies = await run_task
            yield {"event": "status", "data": json.dumps({"text": "Đang tổng hợp câu trả lời…"}, ensure_ascii=False)}
            
            cfg = orch_config()
            gen_t0 = time.time()
            async for delta in _synth_response(cfg, prompt, agent_replies, on_meta=on_meta):
                yield {"event": "delta", "data": json.dumps({"text": delta}, ensure_ascii=False)}
            meta_stats["gen_seconds"] = time.time() - gen_t0
            
        toolevents.set_reporter(None)
        
        total_sec = time.time() - t0
        gen_sec = meta_stats["gen_seconds"] if meta_stats["gen_seconds"] > 0 else total_sec
        tps = meta_stats["completion_tokens"] / gen_sec if gen_sec > 0 else 0
        
        stats_payload = {
            "tokens": meta_stats["completion_tokens"],
            "prompt_tokens": meta_stats["prompt_tokens"],
            "seconds": round(total_sec, 2),
            "gen_seconds": round(gen_sec, 2),
            "tps": round(tps, 2),
            "exact": True
        }
        yield {"event": "stats", "data": json.dumps(stats_payload)}
        yield {"event": "done", "data": json.dumps({})}
        
    except Exception as e:
        logger.exception("SSE stream error: %s", e)
        yield {"event": "error", "data": json.dumps({"text": str(e)}, ensure_ascii=False)}

