#!/bin/bash
# Berabox Snapshot Restore Script
# Streams snapshots via HTTP with lz4 decompression directly to target (zero copies).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BERABOX_ROOT="$(dirname "$SCRIPT_DIR")"
INSTALLATIONS_DIR="${BB_CONFIG_INSTALLATIONS_DIR:-$BERABOX_ROOT/installations}"

source "$SCRIPT_DIR/common.sh"

usage() {
    echo "Usage: $0 --installation <name> [--skip-el]"
    echo ""
    echo "Restore snapshots for an installation. Streams via HTTP with zero intermediate copies."
    echo ""
    echo "Options:"
    echo "  --installation <name>    Installation name"
    echo "  --skip-el               Only restore CL snapshot; skip EL"
}

# Ensure CL and EL are stopped before touching data.
ensure_services_stopped() {
    local installation="$1"
    local cl_service="${installation}-cl"
    local el_service="${installation}-el"
    local cl_active="" el_active=""

    cl_active=$(systemctl --user is-active "$cl_service" 2>/dev/null || true)
    el_active=$(systemctl --user is-active "$el_service" 2>/dev/null || true)

    if [[ "$cl_active" == "active" ]] || [[ "$el_active" == "active" ]]; then
        log_step "Stopping $installation services for snapshot..."
        "${SCRIPT_DIR}/systemd-manage.sh" stop "$installation" || true
    fi
}

# Get latest snapshot URL from index.csv for a given type
get_snapshot_url() {
    local index_file="$1"
    local snapshot_type="$2"
    
    # Skip header, find first matching type (latest by date), extract URL (column 7)
    awk -F',' -v type="$snapshot_type" '
        NR > 1 && $1 == type { print $7; exit }
    ' "$index_file"
}

# Stream snapshot via HTTP with lz4 decompression directly to target
stream_snapshot() {
    local url="$1"
    local target_dir="$2"
    local component_name="$3"
    
    log_step "Streaming $component_name snapshot from $url"
    log_info "Extracting directly to $target_dir (lz4 decompression)"
    
    mkdir -p "$target_dir"
    
    # Stream: HTTP -> lz4 decompress -> tar extract -> target (zero intermediate files)
    if ! curl -sfL "$url" | lz4 -d | tar -x -C "$target_dir"; then
        log_error "Failed to stream and extract $component_name snapshot from $url"
        return 1
    fi
    
    log_result "✓ Successfully extracted $component_name snapshot"
}

INSTALLATION_NAME=""
SKIP_EL=false
SNAPSHOT_INDEX_URL="${SNAPSHOT_INDEX_URL:-https://snapshots.berachain.com/index.csv}"

while [[ $# -gt 0 ]]; do
    case $1 in
        --installation)
            INSTALLATION_NAME="$2"
            shift 2
            ;;
        --skip-el)
            SKIP_EL=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

if [[ -z "$INSTALLATION_NAME" ]]; then
    log_error "Installation name required"
    usage
    exit 1
fi

INSTALLATION_DIR="$INSTALLATIONS_DIR/$INSTALLATION_NAME"
INSTALLATION_TOML="$INSTALLATION_DIR/installation.toml"

if [[ ! -f "$INSTALLATION_TOML" ]]; then
    log_error "Installation '$INSTALLATION_NAME' not found"
    exit 1
fi

chain=$(bb_parse_toml_value "$INSTALLATION_TOML" "chain" || true)
el_client=$(bb_parse_toml_value "$INSTALLATION_TOML" "el_client" || true)
archive_mode=$(bb_parse_toml_value "$INSTALLATION_TOML" "archive_mode" || echo "false")

if [[ -z "$chain" ]]; then
    log_error "Could not read chain from $INSTALLATION_TOML"
    exit 1
fi

CL_DATA_DIR="${INSTALLATION_DIR}/data/cl"
EL_CHAIN_DIR="${INSTALLATION_DIR}/data/el/chain"

ensure_services_stopped "$INSTALLATION_NAME"

log_operation "Fetching snapshots for $INSTALLATION_NAME ($chain + ${el_client:-geth})"

# Fetch index.csv
index_file=$(mktemp)
trap 'rm -f "$index_file"' EXIT

log_step "Fetching snapshot index from $SNAPSHOT_INDEX_URL"
if ! curl -sfL -o "$index_file" "$SNAPSHOT_INDEX_URL"; then
    log_error "Failed to fetch snapshot index"
    exit 1
fi

# Determine snapshot types based on archive_mode
if [[ "$archive_mode" == "true" ]]; then
    cl_type="beacon-kit-archive"
    case "$el_client" in
        geth) el_type="geth-archive" ;;
        reth) el_type="reth-archive" ;;
        *) el_type="geth-archive" ;;
    esac
else
    cl_type="beacon-kit-pruned"
    case "$el_client" in
        geth) el_type="geth-pruned" ;;
        reth) el_type="reth-pruned" ;;
        *) el_type="geth-pruned" ;;
    esac
fi

# Process CL snapshot
log_step "Processing consensus layer snapshot (type: $cl_type)"
cl_url=$(get_snapshot_url "$index_file" "$cl_type")

if [[ -z "$cl_url" ]]; then
    log_error "No CL snapshot found for type: $cl_type"
    exit 1
fi

stream_snapshot "$cl_url" "$CL_DATA_DIR" "CL"

# Process EL snapshot unless --skip-el
if [[ "$SKIP_EL" != "true" ]]; then
    log_step "Processing execution layer snapshot (type: $el_type)"
    el_url=$(get_snapshot_url "$index_file" "$el_type")
    
    if [[ -z "$el_url" ]]; then
        log_error "No EL snapshot found for type: $el_type"
        exit 1
    fi
    
    stream_snapshot "$el_url" "$EL_CHAIN_DIR" "EL"
fi

log_result "✓ Snapshot restore completed"
