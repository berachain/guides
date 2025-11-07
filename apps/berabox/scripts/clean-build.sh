#!/bin/bash

# Berabox Build Artifact Cleaner
# Supports per-installation and global cleaning with granular control

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BERABOX_ROOT="$(dirname "$SCRIPT_DIR")"

# Source common functions and configuration
source "$SCRIPT_DIR/common.sh"

# Clean build artifacts for a specific installation
clean_installation_artifacts() {
    local installation="$1"
    local installation_dir="$BERABOX_ROOT/installations/$installation"
    
    if [[ ! -d "$installation_dir" ]]; then
        log_error "Installation $installation not found at $installation_dir"
        return 1
    fi
    
    # Clean Rust artifacts (both in src subdirs and installation target dir)
    local rust_targets=($(find "$installation_dir/src" -name "target" -type d 2>/dev/null || true))
    if [[ -d "$installation_dir/target" ]]; then
        rust_targets+=("$installation_dir/target")
    fi
    
    if [[ ${#rust_targets[@]} -gt 0 ]]; then
        for target in "${rust_targets[@]}"; do
            rm -rf "$target"
        done
        log_substep "✓ Cleaned ${#rust_targets[@]} Rust target directories (EL: reth/geth)"
    else
        log_info "- No Rust target directories found (EL: reth/geth)"
    fi
    
    # Clean Go artifacts  
    local go_bins=($(find "$installation_dir/src" -name "bin" -type d 2>/dev/null || true))
    local go_binaries=($(find "$installation_dir/src" \( -name "*-debug" -o -name "*-release" \) -type f 2>/dev/null || true))
    
    local go_cleaned=0
    if [[ ${#go_bins[@]} -gt 0 ]]; then
        for bin in "${go_bins[@]}"; do
            rm -rf "$bin"
        done
        ((go_cleaned += ${#go_bins[@]}))
    fi
    
    if [[ ${#go_binaries[@]} -gt 0 ]]; then
        for binary in "${go_binaries[@]}"; do
            rm -f "$binary"
        done
        ((go_cleaned += ${#go_binaries[@]}))
    fi
    
    if [[ $go_cleaned -gt 0 ]]; then
        log_substep "✓ Cleaned $go_cleaned Go build artifacts (CL: beacon-kit)"
    else
        log_info "- No Go build artifacts found (CL: beacon-kit)"
    fi
    
    # Clean logs for this installation
    if [[ -d "$installation_dir/logs" ]]; then
        local log_files=($(find "$installation_dir/logs" -name "*.log" -type f 2>/dev/null || true))
        if [[ ${#log_files[@]} -gt 0 ]]; then
            find "$installation_dir/logs" -name "*.log" -type f -delete 2>/dev/null || true
            log_substep "✓ Cleaned ${#log_files[@]} log files"
        else
            log_info "- No log files found"
        fi
    else
        log_info "- No logs directory found"
    fi
    
    # Note: Installed binaries in $installation_dir/bin/ are preserved
}

# Main script logic - support both per-installation and global cleaning
if [[ $# -eq 0 ]]; then
    # No arguments provided - clean all installations (current behavior)
    # Use the unified iterator for bulk operations
    bb_iterate_all_installations_with_errors "clean" "clean_installation_artifacts"
else
    # Installation name provided as argument - clean only that installation
    installation="$1"
    clean_installation_artifacts "$installation"
    log_result "✓ Cleaned installation: $installation"
fi

log_info "Done."
