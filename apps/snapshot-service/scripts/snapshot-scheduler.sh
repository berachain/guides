#!/bin/bash
set -euo pipefail

# snapshot-scheduler.sh - Main scheduler for snapshot generation
# Runs installations in parallel. Within each installation, EL and CL tars run
# simultaneously against the single stop window. Publish is sequential after all
# tars complete.

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
BERABOX_BIN="$SNAPSHOT_BERABOX_BIN"
PUBLIC_RPC="$SNAPSHOT_PUBLIC_RPC"
MAX_BLOCK_LAG="$SNAPSHOT_MAX_BLOCK_LAG"
INSTALLATIONS_DIR="$SNAPSHOT_INSTALLATIONS_DIR"

IFS=',' read -r -a SNAPSHOT_TYPES <<< "$SNAPSHOT_ACTIVE_TYPES"
if [[ ${#SNAPSHOT_TYPES[@]} -eq 0 ]]; then
    echo "ERROR: No snapshot types configured (SNAPSHOT_ACTIVE_TYPES is empty)" >&2
    exit 1
fi
LOG_DIR="$SNAPSHOT_ROOT/logs"
LOG_FILE="$LOG_DIR/scheduler-$(date '+%Y%m%d-%H%M%S').log"
PROGRESS_DIR="$LOG_DIR"
mkdir -p "$LOG_DIR" "$TMP_DIR"

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] [scheduler] $*"
    echo "$msg" | tee -a "$LOG_FILE"
}

error() {
    log "ERROR: $*"
}

# Per-run tag for temp marker files so overlapping runs do not clobber each other.
RUN_TAG="$(date '+%Y%m%d-%H%M%S')-$$"

snap_out_file() {
    local type="$1"
    echo "$TMP_DIR/.snap-${RUN_TAG}-out-${type}"
}

snap_runid_file() {
    local type="$1"
    echo "$TMP_DIR/.snap-${RUN_TAG}-runid-${type}"
}

snap_log_file() {
    local type="$1"
    echo "$TMP_DIR/.snap-${RUN_TAG}-log-${type}"
}

# Predictable per-component progress log for multitail during active run.
# These are consolidated into cron.log and removed at end of run.
snap_progress_file() {
    local type="$1"
    echo "$PROGRESS_DIR/${type}.log"
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
    # Capture the last error or skip message for the summary
    message=$(grep -E "SKIP:|ERROR:" "$log_file" 2>/dev/null | tail -1 | sed "s/.*] \\[snapshot-generate\\] //")
    if [[ -z "$message" ]]; then
        # If no explicit error, check if it completed successfully
        if grep -q "Snapshot complete:" "$log_file" 2>/dev/null; then
            message="published"
        else
            message="unknown failure"
        fi
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

# ---------------------------------------------------------------------------
}

# Port and block-number helpers (mirrors snapshot-generate.sh logic)
# ---------------------------------------------------------------------------

query_el_block() {
    local url="$1"
    curl -sf -X POST -H "Content-Type: application/json" \
        --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
        "$url" 2>/dev/null | \
        "$PYTHON_BIN" -c "import sys,json; print(int(json.load(sys.stdin)['result'], 16))" 2>/dev/null || echo "0"
}

query_cl_slot() {
    local port="$1"
    curl -sf "http://127.0.0.1:$port/eth/v1/beacon/headers/finalized" 2>/dev/null | \
        "$PYTHON_BIN" -c "import sys,json; d=json.load(sys.stdin); print(d['data']['header']['message']['slot'])" 2>/dev/null || echo "0"
}

get_installation_base_port() {
    local installation="$1"
    local toml="$INSTALLATIONS_DIR/$installation/installation.toml"
    awk -F'=' '/^base_port[[:space:]]*=/{gsub(/[[:space:]]/, "", $2); print $2; exit}' "$toml" 2>/dev/null || true
}

get_el_rpc_port() {
    local installation="$1"
    local base_port
    base_port=$(get_installation_base_port "$installation") || true
    if [[ "$base_port" =~ ^[0-9]+$ ]]; then echo $((base_port + 10)); return; fi
    case "$installation" in
        geth-pruned)  echo 42010 ;;
        geth-archive) echo 42210 ;;
        reth-pruned)  echo 42110 ;;
        reth-archive) echo 42310 ;;
        *) echo 0 ;;
    esac
}

