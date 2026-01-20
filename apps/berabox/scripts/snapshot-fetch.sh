#!/bin/bash
# Berabox Snapshot Fetching Script - Downloads and extracts snapshots from snapshots.berachain.com
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BERABOX_ROOT="$(dirname "$SCRIPT_DIR")"

# Source common functions and configuration
source "$SCRIPT_DIR/common.sh"

# Configuration
SNAPSHOT_BASE_URL="https://snapshots.berachain.com"
SNAPSHOT_INDEX_URL="$SNAPSHOT_BASE_URL/index.csv"

# Parse command line arguments
INSTALLATION_NAME=""
SKIP_CL=false
SKIP_EL=false

usage() {
    echo "Usage: $0 --installation <name> [--skip-cl] [--skip-el]"
    echo ""
    echo "Options:"
    echo "  --installation <name>  Installation name"
    echo "  --skip-cl              Skip consensus layer snapshot"
    echo "  --skip-el              Skip execution layer snapshot"
    exit 1
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --installation)
            INSTALLATION_NAME="$2"
            shift 2
            ;;
        --skip-cl)
            SKIP_CL=true
            shift
            ;;
        --skip-el)
            SKIP_EL=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            ;;
    esac
done

# Validate required arguments
if [[ -z "$INSTALLATION_NAME" ]]; then
    log_error "Installation name required"
    usage
fi

INSTALLATION_DIR="$BERABOX_ROOT/installations/$INSTALLATION_NAME"
INSTALLATION_TOML="$INSTALLATION_DIR/installation.toml"

# Check if installation exists
if [[ ! -f "$INSTALLATION_TOML" ]]; then
    log_error "Installation '$INSTALLATION_NAME' not found"
    exit 1
fi

# Load installation configuration
chain=$(bb_parse_toml_value "$INSTALLATION_TOML" "chain")
el_client=$(bb_parse_toml_value "$INSTALLATION_TOML" "el_client")
archive_mode=$(bb_parse_toml_value "$INSTALLATION_TOML" "options.archive_mode" || echo "false")

# Only mainnet snapshots are available
if [[ "$chain" != "mainnet" ]]; then
    log_error "Snapshots are only available for mainnet"
    log_info "Testnet nodes must sync from genesis using 'bb $INSTALLATION_NAME init'"
    exit 1
fi

log_operation "Fetching snapshots for $INSTALLATION_NAME ($chain + $el_client)"

# Determine snapshot types based on configuration
if [[ "$archive_mode" == "true" ]]; then
    CL_SNAPSHOT_TYPE="beacon-kit-archive"
    EL_SNAPSHOT_TYPE="${el_client}-archive"
    log_info "Archive mode enabled - fetching archive snapshots"
else
    CL_SNAPSHOT_TYPE="beacon-kit-pruned"
    EL_SNAPSHOT_TYPE="${el_client}-pruned"
    log_info "Pruned mode - fetching pruned snapshots"
fi

# Define data directories
CL_DATA_DIR="$INSTALLATION_DIR/data/cl"
EL_DATA_DIR="$INSTALLATION_DIR/data/el/chain"

# Check dependencies
check_dependencies() {
    local missing_deps=()
    
    if ! command -v curl >/dev/null 2>&1; then
        missing_deps+=("curl")
    fi
    
    if ! command -v lz4 >/dev/null 2>&1; then
        missing_deps+=("lz4")
    fi
    
    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        log_error "Missing required dependencies: ${missing_deps[*]}"
        echo ""
        echo "Install with:"
        echo "  Ubuntu/Debian: sudo apt-get install ${missing_deps[*]}"
        echo "  macOS: brew install ${missing_deps[*]}"
        exit 1
    fi
}

