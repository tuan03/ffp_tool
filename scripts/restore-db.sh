#!/usr/bin/env bash
# ==============================================================================
# FFP Tool - Database Restore Script (Linux / macOS / VPS)
# Usage:
#   ./scripts/restore-db.sh <path-to-backup-file>
# Example:
#   ./scripts/restore-db.sh backups/ffp_backup_20260929_120000.sql.gz
# ==============================================================================
set -e

BACKUP_FILE="$1"

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "Usage: $0 <path-to-backup-file>"
  echo "Error: Backup file not found!"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

DB_USER="ffp_tool"
DB_NAME="ffp_tool"
if [ -f .env ]; then
  VAL_USER=$(grep -E "^POSTGRES_USER=" .env | cut -d '=' -f2 | tr -d ' "' || true)
  VAL_NAME=$(grep -E "^POSTGRES_DB=" .env | cut -d '=' -f2 | tr -d ' "' || true)
  [ -n "$VAL_USER" ] && DB_USER="$VAL_USER"
  [ -n "$VAL_NAME" ] && DB_NAME="$VAL_NAME"
fi

echo "=========================================================="
echo " Starting Database Restore for FFP Tool"
echo " Database: $DB_NAME (User: $DB_USER)"
echo " Source file: $BACKUP_FILE"
echo "=========================================================="

if ! docker compose ps database | grep -q "Up"; then
  echo "Error: Database service is not running. Please start it first."
  exit 1
fi

if [[ "$BACKUP_FILE" == *.gz ]]; then
  gunzip -c "$BACKUP_FILE" | docker compose exec -T database psql -U "$DB_USER" -d "$DB_NAME"
else
  docker compose exec -T database psql -U "$DB_USER" -d "$DB_NAME" < "$BACKUP_FILE"
fi

echo "=========================================================="
echo " Database restored successfully!"
echo "=========================================================="
