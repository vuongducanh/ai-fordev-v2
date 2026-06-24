Tóm tắt luồng hệ thống và luồng A2A / LLM

1) Tổng quan luồng của dự án

- Frontend (Chat UI) gửi yêu cầu chat tới backend thông qua SSE POST /chat (primary) hoặc REST POST /api/chat (fallback).
- Backend Orchestrator (backend/app/orchestrator.py) tiếp nhận: thực hiện _route_decision() để quyết định agent, gọi _run_agents() song song tới các agent đã mount, rồi tổng hợp kết quả bằng _synth_response() và stream trả về UI qua SSE events.
- Agents được mount động bởi host.mount_agent() (backend/app/host.py): tạo AgentCard, RequestHandler A2A và JSON-RPC routes tại /agents/{agent_id}.
- Agent runtime (backend/app/agents/executor.py) chạy thực thi theo yêu cầu JSON-RPC, phát event qua EventQueue; orchestrator thu nhận tool events qua toolevents reporter và đưa về client.
- Store (backend/app/core/store.py) lưu agents/settings/plugins; quản lý trạng thái enabled/installed để mount/unmount.

2) Luồng A2A (public POST -> A2A agent endpoint)

- Orchestrator gọi agent qua HTTP JSON-RPC POST tới http://localhost:{port}/agents/{agent_id}.
- Payload JSON-RPC mẫu (SendMessage):
  {
    "jsonrpc": "2.0",
    "id": "1",
    "method": "SendMessage",
    "params": { "message": { "role": "ROLE_USER", "parts": [{ "text": "<prompt>" }] } }
  }
- Host.mount_agent() tạo các route A2A bằng create_agent_card_routes và create_jsonrpc_routes; card path: /.well-known/agent-card.json; rpc path: /agents/{id}.
- Khi agent thực thi, AgentLLMExecutor.emit các event (WORKING, Message, TaskStatusUpdateEvent) vào EventQueue; DefaultRequestHandler (a2a) trả dữ liệu streaming back cho caller.
- Nếu call_agent gặp lỗi (endpoint không phản hồi hoặc trả về lỗi), orchestrator fallback: dùng llm.chat_text() với system_prompt của agent để sinh phản hồi thay thế.

3) Luồng LLM: load agent phù hợp và quyết định routing

- Danh sách ứng viên (cands) lấy từ store.load_agents(), lọc agent["enabled"] và agent["installed"].

- _route_decision(user_text, history, cands):
  - Bước 1: Kiểm tra mention explicit — tìm chuỗi "@{agent_id}" trong user_text. Nếu có, tách mention và trả ngay tuple (agent_id, cleaned_prompt) (ưu tiên mentions, không cần LLM).
  - Bước 2: Nếu không có cands -> trả [] (để BFF trả lời trực tiếp).
  - Bước 3: LLM Router decision: xây cfg = orch_config(), runtime_snapshot(cands) chứa thông tin agent (id, name, skills, model), định nghĩa schema JSON (array of {agent, task}). Gọi llm.chat_json(cfg, messages, schema) với system instruction mô tả quy tắc routing. Kết quả: danh sách agent-task tuples, dedupe, giới hạn MAX_AGENTS.
  - Nếu call LLM lỗi -> log và trả [] (fallback to direct BFF).

- orch_config() lấy cấu hình mặc định (model, temperature, top_p, top_k) từ store.settings (orchestrator section).
- llm.* functions sử dụng adk_engine để chuẩn bị runner và chạy; chat_json ép output theo schema (sử dụng model lớp Pydantic từ adk_engine.schema_to_model)
- stream_text() dùng để streaming các chunk trả về client (SSE deltas).

4) Model/agent lifecycle (install / warm / unload)

- Manager endpoints (backend/app/manager.py) gọi các API: POST /api/agents/{id}/install để pull model; sử dụng ollama_client.pull_model_stream() để stream quá trình pull.
- ollama_client.warm_model / unload_model dùng HTTP tới Ollama để giữ model resident hoặc unload.
- Khi model được cài đặt và agent.enabled==true, host.mount_agent() sẽ mount route; orchestrator sẽ đưa agent vào cands trên lần gọi tiếp theo.

5) Event contract (SSE) — các event chính

- status: { text }
- meta: { agents_used: string[], routing: string }
- tool: { agent, tool, status: 'start'|'done'|'error', detail }
- delta: { text } (streamed content chunks)
- stats: { tokens, prompt_tokens, seconds, gen_seconds, tps }
- error, done

6) Điểm chú ý / nơi chỉnh sửa khi cần thay đổi hành vi

- Thay đổi chính sách routing -> backend/app/orchestrator.py::_route_decision
- Thay đổi cách mount/unmount -> backend/app/host.py::mount_agent / unmount_agent
- Thay đổi execution/emit events -> backend/app/agents/executor.py::AgentLLMExecutor.execute
- Thay đổi model pull/warm logic -> backend/app/core/ollama.py

Kết luận

File này tóm tắt luồng chính: Frontend -> Orchestrator -> (routing bằng rules hoặc LLM) -> gọi JSON-RPC tới agents (A2A) -> agents thực thi & emit events -> Orchestrator tổng hợp bằng LLM -> SSE streaming về UI. Nếu cần, có thể thêm sequence diagram, ví dụ payload đầy đủ, hoặc commit tài liệu này vào repo (đã tạo present.md).