# Fetch and parse CSV index
fetch_snapshot_url() {
    local snapshot_type="$1"
    
    log_step "Fetching snapshot index from $SNAPSHOT_INDEX_URL" >&2
    
    # Download CSV and parse
    local csv_data=$(curl -fsSL "$SNAPSHOT_INDEX_URL")
    if [[ -z "$csv_data" ]]; then
        log_error "Failed to fetch snapshot index" >&2
        return 1
    fi
    
    # Parse CSV to find latest matching snapshot
    # CSV format: type,size_bytes,block_number,version,created_at,sha256,url
    # We want the latest (first match after header) for the given type
    local snapshot_url=$(echo "$csv_data" | tr -d '\r' | awk -F',' -v type="$snapshot_type" '
        NR > 1 && $1 == type {
            print $7
            exit
        }
    ')
    
    if [[ -z "$snapshot_url" ]]; then
        log_error "No snapshot found for type=$snapshot_type" >&2
        return 1
    fi
    
    echo "$snapshot_url"
}

# Download and extract snapshot
download_and_extract_snapshot() {
    local snapshot_url="$1"
    local target_dir="$2"
    local snapshot_name="$3"
    
    log_step "Downloading and extracting $snapshot_name snapshot"
    log_info "URL: $snapshot_url"
    log_info "Target: $target_dir"
    
    # Create target directory if it doesn't exist
    mkdir -p "$target_dir"
    
    # Stream download and extract
    log_info "Streaming download and extraction (this may take a while)..."
    if curl -fsSL "$snapshot_url" | lz4 -d | tar -xf - -C "$target_dir"; then
        log_result "✓ Successfully extracted $snapshot_name snapshot"
        return 0
    else
        log_error "Failed to download or extract $snapshot_name snapshot"
        return 1
    fi
}

# Check if data already exists
check_data_exists() {
    local data_dir="$1"
    local check_file="$2"
    
    if [[ -f "$data_dir/$check_file" ]]; then
        return 0
    else
        return 1
    fi
}

# Main execution
main() {
    check_dependencies
    
    local has_errors=false
    
    # Process CL snapshot
    if [[ "$SKIP_CL" == "false" ]]; then
        log_operation "Processing consensus layer snapshot"
        
        # Check if CL data already exists
        if check_data_exists "$CL_DATA_DIR" "data/blockstore.db"; then
            log_warn "CL data already exists at $CL_DATA_DIR/data/blockstore.db"
            log_info "Skipping CL snapshot download (use 'reset' to wipe data first)"
        else
            # Fetch snapshot URL
            local cl_snapshot_url=$(fetch_snapshot_url "$CL_SNAPSHOT_TYPE")
            if [[ -z "$cl_snapshot_url" ]]; then
                log_error "Failed to find CL snapshot"
                has_errors=true
            else
                # Download and extract
                if ! download_and_extract_snapshot "$cl_snapshot_url" "$CL_DATA_DIR" "CL"; then
                    has_errors=true
                fi
            fi
        fi
    else
        log_info "Skipping CL snapshot (--skip-cl specified)"
    fi
    
    # Process EL snapshot
    if [[ "$SKIP_EL" == "false" ]]; then
        log_operation "Processing execution layer snapshot"
        
        # Check if EL data already exists
        # Different clients have different data structures
        local el_check_file=""
        if [[ "$el_client" == "reth" ]]; then
            el_check_file="db/mdbx.dat"
        else
            el_check_file="geth/chaindata/CURRENT"
        fi
        
        if check_data_exists "$EL_DATA_DIR" "$el_check_file"; then
            log_warn "EL data already exists at $EL_DATA_DIR/$el_check_file"
            log_info "Skipping EL snapshot download (use 'reset' to wipe data first)"
        else
            # Fetch snapshot URL
            local el_snapshot_url=$(fetch_snapshot_url "$EL_SNAPSHOT_TYPE")
            if [[ -z "$el_snapshot_url" ]]; then
                log_error "Failed to find EL snapshot"
                has_errors=true
            else
                # Download and extract
                if ! download_and_extract_snapshot "$el_snapshot_url" "$EL_DATA_DIR" "EL"; then
                    has_errors=true
                fi
            fi
        fi
    else
        log_info "Skipping EL snapshot (--skip-el specified)"
    fi
    
    if [[ "$has_errors" == "true" ]]; then
        log_error "Snapshot fetching completed with errors"
        exit 1
    else
        log_result "✓ Snapshot fetching completed successfully"
        echo ""
        echo "Next steps:"
        echo "  bb $INSTALLATION_NAME init     # Initialize network parameters"
        echo "  bb $INSTALLATION_NAME install  # Install systemd services"
        echo "  bb $INSTALLATION_NAME start    # Start node"
    fi
}

main
