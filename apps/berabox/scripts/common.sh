#!/bin/bash

# Berabox Common Functions Library
# Provides shared functionality for all Berabox scripts

set -e

# Script directory detection
COMMON_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BERABOX_ROOT="$(dirname "$COMMON_SCRIPT_DIR")"

# Color definitions for consistent output across all scripts
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info() {
    if [[ "${BB_DEBUG:-false}" == "true" ]]; then
        echo -e "${GREEN}[BB-INFO]\t\t${NC}$1"
    fi
}

log_result() {
    echo -e "${GREEN}[BB-RESULT]\t${NC}$1"
}

log_operation() {
    echo -e "${BLUE}[BB-OP]\t\t${NC}$1"
}

log_warn() {
    echo -e "${YELLOW}[BB-WARN]\t\t${NC}$1"
}

log_error() {
    echo -e "${RED}[BB-ERROR]\t\t${NC}$1"
}

log_debug() {
    if [[ "${BB_DEBUG:-false}" == "true" ]]; then
        echo -e "${CYAN}[BB-DEBUG]\t\t${NC}$1"
    fi
}

log_step() {
    echo -e "${BLUE}[BB-STEP]\t${NC}$1"
}

# Detailed sub-steps (debug only)
log_substep() {
    if [[ "${BB_DEBUG:-false}" == "true" ]]; then
        echo -e "${CYAN}[BB-SUBSTEP]\t${NC}$1"
    fi
}

# Quiet execution functions that respect BB_DEBUG environment variable
run_quiet() {
    local temp_file=$(mktemp)
    if [[ "${BB_DEBUG:-false}" == "true" ]]; then
        "$@" 2>&1 | tee "$temp_file"
        local exit_code=${PIPESTATUS[0]}
    else
        "$@" >"$temp_file" 2>&1
        local exit_code=$?
    fi
    
    # Always show output on error
    if [[ $exit_code -ne 0 ]]; then
        echo "Command failed: $*" >&2
        cat "$temp_file" >&2
    fi
    
    rm -f "$temp_file"
    return $exit_code
}

# Echo function that respects BB_DEBUG mode
debug_echo() {
    if [[ "${BB_DEBUG:-false}" == "true" ]]; then
        echo "$@"
    fi
}

# Configuration management
BB_CONFIG_INSTALLATIONS_DIR="${BB_CONFIG_INSTALLATIONS_DIR:-$BERABOX_ROOT/installations}"

# Installation ownership checking
bb_check_installation_ownership() {
    local installation="$1"
    local installation_dir="$BB_CONFIG_INSTALLATIONS_DIR/$installation"
    
    if [[ ! -d "$installation_dir" ]]; then
        return 1
    fi
    
    # Get the owner of the installation directory
    local owner=$(stat -c '%U' "$installation_dir" 2>/dev/null || echo "")
    local current_user=$(whoami)
    
    if [[ "$owner" == "$current_user" ]]; then
        return 0  # User owns the installation
    else
        return 1  # User doesn't own the installation
    fi
}

bb_get_installation_owner() {
    local installation="$1"
    local installation_dir="$BB_CONFIG_INSTALLATIONS_DIR/$installation"
    
    if [[ ! -d "$installation_dir" ]]; then
        echo ""
        return 1
    fi
    
    stat -c '%U' "$installation_dir" 2>/dev/null || echo ""
}

# Installation validation and utility functions
bb_validate_installation() {
    local installation="$1"
    
    if [[ -z "$installation" ]]; then
        log_error "Installation name required"
        return 1
    fi
    
    local installation_dir="$BB_CONFIG_INSTALLATIONS_DIR/$installation"
    local toml_file="$installation_dir/installation.toml"
    
    if [[ ! -d "$installation_dir" ]]; then
        log_error "Installation '$installation' not found"
        return 1
    fi
    
    if [[ ! -f "$toml_file" ]]; then
        log_error "Installation '$installation' is corrupted (missing installation.toml)"
        log_warn "Try recreating with: $0 create <chain> <el-client> <name>"
        return 1
    fi
    
    return 0
}

bb_get_installation_toml() {
    local installation="$1"
    echo "$BB_CONFIG_INSTALLATIONS_DIR/$installation/installation.toml"
}

