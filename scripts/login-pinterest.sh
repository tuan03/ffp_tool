#!/usr/bin/env bash
# ==============================================================================
# FFP Crawler Agent - Pinterest Login Script (Linux / macOS)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_DIR="$AGENT_ROOT/.venv"

echo "=========================================================="
echo "       DANG NHAP TAI KHOAN PINTEREST CHO CRAWLER"
echo "=========================================================="

if [ ! -f "$VENV_DIR/bin/python" ]; then
    echo "[!] Chua tim thay moi truong .venv! Dang chay install-agent.sh..."
    bash "$SCRIPT_DIR/install-agent.sh"
fi

echo "[*] Dang khoi chay trinh duyet Chromium..."
echo "[*] Hay dang nhap tai khoan Pinterest tren cua so trinh duyet."
echo "[*] Cua so se tu dong dong khi hoan tat."
echo ""

"$VENV_DIR/bin/python" "$AGENT_ROOT/src/modules/pinterest-pod/server/pinterest/pinterest_browser_login.py" "$@"
