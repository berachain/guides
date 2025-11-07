#!/bin/bash
# Berabox Build Script - Always builds debug binaries for development/debugging
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BERABOX_ROOT="$(dirname "$SCRIPT_DIR")"

# Source common functions and configuration
source "$SCRIPT_DIR/common.sh"

# Git operations for repository management

 

# Parse command line arguments
INSTALLATION=""
COMPONENTS=""
NO_PULL=false
QUIET=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --installation)
            INSTALLATION="$2"
            shift 2
            ;;
        --components)
            COMPONENTS="$2"
            shift 2
            ;;
        --no-pull)
            NO_PULL=true
            shift
            ;;
        --quiet)
            QUIET=true
            shift
            ;;
        -h|--help)
            echo "This script is called by the main bb command"
            exit 1
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

if [[ -z "$INSTALLATION" || -z "$COMPONENTS" ]]; then
    log_error "Missing required arguments"
    exit 1
fi

# Load installation configuration and versions
INSTALLATION_DIR="$BERABOX_ROOT/installations/$INSTALLATION"
INSTALLATION_TOML="$INSTALLATION_DIR/installation.toml"

if [[ ! -f "$INSTALLATION_TOML" ]]; then
    log_error "Installation '$INSTALLATION' not found. Expected: $INSTALLATION_TOML"
    exit 1
fi

# Function to read version from installation.toml
load_component_version() {
    local component="$1"
    local version=$(bb_parse_toml_value "$INSTALLATION_TOML" "$component")
    if [[ -z "$version" ]]; then
        log_error "No version specified for $component in installation.toml"
        log_error "Installation may be corrupted. Try recreating it with: ./berabox.sh create"
        exit 1
    fi
    echo "$version"
}

# Acquire exclusive build lock per installation
LOCK_FILE="$INSTALLATION_DIR/.build.lock"
LOCK_FD=200

acquire_lock() {
    exec 200>"$LOCK_FILE"
    if ! flock -n 200; then
        log_error "Another build is already in progress for installation '$INSTALLATION'"
        log_error "If you're sure no other build is running, remove: $LOCK_FILE"
        exit 1
    fi
    echo $$ > "$LOCK_FILE"
    log_info "Build lock acquired for '$INSTALLATION' (PID: $$)"
}

release_lock() {
    if [[ -n "${LOCK_FD:-}" ]]; then
        flock -u "$LOCK_FD" 2>/dev/null || true
        exec 200>&- 2>/dev/null || true
    fi
    rm -f "$LOCK_FILE" 2>/dev/null || true
    log_info "Build lock released for '$INSTALLATION'"
}

# Ensure lock is released on exit
trap release_lock EXIT INT TERM

acquire_lock

# Load paths from installation.toml
SRC_DIR=$(bb_get_installation_path "$INSTALLATION_TOML" "src_dir")

log_info "Building debug binaries: $COMPONENTS (no bin dir; using source/target locations)"
log_info "Using source tree: $SRC_DIR"

# Convert components to array
IFS=',' read -ra COMPONENT_ARRAY <<< "$COMPONENTS"

