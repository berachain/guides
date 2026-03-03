#!/bin/bash
set -euo pipefail

# snapshot-generate.sh - Generate a snapshot for a given type
# Usage: snapshot-generate.sh <type> <output_dir> [--skip-sync-check]
# Types: geth-pruned, reth-pruned, geth-archive, reth-archive, beacon-kit-pruned, beacon-kit-archive
# Output: Writes snapshot path to stdout on success, exits non-zero on failure
# Note: beacon-kit snapshots are typically generated immediately after reth snapshots with --skip-sync-check

# Set up DBUS environment for systemctl --user commands in cron context
setup_dbus_env() {
    local uid
    uid=$(id -u)
    export XDG_RUNTIME_DIR="/run/user/${uid}"
    export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"
    
    # Verify DBUS socket exists
    if [[ ! -S "${XDG_RUNTIME_DIR}/bus" ]]; then
        echo "ERROR: DBUS socket not found at ${XDG_RUNTIME_DIR}/bus" >&2
        return 1
    fi
}

setup_dbus_env

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/load-config.sh"
load_snapshot_config

INSTALLATIONS_DIR="$SNAPSHOT_INSTALLATIONS_DIR"
PUBLIC_RPC="$SNAPSHOT_PUBLIC_RPC"
MAX_BLOCK_LAG="$SNAPSHOT_MAX_BLOCK_LAG"
PYTHON_BIN="$SNAPSHOT_PYTHON_BIN"
BERABOX_BIN="$SNAPSHOT_BERABOX_BIN"
COSMPRUND_BIN="$SNAPSHOT_COSMPRUND_BIN"
SKIP_SYNC_CHECK=0

usage() {
    echo "Usage: $0 <type> <output_dir> [--skip-sync-check]" >&2
    echo "Types: reth-pruned, reth-archive, beacon-kit-pruned, beacon-kit-archive" >&2
    exit 1
}

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [snapshot-generate] $*" >&2
}

log_detail() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [snapshot-generate]   $*" >&2
}

error() {
    log "ERROR: $*"
    exit 1
}

# Enhanced error function with exit codes
error_with_code() {
    local message="$1"
    local code="$2"
    log "ERROR: $message (exit code: $code)"
    exit "$code"
}

# Exit codes:
# 1 - General error
# 2 - Service not running
# 3 - Service unhealthy (no PID)
# 4 - Service not synced
# 5 - Insufficient disk space
# 6 - File system error

[[ $# -ge 2 ]] || usage

TYPE="$1"
OUTPUT_DIR="$2"

# Parse optional flag
if [[ $# -ge 3 ]] && [[ "$3" == "--skip-sync-check" ]]; then
    SKIP_SYNC_CHECK=1
fi

[[ -d "$OUTPUT_DIR" ]] || error "Output directory does not exist: $OUTPUT_DIR"

# Determine installation and layer based on type
case "$TYPE" in
    geth-pruned)
        INSTALLATION="geth-pruned"
        LAYER="el"
        SERVICE="geth-pruned-el"
        ;;
    geth-archive)
        INSTALLATION="geth-archive"
        LAYER="el"
        SERVICE="geth-archive-el"
        ;;
    reth-pruned)
        INSTALLATION="reth-pruned"
        LAYER="el"
        SERVICE="reth-pruned-el"
        ;;
    reth-archive)
        INSTALLATION="reth-archive"
        LAYER="el"
        SERVICE="reth-archive-el"
        ;;
    beacon-kit-pruned)
        # Use reth-pruned as source for pruned CL snapshot (geth being deprecated)
        INSTALLATION="reth-pruned"
        LAYER="cl"
        SERVICE="reth-pruned-cl"
        ;;
    beacon-kit-archive)
        # Use reth-archive as source for archive CL snapshot (geth being deprecated)
        INSTALLATION="reth-archive"
        LAYER="cl"
        SERVICE="reth-archive-cl"
        ;;
    *)
        error "Unknown type: $TYPE"
        ;;
