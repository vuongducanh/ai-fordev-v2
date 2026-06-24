A2A Multi-Agent Chat — Hướng dẫn chạy dự án

Yêu cầu
- Python 3.12+, virtualenv (hoặc venv)
- Node.js (v18+) và npm

Chạy backend
Lưu ý: virtualenv không được commit vào git (xem .gitignore), nên mỗi máy cần tự tạo venv và cài phụ thuộc.

1. Tạo venv và cài phụ thuộc (chỉ làm lần đầu) — dùng uv:
   cd backend
   uv venv .venv
   VIRTUAL_ENV="$(pwd)/.venv" uv pip install \
     "a2a-sdk[http-server]>=1.1.0" "google-adk[extensions]>=2.3.0" \
     "litellm>=1.83.14" "fastapi>=0.138.0" "starlette>=0.30.0" \
     "uvicorn[standard]>=0.30.0" "sse-starlette>=2.0.0" "mcp>=1.2.0" \
     "pydantic>=2.0.0" "httpx>=0.20.0" "beautifulsoup4>=4.12.0" \
     "pytest>=8.0.0" "pytest-asyncio>=0.23.0"

   (Danh sách phụ thuộc lấy từ backend/pyproject.toml. Không dùng được
   `uv pip install -e .` vì layout có nhiều top-level package: app, data.)

2. Chạy server:
   cd backend
   .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8090 --reload

   Hoặc activate venv rồi chạy:
   cd backend
   source .venv/bin/activate
   uvicorn app.main:app --host 127.0.0.1 --port 8090 --reload

3. Kiểm tra: http://127.0.0.1:8090/health -> {"status":"ok"}

Lưu ý về Ollama
- Backend dùng LLM cục bộ qua Ollama (mặc định http://localhost:11434) với các
  model như qwen2.5:7b, deepseek-r1:8b. Server vẫn khởi động được khi thiếu Ollama,
  nhưng phần agent/chat sẽ lỗi 404. Để dùng đầy đủ:
  ollama serve
  ollama pull qwen2.5:7b
  ollama pull deepseek-r1:8b

Chạy frontend
1. Vào thư mục frontend, cài phụ thuộc nếu cần và chạy Vite:
   cd frontend
   npm install   # nếu chưa cài node_modules
   npm run dev

2. Mở giao diện: http://localhost:5173

Xem logs & dừng server
- Nếu chạy trong foreground: Ctrl+C để dừng.
- Nếu chạy background: tìm PID và kill:
  ps aux | grep uvicorn
  kill <PID>

Ghi chú
- Nếu thiếu thư viện Python, cài bằng pip trong venv: pip install -r requirements.txt (hoặc pip install các phụ thuộc trong pyproject.toml).
- Mặc định backend lắng nghe cổng 8090; frontend mặc định của Vite là 5173.

Liên hệ
- Nếu cần hỗ trợ thêm, gửi chi tiết lỗi hoặc logs để mình trợ giúp.