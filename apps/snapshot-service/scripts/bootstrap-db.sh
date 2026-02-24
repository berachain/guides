#!/bin/bash
set -euo pipefail

# bootstrap-db.sh - Initialize or update snapshot SQLite schema
# Usage: bootstrap-db.sh [db_path]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA_PATH="$SCRIPT_DIR/../sql/schema.sql"
source "$SCRIPT_DIR/lib/load-config.sh"
load_snapshot_config
DB_PATH="${1:-$SNAPSHOT_DB_PATH}"

if [[ ! -f "$SCHEMA_PATH" ]]; then
    echo "Schema file not found: $SCHEMA_PATH" >&2
    exit 1
fi

DB_DIR="$(dirname "$DB_PATH")"
mkdir -p "$DB_DIR"

if [[ ! -f "$DB_PATH" ]]; then
    echo "Creating snapshot database: $DB_PATH"
else
    echo "Applying schema updates to: $DB_PATH"
fi

sqlite3 "$DB_PATH" < "$SCHEMA_PATH"
echo "Snapshot schema is ready at: $DB_PATH"
