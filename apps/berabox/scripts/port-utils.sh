#!/bin/bash
# Simple port utilities for berabox installations
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BERABOX_ROOT="$(dirname "$SCRIPT_DIR")"

# Source common functions
source "$SCRIPT_DIR/common.sh"

# Calculate all ports from a base port (simple arithmetic)
calculate_ports_from_base() {
    local base_port="$1"
    
    if [[ -z "$base_port" || ! "$base_port" =~ ^[0-9]+$ ]]; then
        log_error "Base port must be a number"
        return 1
    fi
    
    # Export global port variables for use by calling scripts
    # Thematic grouping: same final digit for related services
    export CL_RPC_PORT=$((base_port + 0))        # CL RPC (ends in 0)
    export CL_P2P_PORT=$((base_port + 1))        # CL P2P (ends in 1)
    export CL_PROMETHEUS_PORT=$((base_port + 3)) # CL Prometheus (ends in 3)
    export CL_PPROF_PORT=$((base_port + 4))      # CL PProf (ends in 4)
    export NODE_API_PORT=$((base_port + 5))      # CL Node API (ends in 5)
    export EL_RPC_PORT=$((base_port + 10))       # EL RPC (ends in 0)
    export EL_P2P_PORT=$((base_port + 11))       # EL P2P (ends in 1, matches CL P2P)
    export EL_AUTHRPC_PORT=$((base_port + 12))   # EL AuthRPC (ends in 2)
    export EL_PROMETHEUS_PORT=$((base_port + 13)) # EL Prometheus (ends in 3)
    export EL_WS_PORT=$((base_port + 15))        # EL WebSockets (ends in 5)
}

# Load ports from installation.toml
load_ports() {
    local installation_name="$1"
    local installation_toml="$BERABOX_ROOT/installations/$installation_name/installation.toml"
    
    if [[ ! -f "$installation_toml" ]]; then
        log_error "Installation '$installation_name' not found: $installation_toml"
        return 1
    fi
    
    local base_port=$(grep "^base_port = " "$installation_toml" | sed 's/.*= //')
    
    if [[ -z "$base_port" ]]; then
        log_error "No base_port found in $installation_toml"
        return 1
    fi
    
    calculate_ports_from_base "$base_port"
}

# Check for conflicts with existing BeraBox installations
check_berabox_port_conflicts() {
    local base_port="$1"
    local installations_dir="${BERABOX_ROOT}/installations"
    
    if [[ ! -d "$installations_dir" ]]; then
        return 0  # No installations directory, no conflicts
    fi
    
    # Check against all existing installations
    for installation_dir in "$installations_dir"/*; do
        if [[ -d "$installation_dir" && -f "$installation_dir/installation.toml" ]]; then
            local existing_base=$(grep "^base_port = " "$installation_dir/installation.toml" | sed 's/.*= //' 2>/dev/null || echo "")
            if [[ -n "$existing_base" && "$existing_base" =~ ^[0-9]+$ ]]; then
                # Check if port ranges overlap (each installation uses 20 ports)
                local existing_max=$((existing_base + 19))
                local new_max=$((base_port + 19))
                
                if [[ $base_port -le $existing_max && $new_max -ge $existing_base ]]; then
                    log_debug "Port range $base_port-$new_max conflicts with existing installation at $existing_base-$existing_max"
                    return 1  # Conflict found
                fi
            fi
        fi
    done
    
    return 0  # No conflicts
}

# Simple port conflict check for new installations
check_port_conflicts() {
    local base_port="$1"
    
    if [[ -z "$base_port" || ! "$base_port" =~ ^[0-9]+$ ]]; then
        log_error "Base port must be a number"
        return 1
    fi
    
    # Check system ports in our range (base_port to base_port+19)
    for ((port=base_port; port<=base_port+19; port++)); do
        if ss -tuln 2>/dev/null | grep -q ":$port "; then
            log_debug "System port $port is already in use"
            return 1  # Conflict found
        fi
    done
    
    # Check against existing BeraBox installations
    if ! check_berabox_port_conflicts "$base_port"; then
        return 1  # Conflict found
    fi
    
    return 0  # No conflicts
}

# Find the next available port base by bumping by 20 until clear
find_available_port_base() {
    local requested_base="$1"
    local max_attempts="${2:-50}"  # Maximum attempts to prevent infinite loops
    
    if [[ -z "$requested_base" || ! "$requested_base" =~ ^[0-9]+$ ]]; then
        log_error "Base port must be a number"
        return 1
    fi
    
    local current_base="$requested_base"
    local attempts=0
    
    log_debug "Checking port availability starting from base $requested_base"
    
    while [[ $attempts -lt $max_attempts ]]; do
        if check_port_conflicts "$current_base"; then
            # Found a clear range
            if [[ "$current_base" != "$requested_base" ]]; then
                log_info "Port base $requested_base unavailable, using $current_base instead" >&2
            fi
            echo "$current_base"
            return 0
        fi
        
        # Bump by 20 and try again
        current_base=$((current_base + 20))
        attempts=$((attempts + 1))
        
        log_debug "Port range $((current_base - 20))-$((current_base - 1)) in use, trying $current_base"
    done
    
    log_error "Could not find available port range after $max_attempts attempts"
    return 1
}