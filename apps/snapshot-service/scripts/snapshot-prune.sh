#!/bin/bash
set -euo pipefail

# snapshot-prune.sh - Remove the oldest snapshot of a given type
# Usage: snapshot-prune.sh <type>
# Types: reth-pruned, reth-archive, beacon-kit-pruned, beacon-kit-archive
# Returns 0 if a snapshot was pruned, 1 if no snapshots to prune

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/load-config.sh"
load_snapshot_config
DB_PATH="$SNAPSHOT_DB_PATH"

usage() {
    echo "Usage: $0 <type>" >&2
    echo "Types: reth-pruned, reth-archive, beacon-kit-pruned, beacon-kit-archive" >&2
    exit 1
}

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >&2
}

[[ $# -eq 1 ]] || usage

TYPE="$1"

# Validate type
case "$TYPE" in
    reth-pruned|reth-archive|beacon-kit-pruned|beacon-kit-archive)
        ;;
    *)
        echo "Unknown type: $TYPE" >&2
        exit 1
        ;;
esac

[[ -f "$DB_PATH" ]] || { log "Database not found: $DB_PATH"; exit 1; }

# Count total published snapshots of this type
COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM snapshots WHERE type='$TYPE' AND published=1;")

if [[ "$COUNT" -le 1 ]]; then
    log "Only $COUNT snapshot(s) of type '$TYPE' - refusing to delete the last one"
    exit 1
fi

# Find the oldest published snapshot of this type
OLDEST=$(sqlite3 "$DB_PATH" "SELECT id, path, filename FROM snapshots WHERE type='$TYPE' AND published=1 ORDER BY created_at ASC LIMIT 1;")

if [[ -z "$OLDEST" ]]; then
    log "No published snapshots of type '$TYPE' to prune"
    exit 1
fi

ID=$(echo "$OLDEST" | cut -d'|' -f1)
PATH_TO_DELETE=$(echo "$OLDEST" | cut -d'|' -f2)
FILENAME=$(echo "$OLDEST" | cut -d'|' -f3)

log "Pruning oldest snapshot: $FILENAME (id=$ID)"

# Delete the file if it exists
if [[ -f "$PATH_TO_DELETE" ]]; then
    rm -f "$PATH_TO_DELETE"
    log "Deleted file: $PATH_TO_DELETE"
else
    log "File already gone: $PATH_TO_DELETE"
fi

# Also delete the hash file if it exists
HASH_DIR="$(dirname "$PATH_TO_DELETE")/hashes"
HASH_FILE="$HASH_DIR/${FILENAME}.sha256"
if [[ -f "$HASH_FILE" ]]; then
    rm -f "$HASH_FILE"
    log "Deleted hash file: $HASH_FILE"
fi

# Remove from database
sqlite3 "$DB_PATH" "DELETE FROM snapshots WHERE id=$ID;"
log "Removed from database: id=$ID"

exit 0