esac

INSTALL_DIR="$INSTALLATIONS_DIR/$INSTALLATION"
TOML_FILE="$INSTALL_DIR/installation.toml"

[[ -f "$TOML_FILE" ]] || error "Installation not found: $INSTALL_DIR"

# Read versions from installation.toml
CL_VERSION=$(grep '^beacon_kit' "$TOML_FILE" | cut -d'"' -f2)
[[ -n "$CL_VERSION" ]] || error "Could not read beacon_kit version from $TOML_FILE"

if [[ "$LAYER" == "el" ]]; then
    # Get EL version based on client type
    if [[ "$INSTALLATION" == geth-* ]]; then
        EL_VERSION=$(grep '^bera_geth' "$TOML_FILE" | cut -d'"' -f2)
    else
        EL_VERSION=$(grep '^bera_reth' "$TOML_FILE" | cut -d'"' -f2)
    fi
    [[ -n "$EL_VERSION" ]] || error "Could not read EL version from $TOML_FILE"
fi

# Get EL RPC port for installation
get_installation_base_port() {
    local base_port=""
    if [[ -f "$TOML_FILE" ]]; then
        base_port=$(awk -F'=' '/^base_port[[:space:]]*=/{gsub(/[[:space:]]/, "", $2); print $2; exit}' "$TOML_FILE" 2>/dev/null || true)
    fi
    if [[ "$base_port" =~ ^[0-9]+$ ]]; then
        echo "$base_port"
        return 0
    fi
    return 1
}

get_el_rpc_port() {
    local base_port
    if base_port=$(get_installation_base_port); then
        echo $((base_port + 10))
        return 0
    fi
    case "$INSTALLATION" in
        geth-pruned) echo 42010 ;;
        geth-archive) echo 42210 ;;
        reth-pruned) echo 42110 ;;
        reth-archive) echo 42310 ;;
    esac
}

# Get CL API port for installation
get_cl_api_port() {
    local base_port
    if base_port=$(get_installation_base_port); then
        echo $((base_port + 5))
        return 0
    fi
    case "$INSTALLATION" in
        geth-pruned) echo 42005 ;;
        geth-archive) echo 42205 ;;
        reth-pruned) echo 42105 ;;
        reth-archive) echo 42305 ;;
    esac
}

# Query block number from an RPC endpoint
query_block_number() {
    local url="$1"
    curl -sf -X POST -H "Content-Type: application/json" \
        --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
        "$url" 2>/dev/null | \
        "$PYTHON_BIN" -c "import sys,json; print(int(json.load(sys.stdin)['result'], 16))" 2>/dev/null || echo "0"
}

# Get current block/slot number from the running node
get_local_block_number() {
    if [[ "$LAYER" == "cl" ]]; then
        local port
        port=$(get_cl_api_port)
        curl -sf "http://127.0.0.1:$port/eth/v1/beacon/headers/finalized" 2>/dev/null | \
            "$PYTHON_BIN" -c "import sys,json; d=json.load(sys.stdin); print(d['data']['header']['message']['slot'])" 2>/dev/null || echo "0"
    else
        local port
        port=$(get_el_rpc_port)
        query_block_number "http://127.0.0.1:$port"
    fi
}