for component in "${COMPONENT_ARRAY[@]}"; do
    case "$component" in
        "beacon-kit")
            # Check if per-installation repository exists
            if [[ ! -d "$SRC_DIR/beacon-kit" ]]; then
                log_error "beacon-kit source not found at $SRC_DIR/beacon-kit"
                log_error "Run 'bb create' to set up per-installation source trees"
                exit 1
            fi
            
            cd "$SRC_DIR/beacon-kit"
            
            # Load and checkout component version
            BEACON_KIT_VERSION=$(load_component_version "beacon_kit")
            log_substep "Switching beacon-kit to version: $BEACON_KIT_VERSION"
            bb_git_checkout_safe "$SRC_DIR/beacon-kit" "$BEACON_KIT_VERSION" "$NO_PULL"

            # Build with debug symbols and reduced optimizations
            log_step "Building beacond (Go build with debug symbols) from $BEACON_KIT_VERSION..."
            
            # Use a temporary file to capture errors only
            build_log=$(mktemp)
            go_output=""
            [[ "$QUIET" == "true" ]] && go_output=">/dev/null"
            
            # Set build flags for debug build
            go_gcflags="-gcflags=all=-N"
            go_ldflags="-ldflags=-s=false"
            binary_name="beacond-debug"
            
            if eval go build $go_gcflags $go_ldflags -o "$binary_name" ./cmd/beacond 2> "$build_log" $go_output; then
                rm -f "$build_log"
                log_substep "✓ $binary_name built at $(pwd)/$binary_name"
            else
                log_error "Failed to build $binary_name:"
                tail -10 "$build_log" | sed 's/^/    /'
                rm -f "$build_log"
                exit 1
            fi
            ;;
            
        "bera-reth")
            # Check if per-installation repository exists
            if [[ ! -d "$SRC_DIR/bera-reth" ]]; then
                log_error "bera-reth source not found at $SRC_DIR/bera-reth"
                log_error "Run 'bb create' to set up per-installation source trees"
                exit 1
            fi
            
            cd "$SRC_DIR/bera-reth"
            
            # Load and checkout component version
            BERA_RETH_VERSION=$(load_component_version "bera_reth")
            log_substep "Switching bera-reth to version: $BERA_RETH_VERSION"
            bb_git_checkout_safe "$SRC_DIR/bera-reth" "$BERA_RETH_VERSION" "$NO_PULL"

            # Set build flags for debug build
            cargo_flags=""
            binary_path="target/debug/bera-reth"
            binary_name="reth-debug"
            build_type="Cargo debug build"
            
            [[ "$QUIET" == "true" ]] && cargo_flags="$cargo_flags --quiet"
            
            log_step "Building bera-reth ($build_type) from $BERA_RETH_VERSION..."
            
            cargo build --bin bera-reth $cargo_flags
            
            # Copy binary with appropriate name
            cp "$binary_path" "$binary_name"
            log_substep "✓ $binary_name built at $(pwd)/$binary_name"
            ;;
            
        "bera-geth")
            # Check if per-installation repository exists
            if [[ ! -d "$SRC_DIR/bera-geth" ]]; then
                log_error "bera-geth source not found at $SRC_DIR/bera-geth"
                log_error "Run 'bb create' to set up per-installation source trees"
                exit 1
            fi
            
            cd "$SRC_DIR/bera-geth"
            
            # Load and checkout component version
            BERA_GETH_VERSION=$(load_component_version "bera_geth")
            log_substep "Switching bera-geth to version: $BERA_GETH_VERSION"
            bb_git_checkout_safe "$SRC_DIR/bera-geth" "$BERA_GETH_VERSION" "$NO_PULL"

            # Build with debug symbols
            log_step "Building bera-geth (Go build with debug symbols) from $BERA_GETH_VERSION..."
            
            # Use a temporary file to capture errors only
            build_log=$(mktemp)
            go_output=""
            [[ "$QUIET" == "true" ]] && go_output=">/dev/null"
            
            # Set build flags for debug build
            go_gcflags="-gcflags=all=-N"
            go_ldflags="-ldflags=-s=false"
            binary_name="geth-debug"
            
            log_step "Building bera-geth (Go debug build) from $BERA_GETH_VERSION..."
            
            if eval go build $go_gcflags $go_ldflags -o "$binary_name" ./cmd/bera-geth 2> "$build_log" $go_output; then
                rm -f "$build_log"
                log_substep "✓ $binary_name built at $(pwd)/$binary_name"
            else
                log_error "Failed to build $binary_name:"
                tail -10 "$build_log" | sed 's/^/    /'
                rm -f "$build_log"
                exit 1
            fi
            ;;
            
        *)
            log_error "Unknown component: $component"
            log_warn "Valid components: beacon-kit, bera-reth, bera-geth"
            exit 1
            ;;
    esac
done

log_info "Debug binaries built in-place; no bin directory used"
log_info "Next steps: init → install → start"
