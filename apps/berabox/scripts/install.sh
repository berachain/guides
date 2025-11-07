#!/bin/bash
# Berabox Service Installation Script
# Installs systemd services for an existing installation

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BERABOX_ROOT="$(dirname "$SCRIPT_DIR")"

# Source common functions and configuration
source "$SCRIPT_DIR/common.sh"
source "$SCRIPT_DIR/port-utils.sh"

# UPnP management functions
setup_upnp_forwarding() {
    local installation_name="$1"
    local installation_dir="${BB_CONFIG_INSTALLATIONS_DIR:-$BERABOX_ROOT/installations}/$installation_name"
    local installation_toml="$installation_dir/installation.toml"
    
    # Check if UPnP is enabled
    local upnp_enabled=$(bb_parse_toml_value "$installation_toml" "enabled" || echo "false")
    if [[ "$upnp_enabled" != "true" ]]; then
        log_info "UPnP disabled - skipping port forwarding setup"
        return 0
    fi
    
    # Check if upnpc is available
    if ! command -v upnpc >/dev/null 2>&1; then
        log_warn "UPnP enabled but 'upnpc' not found - install miniupnpc package"
        return 0
    fi
    
    log_operation "Setting up UPnP port forwarding for $installation_name..."
    
    # Load port configuration
    load_ports "$installation_name"
    
    # Get UPnP lease time
    local lease_time=$(bb_parse_toml_value "$installation_toml" "lease_time" || echo "86400")
    
    # Forward P2P ports only (not RPC/admin ports) - both TCP and UDP
    local success=true
    
    # CL P2P port - TCP
    log_info "Forwarding CL P2P port $CL_P2P_PORT → $CL_P2P_PORT (internal → external) TCP..."
    local temp_file=$(mktemp)
    if upnpc -a $(hostname -I | awk '{print $1}') "$CL_P2P_PORT" "$CL_P2P_PORT" TCP "$lease_time" >"$temp_file" 2>&1; then
        log_result "✓ UPnP: CL P2P port $CL_P2P_PORT TCP forwarded"
        if [[ "${DEBUG:-}" == "1" ]]; then
            cat "$temp_file"
        fi
    else
        log_warn "✗ UPnP: Failed to forward CL P2P port $CL_P2P_PORT TCP"
        if [[ "${DEBUG:-}" == "1" ]]; then
            cat "$temp_file" >&2
        fi
        success=false
    fi
    rm -f "$temp_file"
    
    # CL P2P port - UDP
    log_info "Forwarding CL P2P port $CL_P2P_PORT → $CL_P2P_PORT (internal → external) UDP..."
    local temp_file=$(mktemp)
    if upnpc -a $(hostname -I | awk '{print $1}') "$CL_P2P_PORT" "$CL_P2P_PORT" UDP "$lease_time" >"$temp_file" 2>&1; then
        log_result "✓ UPnP: CL P2P port $CL_P2P_PORT UDP forwarded"
        if [[ "${DEBUG:-}" == "1" ]]; then
            cat "$temp_file"
        fi
    else
        log_warn "✗ UPnP: Failed to forward CL P2P port $CL_P2P_PORT UDP"
        if [[ "${DEBUG:-}" == "1" ]]; then
            cat "$temp_file" >&2
        fi
        success=false
    fi
    rm -f "$temp_file"
    
    # EL P2P port - TCP
    log_info "Forwarding EL P2P port $EL_P2P_PORT → $EL_P2P_PORT (internal → external) TCP..."
    local temp_file=$(mktemp)
    if upnpc -a $(hostname -I | awk '{print $1}') "$EL_P2P_PORT" "$EL_P2P_PORT" TCP "$lease_time" >"$temp_file" 2>&1; then
        log_result "✓ UPnP: EL P2P port $EL_P2P_PORT TCP forwarded"
        if [[ "${DEBUG:-}" == "1" ]]; then
            cat "$temp_file"
        fi
    else
        log_warn "✗ UPnP: Failed to forward EL P2P port $EL_P2P_PORT TCP"
        if [[ "${DEBUG:-}" == "1" ]]; then
            cat "$temp_file" >&2
        fi
        success=false
    fi
    rm -f "$temp_file"
    
    # EL P2P port - UDP
    log_info "Forwarding EL P2P port $EL_P2P_PORT → $EL_P2P_PORT (internal → external) UDP..."
    local temp_file=$(mktemp)
    if upnpc -a $(hostname -I | awk '{print $1}') "$EL_P2P_PORT" "$EL_P2P_PORT" UDP "$lease_time" >"$temp_file" 2>&1; then
        log_result "✓ UPnP: EL P2P port $EL_P2P_PORT UDP forwarded"
        if [[ "${DEBUG:-}" == "1" ]]; then
            cat "$temp_file"
        fi
    else
        log_warn "✗ UPnP: Failed to forward EL P2P port $EL_P2P_PORT UDP"
        if [[ "${DEBUG:-}" == "1" ]]; then
            cat "$temp_file" >&2
        fi
        success=false
    fi
    rm -f "$temp_file"
    
    if [[ "$success" == "true" ]]; then
        log_result "✓ UPnP port forwarding configured"
        log_info "  Lease time: ${lease_time}s ($(($lease_time / 3600))h)"
    else
        log_warn "⚠️  UPnP port forwarding partially failed - check router UPnP settings"
    fi
}

# Parse command line arguments
INSTALLATION_NAME=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --installation)
            INSTALLATION_NAME="$2"
            shift 2
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

# Validate required arguments
if [[ -z "$INSTALLATION_NAME" ]]; then
    log_error "Installation name required"
    exit 1
fi

# Validate installation exists
if ! bb_validate_installation "$INSTALLATION_NAME"; then
    exit 1
fi

log_info "Installing systemd services for installation: $INSTALLATION_NAME"

# Delegate to systemd-manage.sh for actual service installation
log_operation "Installing systemd services for $INSTALLATION_NAME..."

if "${SCRIPT_DIR}/systemd-manage.sh" install "$INSTALLATION_NAME"; then
            log_result "✓ Systemd services installed for $INSTALLATION_NAME"
    
    # Setup UPnP port forwarding if enabled
    setup_upnp_forwarding "$INSTALLATION_NAME"
    
    log_result "✓ Installation complete. Next steps: start → status → logs"
else
    log_error "Failed to install systemd services for $INSTALLATION_NAME"
    exit 1
fi
