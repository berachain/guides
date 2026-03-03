#!/bin/bash
set -euo pipefail

# regenerate-index.sh - Regenerate HTML/CSV index from snapshot DB (with confirmation)
# Usage: SNAPSHOT_CONFIG_FILE=/path/to/config.env /opt/snapshot-service/scripts/regenerate-index.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/load-config.sh"

load_snapshot_config

echo "Regenerate index from snapshot database"
echo "  DB:      $SNAPSHOT_DB_PATH"
echo "  Output:  $SNAPSHOT_PUBLIC_ROOT (index.html, index.csv, metrics.txt)"
echo ""
read -r -p "Regenerate index? [y/N] " reply
case "${reply}" in
    [yY]|[yY][eE][sS])
        if "$SNAPSHOT_PYTHON_BIN" "$SCRIPT_DIR/generate-index.py"; then
            echo "Index regenerated successfully."
            exit 0
        else
            echo "ERROR: generate-index.py failed." >&2
            exit 1
        fi
        ;;
    *)
        echo "Cancelled."
        exit 0
        ;;
esac
