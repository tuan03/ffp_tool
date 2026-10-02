#!/usr/bin/env bash
# FFP Tool - Remote Crawler Agent Installer (Linux / macOS)
set -euo pipefail

SERVER_URL="${1:-${FFP_SERVER_URL:-https://ffp.b6-team.site}}"
DISPLAY_NAME="${2:-$(hostname)}"
AGENT_ROOT="${FFP_AGENT_HOME:-$HOME/.local/share/ffp-crawler-agent}"
SERVER_URL="${SERVER_URL%/}"

case "$SERVER_URL" in
  http://*|https://*) ;;
  *) echo "Server URL must start with http:// or https://" >&2; exit 1 ;;
esac

echo "=========================================================="
echo "       FFP CRAWLER AGENT - REMOTE INSTALLER"
echo "=========================================================="
echo "-> Thu muc cai dat: $AGENT_ROOT"
echo "-> May chu: $SERVER_URL"

PYTHON_CMD=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
    PYTHON_CMD="$candidate"
    break
  fi
done
if [ -z "$PYTHON_CMD" ]; then
  echo "Khong tim thay Python >= 3.10. Hay cai Python truoc khi chay bo cai." >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "Khong tim thay curl." >&2
  exit 1
fi

mkdir -p "$AGENT_ROOT"
TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEMP_ROOT"' EXIT
ARCHIVE="$TEMP_ROOT/ffp-crawler-agent.tar.gz"
STAGING="$TEMP_ROOT/source"
mkdir -p "$STAGING"

echo "[1/5] Tai va xac minh ma nguon Agent..."
curl --fail --silent --show-error --location "$SERVER_URL/ffp-crawler-agent.tar.gz" --output "$ARCHIVE"
EXPECTED_HASH="$(curl --fail --silent --show-error --location "$SERVER_URL/ffp-crawler-agent.tar.gz.sha256" | awk '{print tolower($1)}')"
ACTUAL_HASH="$($PYTHON_CMD -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' "$ARCHIVE")"
if [ -z "$EXPECTED_HASH" ] || [ "$EXPECTED_HASH" != "$ACTUAL_HASH" ]; then
  echo "Agent package checksum verification failed." >&2
  exit 1
fi

"$PYTHON_CMD" - "$ARCHIVE" "$STAGING" <<'PY'
import pathlib
import sys
import tarfile

archive = pathlib.Path(sys.argv[1]).resolve()
destination = pathlib.Path(sys.argv[2]).resolve()
with tarfile.open(archive, "r:gz") as package:
    for member in package.getmembers():
        if member.issym() or member.islnk():
            raise RuntimeError("Agent package may not contain links")
        target = (destination / member.name).resolve()
        try:
            target.relative_to(destination)
        except ValueError as error:
            raise RuntimeError("Agent package contains an unsafe path") from error
    package.extractall(destination)
PY

test -f "$STAGING/scripts/amazon-crawler-agent.py"
test -f "$STAGING/src/modules/amazon-crawler/engine/requirements.txt"
cp -R "$STAGING"/. "$AGENT_ROOT"/

echo "[2/5] Tao virtual environment..."
VENV_DIR="$AGENT_ROOT/.venv"
if [ ! -x "$VENV_DIR/bin/python" ]; then
  "$PYTHON_CMD" -m venv "$VENV_DIR"
fi

echo "[3/5] Cai dat thu vien Agent..."
"$VENV_DIR/bin/python" -m pip install --disable-pip-version-check --upgrade pip >/dev/null
"$VENV_DIR/bin/python" -m pip install -r "$AGENT_ROOT/src/modules/amazon-crawler/engine/requirements.txt"

echo "[4/5] Cai dat Playwright Chromium..."
"$VENV_DIR/bin/python" -m playwright install chromium

echo "[5/5] Tao cau hinh va launcher..."
mkdir -p "$AGENT_ROOT/config"
CONFIG_FILE="$AGENT_ROOT/config/amazon-crawler-agent.json"
if [ ! -f "$CONFIG_FILE" ]; then
  "$PYTHON_CMD" - "$CONFIG_FILE" "$SERVER_URL" "$DISPLAY_NAME" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
payload = {
    "serverUrl": sys.argv[2],
    "displayName": sys.argv[3],
    "dataDirectory": ".runtime/agent-data",
    "heartbeatIntervalSeconds": 10,
}
path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY
fi

cat > "$AGENT_ROOT/chay-agent.sh" <<'SH'
#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
exec .venv/bin/python scripts/amazon-crawler-agent.py --project-root .
SH
chmod +x "$AGENT_ROOT/chay-agent.sh" "$AGENT_ROOT/scripts/login-pinterest.sh"

echo "=========================================================="
echo " CAI DAT HOAN TAT"
echo " Chay lai bang: $AGENT_ROOT/chay-agent.sh"
echo " Dang nhap Pinterest: $AGENT_ROOT/scripts/login-pinterest.sh"
echo "=========================================================="

if [ "${FFP_AGENT_NO_START:-0}" != "1" ]; then
  cd "$AGENT_ROOT"
  exec "$VENV_DIR/bin/python" scripts/amazon-crawler-agent.py --project-root .
fi