bb_get_installation_dir() {
    local installation="$1"
    echo "$BB_CONFIG_INSTALLATIONS_DIR/$installation"
}

bb_installation_exists() {
    local installation="$1"
    local toml_file=$(bb_get_installation_toml "$installation")
    [[ -f "$toml_file" ]]
}

# TOML parsing utilities
bb_parse_toml_value() {
    local toml_file="$1"
    local key="$2"
    
    if [[ ! -f "$toml_file" ]]; then
        log_error "Configuration file not found: $toml_file"
        return 1
    fi
    
    local value=$(grep "^$key = " "$toml_file" | sed 's/.*= "//' | sed 's/"//' | sed 's/.*= //')
    
    if [[ -z "$value" ]]; then
        log_debug "Key '$key' not found in $toml_file"
        return 1
    fi
    
    echo "$value"
}

bb_parse_toml_array() {
    local toml_file="$1"
    local key="$2"
    
    if [[ ! -f "$toml_file" ]]; then
        log_error "Configuration file not found: $toml_file"
        return 1
    fi
    
    # Extract array values between [ and ], handling multi-line arrays
    local array_content=$(awk -v key="$key" '
        $0 ~ "^" key " = \\[" {
            # Single-line array
            if ($0 ~ /\]/) {
                gsub(/.*\[/, "")
                gsub(/\].*/, "")
                print $0
                exit
            }
            # Multi-line array start
            in_array = 1
            gsub(/.*\[/, "")
            line = $0
            next
        }
        in_array {
            if ($0 ~ /\]/) {
                # End of array
                gsub(/\].*/, "")
                line = line "\n" $0
                print line
                exit
            }
            line = line "\n" $0
        }
    ' "$toml_file")
    
    if [[ -z "$array_content" ]]; then
        log_debug "Array key '$key' not found in $toml_file"
        return 1
    fi
    
    # Extract quoted strings, one per line, filter out empty lines and comma-only lines
    echo "$array_content" | grep -oP '"\K[^"]+' | grep -vE '^[,[:space:]]*$' || true
}

