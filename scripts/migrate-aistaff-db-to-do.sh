#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
MARGA_STATE="${MARGA_DO_STATE:-/Volumes/Wotg Drive Mike/GitHub/marga-platform/state/digitalocean-margabase.env}"
DUMP="${1:-}"

if [[ -z "$DUMP" ]]; then
  if [[ -f "$HOME/AIStaff Backups/Database/latest-dump.path" ]]; then
    DUMP="$(cat "$HOME/AIStaff Backups/Database/latest-dump.path")"
  else
    echo "Usage: $0 [path/to/aistaff.dump]" >&2
    exit 1
  fi
fi

[[ -f "$DUMP" ]] || { echo "Dump not found: $DUMP" >&2; exit 1; }
[[ -f "$MARGA_STATE" ]] || { echo "Missing DO state file: $MARGA_STATE" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "$MARGA_STATE"
set +a

: "${DO_PGHOST:?DO_PGHOST missing}"
: "${DO_PGPORT:?DO_PGPORT missing}"
: "${DO_PGUSER:?DO_PGUSER missing}"
: "${DO_PGPASSWORD:?DO_PGPASSWORD missing}"
: "${DO_PGSSLMODE:?DO_PGSSLMODE missing}"

DB_NAME="${AISTAFF_DB_NAME:-aistaff_click}"
export PGPASSWORD="$DO_PGPASSWORD"

PSQL=( "$PG_BIN/psql" -h "$DO_PGHOST" -p "$DO_PGPORT" -U "$DO_PGUSER" -d defaultdb -v ON_ERROR_STOP=1 )
PG_RESTORE=( "$PG_BIN/pg_restore" -h "$DO_PGHOST" -p "$DO_PGPORT" -U "$DO_PGUSER" -d "$DB_NAME" --no-owner --no-acl )

echo "Checking managed Postgres at ${DO_PGHOST}:${DO_PGPORT}..."
"${PSQL[@]}" -Atc "select 1" >/dev/null

EXISTS="$("${PSQL[@]}" -Atc "select 1 from pg_database where datname = '$DB_NAME'")"
if [[ "$EXISTS" != "1" ]]; then
  echo "Creating database ${DB_NAME}..."
  "${PSQL[@]}" -c "CREATE DATABASE \"$DB_NAME\";"
else
  echo "Database ${DB_NAME} already exists."
fi

TABLE_COUNT="$("${PSQL[@]}" -d "$DB_NAME" -Atc "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")"
if [[ "${TABLE_COUNT:-0}" -gt 0 && "${AISTAFF_FORCE_RESTORE:-0}" != "1" ]]; then
  echo "Database ${DB_NAME} already has ${TABLE_COUNT} public tables. Skipping restore."
  echo "Set AISTAFF_FORCE_RESTORE=1 to restore anyway."
  exit 0
fi

echo "Restoring ${DUMP} into ${DB_NAME}..."
"${PG_RESTORE[@]}" "$DUMP" || {
  echo "pg_restore reported errors (often safe for duplicate constraints). Verifying row counts..."
}

"${PSQL[@]}" -d "$DB_NAME" -Atc "
select 'companies=' || count(*) from companies;
select 'leads=' || count(*) from leads;
select 'conversations=' || count(*) from conversations;
select 'messages=' || count(*) from messages;
"

echo "Done. Use DATABASE_URL with database ${DB_NAME} and sslmode=require on the droplet."