# Check sync status against public RPC
check_sync_status() {
    log "Checking sync status against $PUBLIC_RPC"
    
    local el_port
    el_port=$(get_el_rpc_port)
    
    local local_block
    local_block=$(query_block_number "http://127.0.0.1:$el_port")
    
    local public_block
    public_block=$(query_block_number "$PUBLIC_RPC")
    
    if [[ "$local_block" -eq 0 ]]; then
        log "SKIP: Could not query local EL RPC at port $el_port"
        return 1
    fi
    
    if [[ "$public_block" -eq 0 ]]; then
        log "SKIP: Could not query public RPC at $PUBLIC_RPC"
        return 1
    fi
    
    local lag=$((public_block - local_block))
    
    log_detail "Local EL block: $local_block"
    log_detail "Public RPC block: $public_block"
    log_detail "Lag: $lag blocks"
    
    if [[ $lag -gt $MAX_BLOCK_LAG ]]; then
        log "SKIP: Node is $lag blocks behind (max allowed: $MAX_BLOCK_LAG)"
        log "SKIP: Sync lag details - Local: $local_block, Public: $public_block, Lag: $lag blocks"
        return 1
    fi
    
    if [[ $lag -lt 0 ]]; then
        log_detail "Node is ${lag#-} blocks ahead of public RPC (ok)"
    else
        log_detail "Node is within sync tolerance (lag: $lag <= $MAX_BLOCK_LAG)"
    fi
    
    return 0
}

# Check sync status before proceeding (unless --skip-sync-check flag was passed)
if [[ $SKIP_SYNC_CHECK -eq 0 ]]; then
    if ! check_sync_status; then
        error "Sync check failed - snapshot not attempted"
    fi
else
    log "Skipping sync check (--skip-sync-check flag set)"
fi

# Get block/slot number for filename
BLOCK_NUMBER=$(get_local_block_number)
log_detail "Block/Slot for snapshot: $BLOCK_NUMBER"
[[ "$BLOCK_NUMBER" -gt 0 ]] || error "Could not get block number from node"

if [[ "$LAYER" == "cl" ]]; then
    # CL snapshot: beacon-kit-{pruned|archive}-{slot}-{cl_version}.tar.lz4
    MODE="${TYPE#beacon-kit-}"
    FILENAME="beacon-kit-${MODE}-${BLOCK_NUMBER}-${CL_VERSION}.tar.lz4"
else
    # EL snapshot: bera-{geth|reth}-{pruned|archive}-{block}-{el_version}.tar.lz4
    CLIENT="${INSTALLATION%-*}"
    MODE="${INSTALLATION#*-}"
    FILENAME="bera-${CLIENT}-${MODE}-${BLOCK_NUMBER}-${EL_VERSION}.tar.lz4"
fi

OUTPUT_FILE="$OUTPUT_DIR/$FILENAME"
TEMP_FILE="$OUTPUT_DIR/.${FILENAME}.tmp"

log "Starting snapshot generation: $TYPE"
log_detail "Installation: $INSTALLATION"
log_detail "Layer: $LAYER"
log_detail "Block/Slot: $BLOCK_NUMBER"
log_detail "CL version: $CL_VERSION"
[[ "$LAYER" == "el" ]] && log_detail "EL version: $EL_VERSION"
log_detail "Output: $OUTPUT_FILE"

# Determine services to stop/start
CL_SERVICE="${INSTALLATION}-cl"
EL_SERVICE="${INSTALLATION}-el"

# Wait for a service to fully stop (process gone)
wait_for_stop() {
    local service="$1"
    local max_wait=30
    local waited=0
    local initial_pid=$(systemctl --user show "$service" --property=MainPID --value 2>/dev/null || echo "0")

    # If service was already inactive, note it
    if ! systemctl --user is-active --quiet "$service" 2>/dev/null; then
        log_detail "Service $service was already stopped (PID: $initial_pid)"
        return 0
    fi

    while systemctl --user is-active --quiet "$service" 2>/dev/null; do
        if [[ $waited -ge $max_wait ]]; then
            local current_pid=$(systemctl --user show "$service" --property=MainPID --value 2>/dev/null || echo "0")
            error "Service $service did not stop within ${max_wait}s (PID: $current_pid)"
        fi
        sleep 1
        ((waited++))
    done
    log_detail "Service $service confirmed stopped (waited ${waited}s, was PID: $initial_pid)"
}