# Installation iteration utilities
bb_iterate_all_installations_with_errors() {
    local command_name="$1"
    local command_func="$2"
    shift 2
    
    log_operation "${command_name^} for all installations..."
    
    if [[ ! -d "$BB_CONFIG_INSTALLATIONS_DIR" ]]; then
        log_warn "No installations directory found"
        return
    fi
    
    local installations=()
    local failed_installations=()
    local success_count=0
    
    # Collect all valid installations
    for installation_dir in "$BB_CONFIG_INSTALLATIONS_DIR"/*; do
        if [[ -d "$installation_dir" && -f "$installation_dir/installation.toml" ]]; then
            installations+=("$(basename "$installation_dir")")
        fi
    done
    
    if [[ ${#installations[@]} -eq 0 ]]; then
        log_warn "No installations found"
        return
    fi
    
    log_info "Found ${#installations[@]} installation(s): ${installations[*]}"
    
    # Execute command for each installation
    for installation in "${installations[@]}"; do
        log_step "${command_name^}ing installation: $installation"
        
        # Temporarily disable set -e to allow processing to continue on individual failures
        set +e
        if "$command_func" "$installation" "$@"; then
            ((success_count++))
        else
            log_error "✗ $installation: ${command_name} failed"
            failed_installations+=("$installation")
        fi
        set -e
    done
    
    # Report results
    if [[ ${#failed_installations[@]} -gt 0 ]]; then
        log_error "Failed to $command_name for: ${failed_installations[*]}"
        if [[ $success_count -gt 0 ]]; then
            log_result "Successful ${command_name} in $success_count installation(s)"
        fi
        return 1
    else
        log_result "✓ Successful ${command_name} in all ${#installations[@]} installation(s)"
    fi
}

# Service status checking utilities
# Get service PID if running
bb_get_service_pid() {
    local installation="$1"
    local component="${2:-}"
    
    # Use installation name directly as service name
    local service_name="$installation"
    if [[ -n "$component" ]]; then
        service_name="$service_name-$component"
    fi
    
    # Add .service suffix for systemctl commands
    local service_file="$service_name.service"
    
    if systemctl --user is-active --quiet "$service_file" 2>/dev/null; then
        local pid=$(systemctl --user show -p MainPID "$service_file" 2>/dev/null | cut -d= -f2)
        if [[ -n "$pid" && "$pid" != "0" ]]; then
            echo "$pid"
        fi
    fi
    
    return 0
}

bb_get_service_status() {
    local installation="$1"
    local component="${2:-}"
    
    # Use installation name directly as service name
    # installation="testnet-reth" -> service_name="testnet-reth"
    local service_name="$installation"
    if [[ -n "$component" ]]; then
        service_name="$service_name-$component"
    fi
    
    # Add .service suffix for systemctl commands
    local service_file="$service_name.service"
    
    if systemctl --user list-unit-files "$service_file" 2>/dev/null | grep -q "$service_file"; then
        if systemctl --user is-active --quiet "$service_file" 2>/dev/null; then
            # Get PID of the running service
            local pid=$(systemctl --user show -p MainPID "$service_file" 2>/dev/null | cut -d= -f2)
            if [[ -n "$pid" && "$pid" != "0" ]]; then
                echo "Running (PID: $pid)"
            else
                echo "Running"
            fi
        else
            echo "Stopped"
        fi
    else
        echo "Not Installed"
    fi
}

bb_get_installation_status() {
    local installation="$1"
    
    local cl_status=$(bb_get_service_status "$installation" "cl")
    local el_status=$(bb_get_service_status "$installation" "el")
    
    if [[ "$cl_status" == Running* && "$el_status" == Running* ]]; then
        echo "Running"
    elif [[ "$cl_status" == Running* || "$el_status" == Running* ]]; then
        echo "Partial"
    elif [[ "$cl_status" == "Not Installed" && "$el_status" == "Not Installed" ]]; then
        echo "Not Installed"
    else
        echo "Stopped"
    fi
}

# Argument parsing utilities
bb_parse_boolean_arg() {
    local value="$1"
    case "$value" in
        "true"|"1"|"yes"|"on")
            echo "true"
            ;;
        "false"|"0"|"no"|"off"|"")
            echo "false"
            ;;
        *)
            bb_log_error "Invalid boolean value: $value"
            return 1
            ;;
    esac
}

# File and directory utilities
bb_ensure_directory() {
    local dir="$1"
    if [[ ! -d "$dir" ]]; then
        mkdir -p "$dir"
        log_debug "Created directory: $dir"
    fi
}

bb_backup_file() {
    local file="$1"
    local backup_suffix="${2:-.bak}"
    
    if [[ -f "$file" ]]; then
        local backup_file="$file$backup_suffix"
        cp "$file" "$backup_file"
        log_debug "Backed up $file to $backup_file"
    fi
}

# Network utilities
bb_get_external_ip() {
    # Detect external IPv4 address for NAT configuration
    curl -s ipv4.canhazip.com 2>/dev/null || echo ""
}

# Validation utilities
bb_require_arg() {
    local value="$1"
    local name="$2"
    local usage_func="${3:-}"
    
    if [[ -z "$value" ]]; then
        log_error "$name is required"
        if [[ -n "$usage_func" ]]; then
            $usage_func
        fi
        return 1
    fi
}

bb_require_file() {
    local file="$1"
    local description="$2"
    
    if [[ ! -f "$file" ]]; then
        log_error "$description not found: $file"
        return 1
    fi
}

bb_require_directory() {
    local dir="$1"
    local description="$2"
    
    if [[ ! -d "$dir" ]]; then
        log_error "$description not found: $dir"
        return 1
    fi
}

# Git utilities
bb_git_refresh_refs() {
    local repo_dir="$1"
    local remote_name="${2:-origin}"

    if [[ -z "$repo_dir" || ! -d "$repo_dir/.git" ]]; then
        log_error "Not a git repository: $repo_dir"
        return 1
    fi

    pushd "$repo_dir" >/dev/null || return 1
    # Fetch branches and tags quietly; show details only in BB_DEBUG
    if run_quiet git fetch "$remote_name" --prune --tags; then
        log_info "✓ Refreshed git refs (branches and tags) in $repo_dir"
    else
        log_warn "Failed to refresh git refs in $repo_dir"
        popd >/dev/null
        return 1
    fi
    popd >/dev/null
}

bb_git_checkout_safe() {
    local repo_dir="$1"
    local ref="$2"
    local no_pull="${3:-false}"
    
    if [[ -z "$ref" ]]; then
        return 0  # No ref specified, skip checkout
    fi
    
    pushd "$repo_dir" >/dev/null || { log_error "Repo not found: $repo_dir"; return 1; }
    
    # Always fetch latest refs unless --no-pull is specified
    if [[ "$no_pull" == "false" ]]; then
        log_substep "Fetching latest refs..."
        if bb_git_refresh_refs "$repo_dir" origin; then
            log_info "✓ Fetched latest refs"
        else
            log_warn "Failed to fetch latest refs, using current refs"
        fi
    elif [[ "$no_pull" == "true" ]]; then
        log_info "⏭ Skipping git fetch (--no-pull specified)"
    fi
    
    # Decide if ref is a tag or a branch and switch appropriately
    if git show-ref --tags --quiet -- "refs/tags/$ref" || git ls-remote --exit-code --tags origin "$ref" >/dev/null 2>&1; then
        # Tag: checkout detached at tag
        if git checkout -q "tags/$ref" 2>/dev/null; then
            log_substep "✓ Checked out tag $ref"
        else
            log_error "Failed to checkout tag $ref in $repo_dir"
            popd >/dev/null
            return 1
        fi
    else
        # Branch: ensure local branch tracks and fast-forward to origin
        if [[ "$no_pull" == "false" ]]; then
            # Create/reset branch to remote (fast-forward to exact origin state)
            if git checkout -B "$ref" "origin/$ref" 2>/dev/null; then
                log_substep "✓ Fast-forwarded branch $ref to origin/$ref"
            else
                log_warn "Branch $ref not found on origin; attempting local checkout"
                if ! git checkout "$ref" 2>/dev/null; then
                    log_error "Failed to switch to branch $ref in $repo_dir"
                    popd >/dev/null
                    return 1
                fi
            fi
        else
            # No-pull: just switch to local branch
            if ! git checkout "$ref" 2>/dev/null; then
                log_error "Branch $ref not found locally and --no-pull set"
                popd >/dev/null
                return 1
            fi
        fi
    fi

    
    popd >/dev/null
}

# Path loading functions for installation configuration
bb_load_installation_paths() {
    local installation_toml="$1"
    
    # Load all path values from installation.toml
    local paths=(
        "installation_dir"
        "src_dir" 
        # bin_dir removed; keep function table stable for compatibility
        "cl_data_dir"
        "el_data_dir"
        "cl_config_dir"
        "el_config_dir"
        "cl_logs_dir"
        "el_logs_dir"
    )
    
    local path_vars=()
    for path in "${paths[@]}"; do
        local value=$(bb_parse_toml_value "$installation_toml" "paths.$path" || echo "")
        if [[ -n "$value" ]]; then
            path_vars+=("$path=$value")
        fi
    done
    
    # Return the path variables as a space-separated string
    echo "${path_vars[*]}"
}

bb_get_installation_path() {
    local installation_toml="$1"
    local path_key="$2"
    
    # Handle nested sections by looking for the key within the [paths] section
    local value=$(awk -v key="$path_key" '
        /^\[paths\]/ { in_paths = 1; next }
        /^\[/ { in_paths = 0; next }
        in_paths && $0 ~ "^" key " = " {
            gsub(/^[^=]*= /, "")
            gsub(/^"/, "")
            gsub(/"$/, "")
            print $0
            exit
        }
    ' "$installation_toml")
    
    if [[ -n "$value" ]]; then
        echo "$value"
    else
        log_debug "Key 'paths.$path_key' not found in $installation_toml"
        return 1
    fi
}

# Validator information utilities
bb_check_cl_initialized() {
    local installation="$1"
    local installation_dir=$(bb_get_installation_dir "$installation")
    local cl_config_dir="$installation_dir/data/cl/config"
    
    # Check if the priv_validator_key.json exists (created by beacond init)
    [[ -f "$cl_config_dir/priv_validator_key.json" ]]
}

bb_get_validator_keys() {
    local installation="$1"
    local installation_dir=$(bb_get_installation_dir "$installation")
    local beacond_bin="$installation_dir/src/beacon-kit/beacond-debug"
    local cl_data_dir="$installation_dir/data/cl"
    
    # Check if beacond binary exists (try debug first, then regular)
    if [[ ! -f "$beacond_bin" ]]; then
        beacond_bin="$installation_dir/src/beacon-kit/beacond"
        if [[ ! -f "$beacond_bin" ]]; then
            log_debug "beacond binary not found at $installation_dir/src/beacon-kit/"
            return 1
        fi
    fi
    
    # Check if CL has been initialized
    if ! bb_check_cl_initialized "$installation"; then
        log_debug "CL not initialized for $installation"
        return 1
    fi
    
    # Run beacond deposit validator-keys command
    local output=$("$beacond_bin" deposit validator-keys --home "$cl_data_dir" 2>/dev/null)
    if [[ $? -ne 0 || -z "$output" ]]; then
        log_debug "Failed to get validator keys for $installation"
        return 1
    fi
    
    # Parse the output
    local comet_address=$(echo "$output" | grep -A1 "Comet Address:" | tail -1 | tr -d '[:space:]')
    local comet_pubkey=$(echo "$output" | grep -A1 "Comet Pubkey (Uncompressed Base64):" | tail -1 | tr -d '[:space:]')
    local eth_beacon_pubkey=$(echo "$output" | grep -A1 "Eth/Beacon Pubkey (Compressed 48-byte Hex):" | tail -1 | tr -d '[:space:]')
    
    # Return as associative array format
    echo "comet_address=$comet_address"
    echo "comet_pubkey=$comet_pubkey"
    echo "eth_beacon_pubkey=$eth_beacon_pubkey"
}

bb_get_el_enode() {
    local installation="$1"
    local installation_dir=$(bb_get_installation_dir "$installation")
    local ipc_path="$installation_dir/runtime/admin.ipc"
    
    # Check if IPC socket exists (indicates EL is running)
    if [[ ! -S "$ipc_path" ]]; then
        log_debug "EL IPC socket not found at $ipc_path"
        return 1
    fi
    
    # Find a geth binary to use for attachment (can attach to any EL client)
    local geth_binary=""
    
    # Try to find geth in any installation
    for inst_dir in "$BB_CONFIG_INSTALLATIONS_DIR"/*; do
        if [[ -f "$inst_dir/src/bera-geth/geth-debug" ]]; then
            geth_binary="$inst_dir/src/bera-geth/geth-debug"
            break
        fi
    done
    
    # Fallback to system geth
    if [[ -z "$geth_binary" ]]; then
        geth_binary=$(command -v geth 2>/dev/null || echo "")
    fi
    
    if [[ -z "$geth_binary" ]]; then
        log_debug "No geth binary found for IPC attachment"
        return 1
    fi
    
    # Get enode via IPC
    local enode=$(echo 'admin.nodeInfo.enode' | "$geth_binary" attach "$ipc_path" 2>/dev/null | grep -E '^"enode://' | tr -d '"')
    
    if [[ -n "$enode" ]]; then
        echo "$enode"
        return 0
    else
        log_debug "Failed to retrieve enode from $ipc_path"
        return 1
    fi
}

# Export functions for use in other scripts
export -f log_info log_result log_operation log_warn log_error log_debug log_step log_substep
export -f run_quiet debug_echo
export -f bb_validate_installation bb_get_installation_toml bb_get_installation_dir bb_installation_exists
export -f bb_parse_toml_value bb_parse_toml_array bb_iterate_all_installations_with_errors
export -f bb_get_service_status bb_get_installation_status
export -f bb_parse_boolean_arg
export -f bb_ensure_directory bb_backup_file bb_git_checkout_safe bb_get_external_ip
export -f bb_require_arg bb_require_file bb_require_directory
export -f bb_load_installation_paths bb_get_installation_path
export -f bb_check_cl_initialized bb_get_validator_keys bb_get_el_enode