get_cl_api_port() {
    local installation="$1"
    local base_port
    base_port=$(get_installation_base_port "$installation") || true
    if [[ "$base_port" =~ ^[0-9]+$ ]]; then echo $((base_port + 5)); return; fi
    case "$installation" in
        geth-pruned)  echo 42005 ;;
        geth-archive) echo 42205 ;;
        reth-pruned)  echo 42105 ;;
        reth-archive) echo 42305 ;;
        *) echo 0 ;;
    esac
}

check_installation_sync() {
    local installation="$1"
    local el_port
    el_port=$(get_el_rpc_port "$installation")

    local local_block public_block lag
    local_block=$(query_el_block "http://127.0.0.1:$el_port")
    public_block=$(query_el_block "$PUBLIC_RPC")

    if [[ "$local_block" -eq 0 ]]; then
        log "[$installation] Cannot query local EL RPC on port $el_port"
        return 1
    fi
    if [[ "$public_block" -eq 0 ]]; then
        log "[$installation] Cannot query public RPC $PUBLIC_RPC"
        return 1
    fi

    lag=$((public_block - local_block))
    log "[$installation] Sync: local=$local_block public=$public_block lag=$lag"

    if [[ $lag -gt $MAX_BLOCK_LAG ]]; then
        log "[$installation] SKIP: $lag blocks behind (max $MAX_BLOCK_LAG)"
        return 1
    fi
}

stop_installation() {
    local installation="$1"
    log "[$installation] Stopping services"
    "$BERABOX_BIN" "$installation" stop || { log "[$installation] ERROR: stop failed"; return 1; }
    sleep 2
    log "[$installation] Services stopped"
}

restart_installation() {
    local installation="$1"
    log "[$installation] Restarting services"
    if ! "$BERABOX_BIN" "$installation" start; then
        log "[$installation] WARNING: restart failed — manual intervention may be needed"
    fi
}

# ---------------------------------------------------------------------------
# Publish a single type after generation.
# Reads the file path from $TMP_DIR/.snap-out-<type>.
# ---------------------------------------------------------------------------

publish_generated() {
    local type="$1"
    local out_file
    local run_id_file
    local run_log
    out_file="$(snap_out_file "$type")"
    run_id_file="$(snap_runid_file "$type")"
    run_log="$(snap_log_file "$type")"

    local run_id=""
    [[ -f "$run_id_file" ]] && run_id=$(cat "$run_id_file")

    if [[ ! -f "$out_file" ]]; then
        log "[$type] No output recorded — generation failed"
        [[ -n "$run_id" ]] && finish_run "$run_id" "failed" "no output file" "" "" ""
        return 1
    fi

    local snapshot_file
    snapshot_file=$(cat "$out_file")

    if [[ ! -f "$snapshot_file" ]]; then
        log "[$type] Generated file missing: $snapshot_file"
        [[ -n "$run_id" ]] && finish_run "$run_id" "failed" "file missing after generation" "" "" ""
        return 1
    fi

    log "[$type] Publishing: $snapshot_file"
    if bash "$SCRIPT_DIR/snapshot-publish.sh" "$type" "$snapshot_file" 2>&1 | tee -a "$LOG_FILE"; then
        log "[$type] Published"
        local run_info local_block public_block lag message
        run_info=$(extract_run_info "$run_log" 2>/dev/null || echo "|||published")
        local_block=$(echo "$run_info" | cut -d'|' -f1)
        public_block=$(echo "$run_info" | cut -d'|' -f2)
        lag=$(echo "$run_info" | cut -d'|' -f3)
        message=$(echo "$run_info" | cut -d'|' -f4-)
        [[ -n "$run_id" ]] && finish_run "$run_id" "success" "${message:-published}" "$local_block" "$public_block" "$lag"
        return 0
    else
        log "[$type] ERROR: publish failed"
        [[ -n "$run_id" ]] && finish_run "$run_id" "failed" "publish failed" "" "" ""
        rm -f "$snapshot_file"
        return 1
    fi
}

