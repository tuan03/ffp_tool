#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================================"
echo "         CÀI ĐẶT FFP SEO WORKER CHO CODEX (TỰ ĐỘNG)"
echo "============================================================"
echo ""

# 1. Kiểm tra Python 3.11+
PYTHON_BIN=""
for cmd in python3 python py; do
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
if [ ! -f "$DIR/.venv/bin/python" ]; then
  echo "[*] Đang khởi tạo môi trường ảo Python (.venv)..."
  "$PYTHON_BIN" -m venv "$DIR/.venv"
fi

# 3. Cài đặt thư viện dependencies
echo "[*] Đang kiểm tra và cài đặt thư viện..."
"$DIR/.venv/bin/python" -m pip install -q -r "$DIR/requirements.txt"

# 4. Đăng nhập Token
echo ""
echo "============================================================"
echo "BƯỚC 1: ĐĂNG NHẬP TOKEN CỦA BẠN"
echo ""
echo "Hãy dán FFP Token bạn vừa copy từ trang web."
echo "CHÚ Ý: Ký tự sẽ bị ẩn khi dán để bảo mật."
echo "Dán xong hãy bấm phím ENTER:"
echo "============================================================"
echo ""

"$DIR/.venv/bin/python" "$DIR/ffp_worker.py" login --endpoint https://ffp.b6-team.site/mcp/seo-worker

# 5. Cấu hình vào Codex Workspace
echo ""
echo "============================================================"
echo "BƯỚC 2: CẤU HÌNH VÀO CODEX WORKSPACE"
echo "============================================================"
echo ""
CURRENT_DIR="$(pwd)"
read -r -p "Nhập đường dẫn thư mục Codex workspace (Enter để dùng: $CURRENT_DIR): " TARGET_WS
TARGET_WS="${TARGET_WS:-$CURRENT_DIR}"
TARGET_WS="${TARGET_WS%\"}"
TARGET_WS="${TARGET_WS#\"}"

mkdir -p "$TARGET_WS"

if "$DIR/.venv/bin/python" "$DIR/ffp_worker.py" setup --endpoint https://ffp.b6-team.site/mcp/seo-worker --workspace "$TARGET_WS" 2>/dev/null; then
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
