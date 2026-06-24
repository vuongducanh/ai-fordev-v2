business-from-code.md

Tổng quan A2A (Agent-to-Agent, thực tế trong repo)

Mục tiêu: mô tả chính xác luồng A2A theo mã nguồn hiện tại (frontend -> backend -> local agents), nêu tên hàm, endpoint, payload mẫu và event contract để dev tích hợp.

1) Luồng tổng quát (dựa trên code)

- Frontend Chat UI (frontend/src/components/ChatView.tsx)
  - Hàm: handleSend -> gọi chatStream (frontend/src/lib/api.ts)
  - chatStream gọi POST /chat (SSE streaming) với body { message, history }

- Backend Orchestrator (backend/app/orchestrator.py)
  - Endpoints:
    - POST /api/chat  (stateless REST fallback)
    - POST /chat      (SSE streaming primary) <- chatStream gọi endpoint này
  - Luồng: _route_decision(...) quyết định các agent -> _run_agents(...) gọi agent song song -> _synth_response(...) tổng hợp -> gửi SSE events về client

- Gọi agent (internal JSON-RPC)
  - Target: http://localhost:{port}/agents/{agent_id}
  - JSON-RPC request (example):
    {
      "jsonrpc": "2.0",
      "id": "1",
      "method": "SendMessage",
      "params": { "message": { "role": "ROLE_USER", "parts": [{ "text": "<prompt>" }] } }
    }
  - Orchestrator function: call_agent(http_client, port, agent, prompt) performs POST and returns joined result.parts texts

- Agent registration & hosting (backend/app/host.py, backend/app/agents/card.py)
  - Manager endpoints (backend/app/manager.py) allow CRUD for agents: GET/POST /api/agents, DELETE /api/agents/{id}
  - When agent.enabled && agent.installed, manager calls host.mount_agent(app, agent, port)
  - mount_agent builds protobuf AgentCard via build_card(agent, port) and mounts routes:
    - /.well-known/agent-card.json -> create_agent_card_routes
    - /agents/{agent_id} (JSON-RPC) -> create_jsonrpc_routes

- Agent execution (backend/app/agents/executor.py)
  - Class: AgentLLMExecutor(AgentExecutor)
  - Key method: async execute(self, context: RequestContext, event_queue: EventQueue)
    - Reads agent config from store
    - Builds messages and runs llm (streaming or with tools)
    - Emits intermediate WORKING status deltas and final Message and TaskStatusUpdateEvent into event_queue
  - cancel(...) is defined as no-op

- Event propagation back to frontend
  - Orchestrator sets toolevents reporter to collect tool events into a queue
  - During _run_agents and chat_stream_generator orchestrator yields SSE events to client (status, meta, tool, delta, stats, error, done)
  - Frontend.consumeSSE parses SSE and ChatView applies updates to message.status, routing, agentsUsed, toolsUsed and appends delta text to content

2) Chỉ rõ hàm / endpoint quan trọng (theo file)

Frontend
- handleSend (frontend/src/components/ChatView.tsx)
- chatStream(message, history, onEvent, signal) (frontend/src/lib/api.ts)
- consumeSSE(reader, onEvent)
- API helpers: api.getAgents(), api.upsertAgent(), installAgentSSE(), installPluginSSE(), pullModelSSE()

Backend - Orchestrator
- orchestrator_router endpoints: POST /api/chat, POST /chat, GET/POST /api/orchestrator
- routing/exec functions: _route_decision, call_agent, _run_agents, _synth_response, chat_stream_generator

Backend - Management & Hosting
- manager_router endpoints: GET/POST /api/agents, DELETE /api/agents/{agent_id}, POST /api/agents/{agent_id}/install, /connect, /disconnect
- host.mount_agent(app, agent, port)
- host.unmount_agent(app, agent_id)
- agents card: build_card(agent_dict, port)

Agent runtime
- AgentLLMExecutor.execute(context, event_queue) (backend/app/agents/executor.py)
- a2a.server.request_handlers.DefaultRequestHandler used when mounting agents
- a2a.server.routes.create_jsonrpc_routes provides JSON-RPC entrypoints (method names used by orchestrator: SendMessage)

3) SSE event contract (what frontend expects)

Events (keys and example shapes):
- status: { text: string }
- meta: { agents_used: string[], routing: string }
- tool: { agent: string, tool: string, status: 'start'|'done'|'error', detail: string }
- delta: { text: string }               -- streaming chunks
- stats: { tokens, prompt_tokens, seconds, gen_seconds, tps }
- error: { text: string }
- done: {}

4) Example payloads (actual)

- SSE chat request (frontend -> backend)
POST /chat
Body: { "message": "Hãy tóm tắt tài liệu X", "history": [{"role":"user","content":"..."}] }

- JSON-RPC to agent (orchestrator -> agent HTTP endpoint)
POST http://localhost:8090/agents/{agent_id}
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "SendMessage",
  "params": {
    "message": {
      "role": "ROLE_USER",
      "parts": [{ "text": "<prompt for agent>" }]
    }
  }
}

- Manager API examples
GET /api/agents
POST /api/agents  (body: agent JSON config)
POST /api/agents/{agent_id}/install  (returns SSE stream from ollama_client.pull_model_stream)

5) Points to modify to change behavior
- Change routing LLM or rules: backend/app/orchestrator.py::_route_decision
- Change agent execution or event emission: backend/app/agents/executor.py::AgentLLMExecutor.execute
- Change mount path or card contents: backend/app/agents/card.py::build_card and backend/app/host.py::mount_agent
- UI mapping of events: frontend/src/components/ChatView.tsx and frontend/src/lib/api.ts::consumeSSE

6) Quick developer checklist for integration
- To add new agent: POST agent config to /api/agents; ensure installed=true and enabled=true, or call /api/agents/{id}/install to pull model then mount
- To call BFF from frontend: use chatStream -> POST /chat SSE; implement onEvent handlers for "status","meta","tool","delta","stats","error","done"
- To debug agent calls: inspect orchestrator.call_agent -> it POSTs JSON-RPC to /agents/{id}; use host.mounted_ids() (host.mounted_ids()) to list mounted agents

Kết luận
- Đây là mô tả chính xác luồng A2A hiện có trong repo: từ Chat UI -> orchestrator -> internal JSON-RPC tới agents -> event queue -> SSE trả về UI. Nếu muốn, có thể thêm sequence diagram, mapping file:line, hoặc xuất bản ghi chú cho từng event field. Nói rõ muốn format thêm (ví dụ: thêm diagram ASCII, hoặc commit file thay thế business.md) để tiếp tục.