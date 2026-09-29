#!/usr/bin/env bash
# ==============================================================================
# FFP Tool - 1-Command Crawler Agent Installer (Linux / macOS)
# Usage:
#   curl -sSL https://ffp.b6-team.site/install-agent.sh | bash
# ==============================================================================
set -e

SERVER_URL="${1:-https://ffp.b6-team.site}"
DISPLAY_NAME="${2:-$(hostname)}"

echo ""
echo "=========================================================="
echo "       FFP CRAWLER AGENT - CAI DAT 1 LENH DUY NHAT        "
echo "=========================================================="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_ROOT="$SCRIPT_DIR"
if [ -d "$SCRIPT_DIR/../src/modules/amazon-crawler" ]; then
    AGENT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
cd "$AGENT_ROOT"

echo "-> Thu muc cai dat: $AGENT_ROOT"

# 1. Kiem tra Python
PYTHON_CMD=""
if command -v python3 &>/dev/null; then
    PYTHON_CMD="python3"
elif command -v python &>/dev/null; then
    PYTHON_CMD="python"
fi

if [ -z "$PYTHON_CMD" ]; then
    echo "LOI: Khong tim thay Python! Vui long cai dat Python >= 3.10."
    exit 1
fi

# 2. Tao venv
VENV_DIR="$AGENT_ROOT/.venv"
if [ ! -f "$VENV_DIR/bin/python" ]; then
    echo "[1/4] Tao virtual environment..."
    $PYTHON_CMD -m venv "$VENV_DIR"
fi

# 3. Cai dat thu vien
echo "[2/4] Cai dat thu vien..."
"$VENV_DIR/bin/pip" install --upgrade pip
if [ -f "$AGENT_ROOT/src/modules/amazon-crawler/engine/requirements.txt" ]; then
    "$VENV_DIR/bin/pip" install -r "$AGENT_ROOT/src/modules/amazon-crawler/engine/requirements.txt"
else
    "$VENV_DIR/bin/pip" install "playwright>=1.50,<2" "fastapi==0.116.1" "uvicorn[standard]==0.35.0" "beautifulsoup4>=4.12,<5" "python-dotenv>=1,<2" "websockets>=15,<16" "pillow>=11,<12" "httpx>=0.27.0" "numpy>=1.26,<3" "requests>=2.31,<3"
fi

# 4. Cai dat Chromium
echo "[3/4] Cai dat Playwright Chromium..."
"$VENV_DIR/bin/playwright" install chromium

# 5. Cau hinh
echo "[4/4] Khoi tao cau hinh..."
mkdir -p "$AGENT_ROOT/config"
CONFIG_FILE="$AGENT_ROOT/config/amazon-crawler-agent.json"
if [ ! -f "$CONFIG_FILE" ]; then
    cat <<EOF > "$CONFIG_FILE"
{
  "serverUrl": "$SERVER_URL",
  "displayName": "$DISPLAY_NAME",
  "dataDirectory": ".runtime/agent-data",
  "heartbeatIntervalSeconds": 10
}
EOF
fi

echo ""
echo "=========================================================="
echo " CAI DAT HOAN TAT THANH CONG!"
echo " Khoi chay bang lenh: .venv/bin/python scripts/amazon-crawler-agent.py --project-root ."
echo "=========================================================="