# ---------------------------------------------------------------------------
# snapshot_installation: one stop window, EL + CL tars in parallel, restart.
# Runs as a background job. Writes output paths to temp files for publish phase.
# $1 installation  $2 el_type  $3 cl_type
# ---------------------------------------------------------------------------

snapshot_installation() {
    local installation="$1"
    local el_type="$2"
    local cl_type="$3"

    log "[$installation] === Starting ==="

    if ! check_installation_sync "$installation"; then
        log "[$installation] Skipping: sync check failed"
        return 1
    fi

    # Block numbers must be captured while services are running
    local el_port cl_port el_block cl_slot
    el_port=$(get_el_rpc_port "$installation")
    cl_port=$(get_cl_api_port "$installation")
    el_block=$(query_el_block "http://127.0.0.1:$el_port")
    cl_slot=$(query_cl_slot "$cl_port")

    if [[ "$el_block" -eq 0 ]]; then
        log "[$installation] Cannot get EL block number"
        return 1
    fi
    if [[ "$cl_slot" -eq 0 ]]; then
        log "[$installation] Cannot get CL slot"
        return 1
    fi

    log "[$installation] EL block=$el_block  CL slot=$cl_slot"

    # Record DB run entries before stopping
    local el_run_id cl_run_id
    el_run_id=$(start_run "$el_type")
    cl_run_id=$(start_run "$cl_type")
    echo "$el_run_id" > "$(snap_runid_file "$el_type")"
    echo "$cl_run_id" > "$(snap_runid_file "$cl_type")"

    local el_log
    local cl_log
    el_log="$(snap_progress_file "$el_type")"
    cl_log="$(snap_progress_file "$cl_type")"

    if ! stop_installation "$installation"; then
        finish_run "$el_run_id" "failed" "service stop failed" "$el_block" "" ""
        finish_run "$cl_run_id" "failed" "service stop failed" "" "" ""
        return 1
    fi

    # EL tar (background)
    bash "$SCRIPT_DIR/snapshot-generate.sh" \
        "$el_type" "$TMP_DIR" \
        --skip-stop --skip-restart --skip-sync-check \
        --block-number "$el_block" \
        > "$(snap_out_file "$el_type")" 2>"$el_log" &
    local el_pid=$!

    # CL tar (background, runs concurrently with EL tar)
    bash "$SCRIPT_DIR/snapshot-generate.sh" \
        "$cl_type" "$TMP_DIR" \
        --skip-stop --skip-restart --skip-sync-check \
        --block-number "$cl_slot" \
        > "$(snap_out_file "$cl_type")" 2>"$cl_log" &
    local cl_pid=$!

    # Wait for both tars before restarting
    local el_rc=0 cl_rc=0
    wait "$el_pid" || el_rc=$?
    wait "$cl_pid" || cl_rc=$?

    # Restart immediately — don't hold services down any longer
    restart_installation "$installation"

    # Consolidate per-component progress logs into cron log after component finish.
    if [[ -f "$el_log" ]]; then
        {
            echo "----- BEGIN $el_type progress -----"
            cat "$el_log"
            echo "----- END $el_type progress -----"
        } >> "$LOG_FILE"
    fi
    if [[ -f "$cl_log" ]]; then
        {
            echo "----- BEGIN $cl_type progress -----"
            cat "$cl_log"
            echo "----- END $cl_type progress -----"
        } >> "$LOG_FILE"
    fi

    if [[ $el_rc -ne 0 ]]; then
        log "[$installation] EL snapshot ($el_type) failed (rc=$el_rc)"
        rm -f "$(snap_out_file "$el_type")"
        finish_run "$el_run_id" "failed" "tar failed (rc=$el_rc)" "$el_block" "" ""
    fi
    if [[ $cl_rc -ne 0 ]]; then
        log "[$installation] CL snapshot ($cl_type) failed (rc=$cl_rc)"
        rm -f "$(snap_out_file "$cl_type")"
        finish_run "$cl_run_id" "failed" "tar failed (rc=$cl_rc)" "" "" ""
    fi

    [[ $el_rc -eq 0 && $cl_rc -eq 0 ]]
}