# Check service health and sync status before snapshot
check_service_health() {
    local service="$1"
    local service_type="$2"
    
    # Check if service is running
    if ! systemctl --user is-active --quiet "$service"; then
        error_with_code "Service $service is not running - cannot create snapshot" 2
    fi
    
    # Get PID for monitoring
    local pid=$(systemctl --user show "$service" --property=MainPID --value)
    if [[ "$pid" == "0" || -z "$pid" ]]; then
        error_with_code "Service $service has no main PID - service may be unhealthy" 3
    fi
    
    log_detail "Service $service health check: PID=$pid, status=active"
    
    # For CL services, check sync status via API (if available)
    if [[ "$service_type" == "cl" ]]; then
        local port
        port=$(get_cl_api_port)

        # Check if beacon API is responding (basic health check)
        if ! curl -s --max-time 5 "http://127.0.0.1:$port/eth/v1/node/health" >/dev/null 2>&1; then
            log "WARNING: CL service $service API not responding on port $port - may still be syncing"
        else
            log_detail "CL service $service API responding on port $port"
        fi
    fi
    
    return 0
}

# Verify berabox is available
check_berabox() {
    if [[ ! -x "$BERABOX_BIN" ]]; then
        error "Berabox not found at $BERABOX_BIN - cannot manage services"
    fi
}

# Stop the full installation (EL + CL) before snapshot work.
# Uses berabox for service management (required).
stop_services() {
    log "Stopping services for snapshot"
    
    check_berabox
    
    # Check health before stopping.
    # We require both sides healthy because snapshot operations
    # should run with the full installation quiesced.
    check_service_health "$CL_SERVICE" "cl"
    check_service_health "$EL_SERVICE" "el"
    
    # Get PID before stopping for monitoring
    local cl_pid=$(systemctl --user show "$CL_SERVICE" --property=MainPID --value)
    local el_pid=$(systemctl --user show "$EL_SERVICE" --property=MainPID --value)
    log_detail "Stopping installation: CL=$CL_SERVICE (PID: $cl_pid), EL=$EL_SERVICE (PID: $el_pid)"
    
    # Stop full installation regardless of snapshot layer.
    if ! "$BERABOX_BIN" "$INSTALLATION" stop; then
        error "Failed to stop installation services via berabox"
    fi
    
    wait_for_stop "$CL_SERVICE"
    wait_for_stop "$EL_SERVICE"
    log_detail "All required services stopped"
}

# Restart the full installation (EL + CL) after snapshot work.
# Uses berabox for service management (required).
restart_services() {
    log "Restarting services"
    
    check_berabox
    
    # Start full installation regardless of snapshot layer.
    log_detail "Starting installation services via berabox"
    if ! "$BERABOX_BIN" "$INSTALLATION" start; then
        log "WARNING: Failed to start installation services via berabox"
    fi
    log_detail "Services restarted"
}

# Global variable to store output file path for successful completion
SUCCESS_OUTPUT_FILE=""

# Trap to restart services on any exit
cleanup() {
    local exit_code=$?
    restart_services
    # Clean up temp file on failure
    if [[ $exit_code -ne 0 ]] && [[ -f "$TEMP_FILE" ]]; then
        rm -f "$TEMP_FILE"
    fi
    # Output success file path after restart (only to stdout, not stderr)
    if [[ $exit_code -eq 0 ]] && [[ -n "$SUCCESS_OUTPUT_FILE" ]]; then
        echo "$SUCCESS_OUTPUT_FILE"
    fi
    exit $exit_code
}
trap cleanup EXIT

# Stop services
stop_services

