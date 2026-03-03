#!/bin/bash
set -euo pipefail

# snapshot-scheduler.sh - Main scheduler for snapshot generation
# Runs daily via cron, generates snapshots for all types in sequence
# Handles space management and calls sub-scripts

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

DB_PATH="$SNAPSHOT_DB_PATH"
SNAPSHOTS_MOUNT="$SNAPSHOT_ROOT"
TMP_DIR="$SNAPSHOT_TMP_DIR"
LOCK_FILE="$TMP_DIR/.scheduler.lock"
PYTHON_BIN="$SNAPSHOT_PYTHON_BIN"
SAFE_MARGIN_GB="$SNAPSHOT_SAFE_MARGIN_GB"
FALLBACK_SIZE_GB="$SNAPSHOT_FALLBACK_SIZE_GB"

IFS=',' read -r -a SNAPSHOT_TYPES <<< "$SNAPSHOT_ACTIVE_TYPES"
if [[ ${#SNAPSHOT_TYPES[@]} -eq 0 ]]; then
    echo "ERROR: No snapshot types configured (SNAPSHOT_ACTIVE_TYPES is empty)" >&2
    exit 1
fi
LOG_FILE="$SNAPSHOT_ROOT/logs/scheduler-$(date '+%Y%m%d-%H%M%S').log"
mkdir -p "$(dirname "$LOG_FILE")" "$TMP_DIR"

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] [scheduler] $*"
    echo "$msg" | tee -a "$LOG_FILE"
}

error() {
    log "ERROR: $*"
}

assert_schema_ready() {
    if [[ ! -f "$DB_PATH" ]]; then
        error "Snapshot database not found: $DB_PATH"
        error "Initialize it with: $SCRIPT_DIR/bootstrap-db.sh \"$DB_PATH\""
        return 1
    fi

    local required_tables=("snapshots" "snapshot_runs")
    local missing_tables=()
    local table_exists=""

    for table in "${required_tables[@]}"; do
        table_exists=$(sqlite3 "$DB_PATH" "SELECT 1 FROM sqlite_master WHERE type='table' AND name='$table' LIMIT 1;" 2>/dev/null || true)
        if [[ "$table_exists" != "1" ]]; then
            missing_tables+=("$table")
        fi
    done

    if [[ ${#missing_tables[@]} -gt 0 ]]; then
        error "Snapshot database schema is incomplete (missing tables: ${missing_tables[*]})"
        error "Initialize it with: $SCRIPT_DIR/bootstrap-db.sh \"$DB_PATH\""
        return 1
    fi
}

start_run() {
    local type="$1"
    sqlite3 "$DB_PATH" "INSERT INTO snapshot_runs (type, status) VALUES ('$type', 'running'); SELECT last_insert_rowid();"
}

finish_run() {
    local run_id="$1"
    local status="$2"
    local message="$3"
    local local_block="$4"
    local public_block="$5"
    local lag="$6"
    local message_sql
    message_sql=${message//\'/\'\'}
    sqlite3 "$DB_PATH" << EOF
UPDATE snapshot_runs
SET status='$status',
    ended_at=CURRENT_TIMESTAMP,
    message='${message_sql}',
    local_block=${local_block:-NULL},
    public_block=${public_block:-NULL},
    lag=${lag:-NULL}
WHERE id=$run_id;
EOF
}

extract_run_info() {
    local log_file="$1"
    local local_block=""
    local public_block=""
    local lag=""
    local message=""

    local_block=$(grep -m1 "Local EL block" "$log_file" 2>/dev/null | rev | cut -d' ' -f1 | rev || true)
    public_block=$(grep -m1 "Public RPC block" "$log_file" 2>/dev/null | rev | cut -d' ' -f1 | rev || true)
    lag=$(grep -m1 "Lag:" "$log_file" 2>/dev/null | sed -E 's/.*Lag: ([0-9]+).*/\1/' || true)
    if [[ -n "$lag" && ! "$lag" =~ ^[0-9]+$ ]]; then
        lag=""
    fi
    message=$(grep -E "SKIP:|ERROR:" "$log_file" 2>/dev/null | tail -1 | sed "s/.*] \\[snapshot-generate\\] //")
    if [[ -z "$message" ]]; then
        message="unknown failure"
    fi

    echo "${local_block}|${public_block}|${lag}|${message}"
}

# Get available space in GB
get_available_gb() {
    df --output=avail -BG "$SNAPSHOTS_MOUNT" | tail -1 | tr -d 'G '
}

# Get estimated size for a snapshot type (from most recent, or fallback)
get_estimated_size_gb() {
    local type="$1"
    local size_bytes
    size_bytes=$(sqlite3 "$DB_PATH" \
        "SELECT size_bytes FROM snapshots WHERE type='$type' AND published=1 ORDER BY created_at DESC LIMIT 1;" 2>/dev/null || echo "")
    
    if [[ -n "$size_bytes" && "$size_bytes" -gt 0 ]]; then
        # Convert bytes to GB (round up)
        echo $(( (size_bytes + 1073741823) / 1073741824 ))
    else
        echo "$FALLBACK_SIZE_GB"
    fi
}

# Find the oldest pruneable snapshot (not the last of its type)
find_oldest_pruneable() {
    sqlite3 "$DB_PATH" << 'EOF'
SELECT s.type
FROM snapshots s
WHERE s.published = 1
  AND (SELECT COUNT(*) FROM snapshots s2 WHERE s2.type = s.type AND s2.published = 1) > 1
ORDER BY s.created_at ASC
LIMIT 1;
EOF
}

# Ensure enough space for a snapshot
ensure_space() {
    local type="$1"
    local estimated_gb
    estimated_gb=$(get_estimated_size_gb "$type")
    
    log "Estimated size for $type: ${estimated_gb}GB"
    
    local max_iterations=10
    local iteration=0
    
    while [[ $iteration -lt $max_iterations ]]; do
        local available_gb
        available_gb=$(get_available_gb)
        local needed_gb=$((estimated_gb + SAFE_MARGIN_GB))
        
        log "Available: ${available_gb}GB, Needed: ${needed_gb}GB (${estimated_gb}GB + ${SAFE_MARGIN_GB}GB margin)"
        
        if [[ $available_gb -ge $needed_gb ]]; then
            return 0
        fi
        
        log "Not enough space, pruning oldest snapshot overall..."
        
        # Find and prune the oldest snapshot overall (that isn't the last of its type)
        local oldest_type
        oldest_type=$(find_oldest_pruneable)
        
        if [[ -z "$oldest_type" ]]; then
            error "No more snapshots to prune (all types have only 1 snapshot remaining)"
            return 1
        fi
        
        if bash "$SCRIPT_DIR/snapshot-prune.sh" "$oldest_type" 2>&1 | tee -a "$LOG_FILE"; then
            log "Pruned oldest snapshot (type: $oldest_type)"
        else
            error "Failed to prune snapshot of type: $oldest_type"
            return 1
        fi
        
        ((iteration++))
    done
    
    error "Failed to ensure space after $max_iterations iterations"
    return 1
}

# Generate and publish a single snapshot type
# $1: snapshot type
# $2: skip_sync_check (optional, set to "1" to skip sync check)
generate_and_publish_snapshot() {
    local type="$1"
    local skip_sync="${2:-}"
    local run_id
    local run_log
    local run_info
    local local_block
    local public_block
    local lag
    local message
    
    log "=== Generating snapshot: $type ==="
    run_id=$(start_run "$type")
    run_log="$TMP_DIR/run-${type}-$(date '+%Y%m%d-%H%M%S').log"
    
    # Check space
    if ! ensure_space "$type"; then
        error "Failed to ensure space for $type"
        finish_run "$run_id" "failed" "failed to ensure space" "" "" ""
        return 1
    fi
    
    # Generate snapshot
    local snapshot_file
    local skip_flag=""
    if [[ -n "$skip_sync" ]]; then
        skip_flag="--skip-sync-check"
    fi
    
    if snapshot_file=$(bash "$SCRIPT_DIR/snapshot-generate.sh" "$type" "$TMP_DIR" $skip_flag 2>&1 | tee -a "$LOG_FILE" | tee "$run_log" | tail -1); then
        # Check if output looks like a file path
        if [[ -f "$snapshot_file" ]]; then
            log "Snapshot generated: $snapshot_file"
            
            # Publish snapshot
            if bash "$SCRIPT_DIR/snapshot-publish.sh" "$type" "$snapshot_file" 2>&1 | tee -a "$LOG_FILE"; then
                log "Snapshot published successfully: $type"
                run_info=$(extract_run_info "$run_log")
                local_block=$(echo "$run_info" | cut -d'|' -f1)
                public_block=$(echo "$run_info" | cut -d'|' -f2)
                lag=$(echo "$run_info" | cut -d'|' -f3)
                message=$(echo "$run_info" | cut -d'|' -f4-)
                finish_run "$run_id" "success" "${message:-published}" "$local_block" "$public_block" "$lag"
                return 0
            else
                error "Failed to publish snapshot: $type"
                run_info=$(extract_run_info "$run_log")
                local_block=$(echo "$run_info" | cut -d'|' -f1)
                public_block=$(echo "$run_info" | cut -d'|' -f2)
                lag=$(echo "$run_info" | cut -d'|' -f3)
                message=$(echo "$run_info" | cut -d'|' -f4-)
                finish_run "$run_id" "failed" "${message:-publish failed}" "$local_block" "$public_block" "$lag"
                rm -f "$snapshot_file"
                return 1
            fi
        else
            error "Snapshot generation did not produce a valid file: $snapshot_file"
            run_info=$(extract_run_info "$run_log")
            local_block=$(echo "$run_info" | cut -d'|' -f1)
            public_block=$(echo "$run_info" | cut -d'|' -f2)
            lag=$(echo "$run_info" | cut -d'|' -f3)
            message=$(echo "$run_info" | cut -d'|' -f4-)
            finish_run "$run_id" "failed" "${message:-invalid output}" "$local_block" "$public_block" "$lag"
            return 1
        fi
    else
        error "Snapshot generation failed for $type"
        run_info=$(extract_run_info "$run_log")
        local_block=$(echo "$run_info" | cut -d'|' -f1)
        public_block=$(echo "$run_info" | cut -d'|' -f2)
        lag=$(echo "$run_info" | cut -d'|' -f3)
        message=$(echo "$run_info" | cut -d'|' -f4-)
        finish_run "$run_id" "failed" "${message:-generation failed}" "$local_block" "$public_block" "$lag"
        return 1
    fi
}

# Generate a snapshot for a type (handles EL + CL for reth types)
generate_snapshot() {
    local type="$1"
    local el_type cl_type
    
    # Generate EL snapshot
    if ! generate_and_publish_snapshot "$type"; then
        return 1
    fi
    
    # If this was a reth snapshot, immediately generate beacon-kit snapshot from same installation
    local cl_failed=0
    case "$type" in
        reth-pruned)
            cl_type="beacon-kit-pruned"
            log "Generating $cl_type from same reth-pruned installation (skipping sync check)"
            if ! generate_and_publish_snapshot "$cl_type" "1"; then
                error "CRITICAL: Failed to generate $cl_type after successful reth-pruned snapshot"
                cl_failed=1
            fi
            ;;
        reth-archive)
            cl_type="beacon-kit-archive"
            log "Generating $cl_type from same reth-archive installation (skipping sync check)"
            if ! generate_and_publish_snapshot "$cl_type" "1"; then
                error "CRITICAL: Failed to generate $cl_type after successful reth-archive snapshot"
                cl_failed=1
            fi
            ;;
    esac
    
    # Mark the full type run as failed if CL companion snapshot failed.
    if [[ $cl_failed -ne 0 ]]; then
        return 1
    fi
    return 0
}

# Check for lock file and exit if another instance is running
check_lock() {
    if [[ -f "$LOCK_FILE" ]]; then
        local lock_pid
        lock_pid=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
        if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
            log "Another snapshot scheduler is already running (PID: $lock_pid)"
            exit 0
        else
            log "Removing stale lock file (PID $lock_pid not running)"
            rm -f "$LOCK_FILE"
        fi
    fi
    echo $$ > "$LOCK_FILE"
}

# Remove lock file on exit
cleanup_lock() {
    rm -f "$LOCK_FILE"
}

# Main
main() {
    check_lock
    trap cleanup_lock EXIT
    
    log "=========================================="
    log "Snapshot scheduler starting"
    log "=========================================="
    
    assert_schema_ready

    local success=0
    local failed=0
    
    set +e
    for type in "${SNAPSHOT_TYPES[@]}"; do
        generate_snapshot "$type"
        rc=$?
        if [[ $rc -eq 0 ]]; then
            ((success++))
        else
            ((failed++))
            error "Snapshot failed for $type (continuing)"
        fi
    done
    set -e
    
    # Regenerate HTML index once at the end (more efficient than per-snapshot)
    log "Regenerating HTML index for all snapshots..."
    if "$PYTHON_BIN" "$SCRIPT_DIR/generate-index.py" 2>&1 | tee -a "$LOG_FILE"; then
        log "Index regenerated successfully"
    else
        error "Failed to regenerate index"
    fi
    
    log "=========================================="
    log "Snapshot scheduler complete"
    log "Success: $success, Failed: $failed"
    log "=========================================="
    
    # Exit with error if any failed
    [[ $failed -eq 0 ]]
}

main "$@"