# ---------------------------------------------------------------------------
# Lock helpers
# ---------------------------------------------------------------------------

check_lock() {
    if [[ -f "$LOCK_FILE" ]]; then
        local lock_pid
        lock_pid=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
        if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
            log "Another scheduler already running (PID: $lock_pid)"
            exit 0
        else
            log "Removing stale lock file (PID $lock_pid not running)"
            rm -f "$LOCK_FILE"
        fi
    fi
    echo $$ > "$LOCK_FILE"
}

cleanup_lock() {
    rm -f "$LOCK_FILE"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
    check_lock
    trap cleanup_lock EXIT

    log "=========================================="
    log "Snapshot scheduler starting (parallel mode)"
    log "=========================================="

    assert_schema_ready

    mkdir -p "$PROGRESS_DIR"

    # Clean up temp marker files for this run tag only.
    rm -f "$TMP_DIR"/.snap-"$RUN_TAG"-*
    # Reset predictable progress logs for this run.
    rm -f "$PROGRESS_DIR"/*.log 2>/dev/null || true

    # Determine which installations are active from SNAPSHOT_ACTIVE_TYPES
    local run_pruned=0 run_archive=0
    for t in "${SNAPSHOT_TYPES[@]}"; do
        case "$t" in
            reth-pruned|beacon-kit-pruned)   run_pruned=1 ;;
            reth-archive|beacon-kit-archive) run_archive=1 ;;
        esac
    done

    # Ensure space for all active types before taking anything down.
    # Done serially here to avoid races in snapshot-prune.sh.
    if [[ $run_pruned -eq 1 ]]; then
        ensure_space "reth-pruned"      || { log "No space for reth-pruned; aborting"; exit 1; }
        ensure_space "beacon-kit-pruned" || { log "No space for beacon-kit-pruned; aborting"; exit 1; }
    fi
    if [[ $run_archive -eq 1 ]]; then
        ensure_space "reth-archive"      || { log "No space for reth-archive; aborting"; exit 1; }
        ensure_space "beacon-kit-archive" || { log "No space for beacon-kit-archive; aborting"; exit 1; }
    fi

    # Fork installations in parallel
    local pruned_pid=0 archive_pid=0

    if [[ $run_pruned -eq 1 ]]; then
        snapshot_installation "reth-pruned" "reth-pruned" "beacon-kit-pruned" &
        pruned_pid=$!
    fi
    if [[ $run_archive -eq 1 ]]; then
        snapshot_installation "reth-archive" "reth-archive" "beacon-kit-archive" &
        archive_pid=$!
    fi

    # Wait for all installations
    local pruned_rc=0 archive_rc=0
    [[ $pruned_pid -ne 0 ]]  && { wait "$pruned_pid"  || pruned_rc=$?; }
    [[ $archive_pid -ne 0 ]] && { wait "$archive_pid" || archive_rc=$?; }

    log "All tars complete — pruned_rc=$pruned_rc archive_rc=$archive_rc"

    # Publish sequentially (safe for DB and file operations)
    local success=0 failed=0
    local publish_order=()
    [[ $run_pruned -eq 1 ]]  && publish_order+=(reth-pruned beacon-kit-pruned)
    [[ $run_archive -eq 1 ]] && publish_order+=(reth-archive beacon-kit-archive)

    set +e
    for type in "${publish_order[@]}"; do
        if publish_generated "$type"; then
            ((success++))
        else
            ((failed++))
            log "Publish failed for $type (continuing)"
        fi
    done
    set -e

    log "Regenerating HTML index..."
    if "$PYTHON_BIN" "$SCRIPT_DIR/generate-index.py" 2>&1 | tee -a "$LOG_FILE"; then
        log "Index regenerated"
    else
        log "ERROR: index regeneration failed"
    fi

    log "=========================================="
    log "Scheduler complete — success=$success failed=$failed"
    log "=========================================="

    # Remove predictable per-component progress logs after consolidation.
    rm -f "$PROGRESS_DIR"/*.log 2>/dev/null || true

    [[ $failed -eq 0 ]]
}

main "$@"
