#!/bin/bash
set -euo pipefail

# snapshot-publish.sh - Compute hash, insert into sqlite, move snapshot to public
# Usage: snapshot-publish.sh <type> <snapshot_file>
# Expects snapshot_file to be in a temp location, moves it to public directory

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/load-config.sh"
load_snapshot_config

DB_PATH="$SNAPSHOT_DB_PATH"
PUBLIC_DIR="$SNAPSHOT_PUBLIC_ROOT/snapshots"
INSTALLATIONS_DIR="$SNAPSHOT_INSTALLATIONS_DIR"

usage() {
    echo "Usage: $0 <type> <snapshot_file>" >&2
    exit 1
}

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >&2
}

error() {
    log "ERROR: $*"
    exit 1
}

[[ $# -eq 2 ]] || usage

TYPE="$1"
SNAPSHOT_FILE="$2"

[[ -f "$SNAPSHOT_FILE" ]] || error "Snapshot file not found: $SNAPSHOT_FILE"
[[ -f "$DB_PATH" ]] || error "Database not found: $DB_PATH"

# Determine public subdirectory based on type
case "$TYPE" in
    reth-pruned)
        SUBDIR="reth-pruned"
        INSTALLATION="reth-pruned"
        ;;
    reth-archive)
        SUBDIR="reth-archive"
        INSTALLATION="reth-archive"
        ;;
    beacon-kit-pruned)
        SUBDIR="beacon-kit-pruned"
        INSTALLATION="reth-pruned"
        ;;
    beacon-kit-archive)
        SUBDIR="beacon-kit-archive"
        INSTALLATION="reth-archive"
        ;;
    *)
        error "Unknown type: $TYPE"
        ;;
esac

DEST_DIR="$PUBLIC_DIR/$SUBDIR"
HASH_DIR="$DEST_DIR/hashes"

# Create directories if needed
mkdir -p "$DEST_DIR" "$HASH_DIR"

FILENAME=$(basename "$SNAPSHOT_FILE")
DEST_FILE="$DEST_DIR/$FILENAME"
HASH_FILE="$HASH_DIR/${FILENAME}.sha256"

# Extract metadata from filename
# Formats:
#   beacon-kit-{mode}-{block}-{version}.tar.lz4
#   bera-{client}-{mode}-{block}-{version}.tar.lz4

if [[ "$TYPE" == beacon-kit-* ]]; then
    # beacon-kit-pruned-12345678-v1.3.5.tar.lz4
    BLOCK_NUMBER=$(echo "$FILENAME" | sed -E 's/beacon-kit-[^-]+-([0-9]+)-.*/\1/')
    CL_VERSION=$(echo "$FILENAME" | sed -E 's/beacon-kit-[^-]+-[0-9]+-([^.]+\.[^.]+\.[^.]+)\.tar\.lz4/\1/')
    EL_VERSION=""
else
    # bera-reth-pruned-12345678-v1.3.1.tar.lz4
    BLOCK_NUMBER=$(echo "$FILENAME" | sed -E 's/bera-[^-]+-[^-]+-([0-9]+)-.*/\1/')
    EL_VERSION=$(echo "$FILENAME" | sed -E 's/bera-[^-]+-[^-]+-[0-9]+-([^.]+\.[^.]+\.[^.]+)\.tar\.lz4/\1/')
    
    # Read CL version from installation.toml
    TOML_FILE="$INSTALLATIONS_DIR/$INSTALLATION/installation.toml"
    CL_VERSION=$(grep '^beacon_kit' "$TOML_FILE" | cut -d'"' -f2)
fi

# Compute SHA256 hash
log "Computing SHA256 hash..."
SHA256=$(sha256sum "$SNAPSHOT_FILE" | cut -d' ' -f1)
log "SHA256: $SHA256"

# Get file size
SIZE_BYTES=$(stat -c%s "$SNAPSHOT_FILE")

# Move file to public directory (atomic on same filesystem)
log "Moving to public directory: $DEST_FILE"
mv "$SNAPSHOT_FILE" "$DEST_FILE"

# Write hash file
echo "$SHA256  $FILENAME" > "$HASH_FILE"

# Insert into database
log "Inserting into database..."
sqlite3 "$DB_PATH" << EOF
INSERT INTO snapshots (type, filename, path, size_bytes, block_number, el_version, cl_version, sha256, published)
VALUES ('$TYPE', '$FILENAME', '$DEST_FILE', $SIZE_BYTES, $BLOCK_NUMBER, $([ -n "$EL_VERSION" ] && echo "'$EL_VERSION'" || echo "NULL"), '$CL_VERSION', '$SHA256', 1);
EOF

log "Published: $FILENAME"
log "  Type: $TYPE"
log "  Block: $BLOCK_NUMBER"
log "  Size: $SIZE_BYTES bytes"
log "  SHA256: $SHA256"

exit 0
