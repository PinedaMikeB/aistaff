#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
AUTOMATION_HOME="${AISTAFF_AUTOMATION_HOME:-$HOME/Library/Application Support/AIStaff}"
ENV_FILE="${AISTAFF_ENV_FILE:-$AUTOMATION_HOME/state/aistaff.env}"
if [[ ! -f "$ENV_FILE" && -f "$PROJECT_DIR/.env" ]]; then
  ENV_FILE="$PROJECT_DIR/.env"
fi
BACKUP_ROOT="${AISTAFF_POSTGRES_BACKUP_DIR:-$HOME/AIStaff Backups/Database}"
LOG_DIR="$HOME/Library/Logs/AIStaff"
LOCK_DIR="$AUTOMATION_HOME/state/postgres-backup.lock"
RETENTION_DAYS="${AISTAFF_BACKUP_RETENTION_DAYS:-30}"
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"

mkdir -p "$BACKUP_ROOT" "$LOG_DIR" "$AUTOMATION_HOME/state"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Backup already running: $LOCK_DIR" >&2
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${DATABASE_URL:?DATABASE_URL missing from env}"

if [[ "$DATABASE_URL" =~ ^postgresql://([^:@/]+)(:([^@]*))?@([^:/]+)(:([0-9]+))?/([^?]+) ]]; then
  POSTGRES_USER="${BASH_REMATCH[1]}"
  POSTGRES_PASSWORD="${BASH_REMATCH[3]:-}"
  POSTGRES_HOST="${BASH_REMATCH[4]}"
  POSTGRES_PORT="${BASH_REMATCH[6]:-5432}"
  POSTGRES_DB="${BASH_REMATCH[7]}"
else
  echo "Could not parse DATABASE_URL: $DATABASE_URL" >&2
  exit 1
fi

TS="$(date +%Y%m%d-%H%M%S)"
DATE_TAG="$(date +%m%d%y)"
BACKUP_NAME="BU${DATE_TAG}-AIStaffDB"
BACKUP_DIR="$BACKUP_ROOT/$BACKUP_NAME"
if [[ -e "$BACKUP_DIR" ]]; then
  BACKUP_DIR="$BACKUP_ROOT/${BACKUP_NAME}-$TS"
fi
mkdir -p "$BACKUP_DIR"

DUMP="$BACKUP_DIR/aistaff-$TS.dump"
COUNTS="$BACKUP_DIR/aistaff-counts-$TS.txt"
META="$BACKUP_DIR/aistaff-$TS.meta.txt"

if [[ -n "$POSTGRES_PASSWORD" ]]; then
  export PGPASSWORD="$POSTGRES_PASSWORD"
fi

"$PG_BIN/pg_isready" -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB"

"$PG_BIN/psql" -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -Atc "
select 'companies=' || count(*) from companies;
select 'leads=' || count(*) from leads;
select 'conversations=' || count(*) from conversations;
select 'messages=' || count(*) from messages;
" > "$COUNTS"

"$PG_BIN/pg_dump" -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$DUMP"
"$PG_BIN/pg_restore" --list "$DUMP" >/dev/null

{
  echo "created_at=$(date -Iseconds)"
  echo "source_host=$POSTGRES_HOST"
  echo "source_port=$POSTGRES_PORT"
  echo "database=$POSTGRES_DB"
  echo "user=$POSTGRES_USER"
  echo "dump=$DUMP"
  echo "dump_size_bytes=$(wc -c < "$DUMP" | tr -d ' ')"
  echo "counts=$COUNTS"
} > "$META"

printf '%s\n' "$DUMP" > "$BACKUP_ROOT/latest-dump.path"
printf '%s\n' "$TS" > "$BACKUP_ROOT/latest-dump-ts.txt"
printf '%s\n' "$BACKUP_DIR" > "$BACKUP_ROOT/latest-folder.path"
cp "$COUNTS" "$BACKUP_ROOT/latest-counts.txt"

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'BU*-AIStaffDB*' -mtime +"$RETENTION_DAYS" -exec rm -rf {} +

echo "Backup complete: $DUMP"
cat "$COUNTS"
