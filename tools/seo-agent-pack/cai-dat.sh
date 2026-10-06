#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================================"
echo "         CÀI ĐẶT FFP SEO WORKER CHO CODEX (TỰ ĐỘNG)"
echo "============================================================"
echo ""

# 1. Kiểm tra Python 3.11+
PYTHON_BIN=""
for cmd in python3 python3.13 python3.12 python3.11 python py; do
  if command -v "$cmd" >/dev/null 2>&1; then
    if "$cmd" -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" 2>/dev/null; then
      PYTHON_BIN="$cmd"
      break
    fi
  fi
done

if [ -z "$PYTHON_BIN" ]; then
  echo "[LỖI] Máy tính chưa có Python 3.11 trở lên."
  echo "Vui lòng cài đặt Python 3.11+ từ https://www.python.org/downloads/"
  exit 1
fi

# 2. Khởi tạo môi trường ảo .venv
# Hỗ trợ cả Linux/macOS (.venv/bin/python) và Windows Git Bash (.venv/Scripts/python.exe)
VENV_PYTHON=""
if [ -f "$DIR/.venv/bin/python" ]; then
  VENV_PYTHON="$DIR/.venv/bin/python"
elif [ -f "$DIR/.venv/Scripts/python.exe" ]; then
  VENV_PYTHON="$DIR/.venv/Scripts/python.exe"
fi

if [ -z "$VENV_PYTHON" ]; then
  echo "[*] Đang khởi tạo môi trường ảo Python (.venv)..."
  if ! "$PYTHON_BIN" -m venv "$DIR/.venv"; then
    echo "[LỖI] Không thể tạo môi trường ảo .venv."
    echo "Nếu bạn dùng Ubuntu/Debian, hãy chạy: sudo apt install python3-venv"
    exit 1
  fi
  if [ -f "$DIR/.venv/bin/python" ]; then
    VENV_PYTHON="$DIR/.venv/bin/python"
  elif [ -f "$DIR/.venv/Scripts/python.exe" ]; then
    VENV_PYTHON="$DIR/.venv/Scripts/python.exe"
  else
    echo "[LỖI] Không tìm thấy file python trong môi trường ảo .venv."
    exit 1
  fi
fi

# 3. Cài đặt thư viện dependencies
echo "[*] Đang kiểm tra và cài đặt thư viện..."
if ! "$VENV_PYTHON" -m pip install -q -r "$DIR/requirements.txt"; then
  echo "[LỖI] Cài đặt thư viện thất bại. Vui lòng kiểm tra kết nối mạng."
  exit 1
fi

# 4. Đăng nhập Token
echo ""
echo "============================================================"
echo "BƯỚC 1: ĐĂNG NHẬP TOKEN CỦA BẠN"
echo ""
echo "Hãy dán FFP Token bạn vừa copy từ trang web."
echo "CHÚ Ý BẢO MẬT: Ký tự sẽ bị ẩn khi dán để chống nhìn trộm."
echo "Dán xong hãy bấm phím ENTER:"
echo "============================================================"
echo ""

if ! "$VENV_PYTHON" "$DIR/ffp_worker.py" login --endpoint https://ffp.b6-team.site/mcp/seo-worker; then
  echo ""
  echo "[LỖI] Đăng nhập thất bại."
  echo "Vui lòng kiểm tra lại token: tạo mới trên web và thử lại."
  echo ""
  exit 1
fi

# 5. Cấu hình vào Codex Workspace
echo ""
echo "============================================================"
echo "BƯỚC 2: CẤU HÌNH VÀO CODEX WORKSPACE"
echo "============================================================"
echo ""
CURRENT_DIR="$(pwd)"
echo "Nhập đường dẫn thư mục Workspace bạn mở trong Codex:"
echo "- Kéo thả thư mục từ Finder/File Manager vào đây rồi bấm Enter"
echo "- Hoặc bấm Enter ngay để dùng thư mục hiện tại: $CURRENT_DIR"
echo ""
read -r -p "> " TARGET_WS
TARGET_WS="${TARGET_WS:-$CURRENT_DIR}"

# Bỏ dấu nháy kép hoặc đơn nếu kéo thả từ Finder/File Manager
TARGET_WS="${TARGET_WS%\"}"
TARGET_WS="${TARGET_WS#\"}"
TARGET_WS="${TARGET_WS%\'}"
TARGET_WS="${TARGET_WS#\'}"

# Bỏ dấu gạch chéo cuối nếu có (trừ thư mục gốc /)
if [ "$TARGET_WS" != "/" ]; then
  TARGET_WS="${TARGET_WS%/}"
fi

# Hỗ trợ mở rộng dấu ngã ~ thành thư mục Home ($HOME)
if [[ "$TARGET_WS" == ~* ]]; then
  TARGET_WS="$HOME${TARGET_WS#~}"
fi

if [ ! -d "$TARGET_WS" ]; then
  echo "[*] Thư mục chưa tồn tại, đang tạo: $TARGET_WS"
  if ! mkdir -p "$TARGET_WS" 2>/dev/null; then
    echo "[LỖI] Không thể tạo thư mục: $TARGET_WS. Vui lòng kiểm tra lại quyền ghi."
    exit 1
  fi
fi

if "$VENV_PYTHON" "$DIR/ffp_worker.py" setup --endpoint https://ffp.b6-team.site/mcp/seo-worker --workspace "$TARGET_WS" 2>/dev/null; then
  echo "[OK] Đã thêm cấu hình MCP và Skill vào Workspace: $TARGET_WS"
else
  if [ -f "$TARGET_WS/.agents/skills/ffp-seo/SKILL.md" ]; then
    echo "[OK] Codex Workspace đã có cấu hình FFP từ trước. Token mới đã được cập nhật!"
  else
    echo "[LƯU Ý] Không thể thêm cấu hình tự động. Vui lòng kiểm tra quyền ghi thư mục."
  fi
fi

echo ""
echo "============================================================"
echo "[HOÀN TẤT] CÀI ĐẶT THÀNH CÔNG!"
echo ""
echo "Các bước tiếp theo:"
echo "1. Đóng và mở lại ứng dụng Codex."
echo "2. Mở thư mục Workspace trong Codex: $TARGET_WS"
echo "3. Nhập câu lệnh: Use \$ffp-seo để giao việc."
echo "============================================================"