# Prune CL state data for pruned snapshots only
if [[ "$LAYER" == "cl" && "$TYPE" == "beacon-kit-pruned" ]]; then
    CL_DATA_DIR="$INSTALL_DIR/data/cl/data"
    log "Running cosmprund on CL data (pruned snapshot)"
    log_detail "Target: $CL_DATA_DIR"
    
    # Record size before pruning
    SIZE_BEFORE=$(du -sh "$CL_DATA_DIR" 2>/dev/null | cut -f1 || echo "unknown")
    log_detail "Size before pruning: $SIZE_BEFORE"
    
    # Run cosmprund with conservative settings for snapshots.
    # Berachain cosmprund main uses --keep-blocks/--keep-versions.
    # Keep 10 blocks and 5 versions (smaller than default for snapshot efficiency).
    if "$COSMPRUND_BIN" prune "$CL_DATA_DIR" --keep-blocks 10 --keep-versions 5; then
        SIZE_AFTER=$(du -sh "$CL_DATA_DIR" 2>/dev/null | cut -f1 || echo "unknown")
        log_detail "Size after pruning: $SIZE_AFTER"
        log_detail "Cosmprund completed successfully"
    else
        log "WARNING: cosmprund failed, continuing with unpruned data"
    fi
fi

# Create tar archive and compress in one pass (stream tar | lz4)
log "Creating snapshot archive"
START_TIME=$(date +%s)

if [[ "$LAYER" == "cl" ]]; then
    # CL: tar only data subdirectories, exclude config and cs.wal
    # Archive contains: blockstore.db/, application.db/, state.db/, etc. (flat)
    DATA_DIR="$INSTALL_DIR/data/cl/data"
    [[ -d "$DATA_DIR" ]] || error "CL data directory not found: $DATA_DIR"
    
    DATA_SIZE=$(du -sh "$DATA_DIR" 2>/dev/null | cut -f1)
    log_detail "Source: $DATA_DIR ($DATA_SIZE)"
    log_detail "Excludes: cs.wal, priv_validator_state.json"
    log_detail "Streaming tar | lz4 to $TEMP_FILE"
    
    # Stream tar directly to lz4
    tar -c \
        -C "$DATA_DIR" \
        --exclude='cs.wal' \
        --exclude='priv_validator_state.json' \
        blockstore.db application.db state.db deposits.db evidence.db 2>/dev/null \
        | lz4 -3 > "$TEMP_FILE" \
    || tar -c \
        -C "$DATA_DIR" \
        --exclude='cs.wal' \
        --exclude='priv_validator_state.json' \
        . \
        | lz4 -3 > "$TEMP_FILE"
else
    # EL: tar only the chain subdirectory (flat structure like CL)
    # For reth: archive contains db/, static_files/, blobstore/, etc. (flat)
    # For geth: archive contains bera-geth/, keystore/, etc. (flat)
    DATA_DIR="$INSTALL_DIR/data/el/chain"
    [[ -d "$DATA_DIR" ]] || error "EL chain directory not found: $DATA_DIR"
    
    DATA_SIZE=$(du -sh "$DATA_DIR" 2>/dev/null | cut -f1)
    log_detail "Source: $DATA_DIR ($DATA_SIZE)"
    log_detail "Streaming tar | lz4 to $TEMP_FILE"
    
    tar -c -C "$DATA_DIR" \
        --exclude='discovery-secret' \
        --exclude='*/nodekey' \
        . | lz4 -3 > "$TEMP_FILE"
fi

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# Atomic move from temp to final (ensures complete file or nothing)
log_detail "Moving temp file to final destination"
mv "$TEMP_FILE" "$OUTPUT_FILE"

# Verify output exists
[[ -f "$OUTPUT_FILE" ]] || error "Output file not created: $OUTPUT_FILE"

SIZE=$(stat -c%s "$OUTPUT_FILE")
SIZE_HUMAN=$(numfmt --to=iec-i --suffix=B "$SIZE")

log "Snapshot complete: $FILENAME"
log_detail "Size: $SIZE_HUMAN ($SIZE bytes)"
log_detail "Duration: ${DURATION}s"
log_detail "Path: $OUTPUT_FILE"

# Save the path for output after trap completes
SUCCESS_OUTPUT_FILE="$OUTPUT_FILE"
