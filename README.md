A2A Multi-Agent Chat — Hướng dẫn chạy dự án

Yêu cầu
- Python 3.12+, virtualenv (hoặc venv)
- Node.js (v18+) và npm

Chạy backend
1. Từ thư mục gốc dự án:
   # (không cần active venv) dùng trực tiếp interpreter trong research_venv
   ./research_venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8090 --reload

   Hoặc activate venv rồi chạy:
   source research_venv/bin/activate
   cd backend
   uvicorn app.main:app --host 127.0.0.1 --port 8090 --reload

2. Kiểm tra: http://127.0.0.1:8090/health -> {"status":"ok"}

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