#!/usr/bin/env bash
# ==============================================================================
# FFP Tool - Database Backup Script (Linux / macOS / VPS)
# Usage:
#   ./scripts/backup-db.sh
# Output:
#   backups/ffp_backup_YYYYMMDD_HHMMSS.sql.gz
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

BACKUP_DIR="$ROOT_DIR/backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/ffp_backup_${TIMESTAMP}.sql.gz"

DB_USER="ffp_tool"
DB_NAME="ffp_tool"
if [ -f .env ]; then
  VAL_USER=$(grep -E "^POSTGRES_USER=" .env | cut -d '=' -f2 | tr -d ' "' || true)
  VAL_NAME=$(grep -E "^POSTGRES_DB=" .env | cut -d '=' -f2 | tr -d ' "' || true)
  [ -n "$VAL_USER" ] && DB_USER="$VAL_USER"
  [ -n "$VAL_NAME" ] && DB_NAME="$VAL_NAME"
fi

echo "=========================================================="
echo " Starting Database Backup for FFP Tool"
echo " Database: $DB_NAME (User: $DB_USER)"
echo " Destination: $BACKUP_FILE"
echo "=========================================================="

# Check if database container is running
if ! docker compose ps database | grep -q "Up"; then
  echo "Error: Database service is not running. Please start it with 'docker compose up -d database'."
  exit 1
fi

docker compose exec -T database pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists | gzip > "$BACKUP_FILE"

if [ -s "$BACKUP_FILE" ]; then
  FILE_SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')
  echo "Backup successfully completed!"
  echo "File: $BACKUP_FILE ($FILE_SIZE)"
else
  echo "Error: Backup file is empty!"
  rm -f "$BACKUP_FILE"
  exit 1
fi
