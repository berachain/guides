#!/bin/bash
# Berabox Systemd Management Script
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BERABOX_ROOT="$(dirname "$SCRIPT_DIR")"

# Source utilities and common functions
source "$SCRIPT_DIR/port-utils.sh"
source "$SCRIPT_DIR/common.sh"

# Helper functions to reduce duplication
ensure_systemd_environment() {
    # Check if both XDG variables are properly set
    if [[ -n "${XDG_RUNTIME_DIR:-}" ]] && [[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
        # Environment is already good
        return 0
    fi
    
    log_info "Systemd environment variables missing, attempting auto-fix..."
    
    # Try loading from user profile files
    local profile_files=("$HOME/.bashrc" "$HOME/.profile" "$HOME/.bash_profile")
    local env_loaded=false
    
    for profile_file in "${profile_files[@]}"; do
        if [[ -f "$profile_file" ]] && ! $env_loaded; then
            log_step "Loading environment from $profile_file"
            # Use source in a subshell to avoid affecting current environment unintentionally
            if (source "$profile_file" && [[ -n "${XDG_RUNTIME_DIR:-}" ]] && [[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]]); then
                # If successful, source it for real
                source "$profile_file"
                env_loaded=true
                log_info "✓ Environment loaded from $profile_file"
                break
            fi
        fi
    done
    
    # If still missing after loading profiles, add to profile and reload
    if [[ -z "${XDG_RUNTIME_DIR:-}" ]] || [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
        log_step "Adding systemd environment variables to user profile"
        
        # Choose primary profile file (prefer .bashrc if it exists)
        local target_profile="$HOME/.bashrc"
        if [[ ! -f "$target_profile" ]]; then
            target_profile="$HOME/.profile"
        fi
        
        # Check if already added (avoid duplicates)
        if ! grep -q "XDG_RUNTIME_DIR.*id -u" "$target_profile" 2>/dev/null; then
            {
                echo ""
                echo "# SystemD user service environment (added by berabox)"
                echo 'export XDG_RUNTIME_DIR="/run/user/$(id -u)"'
                echo 'export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"'
            } >> "$target_profile"
            log_info "✓ Added environment variables to $target_profile"
        fi
        
        # Load the updated profile
        source "$target_profile"
        log_info "✓ Reloaded profile with new environment"
    fi
    
    # Final check and manual fallback
    if [[ -z "${XDG_RUNTIME_DIR:-}" ]]; then
        export XDG_RUNTIME_DIR="/run/user/$(id -u)"
        log_info "✓ Set XDG_RUNTIME_DIR manually: $XDG_RUNTIME_DIR"
    fi
    
    if [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
        export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"
        log_info "✓ Set DBUS_SESSION_BUS_ADDRESS manually: $DBUS_SESSION_BUS_ADDRESS"
    fi
}

ensure_runtime_dir() {
    # First ensure environment variables are set
    ensure_systemd_environment
    
    # Ensure the runtime directory exists
    if [[ ! -d "$XDG_RUNTIME_DIR" ]]; then
        log_error "Runtime directory $XDG_RUNTIME_DIR doesn't exist"
        log_error "This usually means you need to log in properly or enable user lingering"
        log_error "Try: sudo loginctl enable-linger $(whoami)"
        return 1
    fi
}

# Check if systemd user manager is available
check_systemd_user() {
    if ! systemctl --user status >/dev/null 2>&1; then
        log_error "Systemd user manager is not available"
        log_error "Try: sudo loginctl enable-linger \$(whoami)"
        return 1
    fi
}

# Simple systemctl wrapper - try once then fail
systemctl_user_retry() {
    "$@"
}

systemd_reload() {
    ensure_runtime_dir
    check_systemd_user
    systemctl_user_retry systemctl --user daemon-reload
}

get_cl_service_name() {
    local installation_name="$1"
    echo "$installation_name-cl"
}

get_el_service_name() {
    local installation_name="$1"
    echo "$installation_name-el"
}

validate_installation_name() {
    local installation_name="$1"
    local command_name="$2"
    if [[ -z "$installation_name" ]]; then
        log_error "Installation name required for $command_name command"
        usage
        return 1
    fi
    
    # Use the common function for additional validation
    bb_validate_installation "$installation_name"
}

# Load installation configuration
load_installation_config() {
    local installation_name="$1"
    
    # Set installation directory
    INSTALLATION_DIR="$BERABOX_ROOT/installations/$installation_name"
    
    if [[ ! -d "$INSTALLATION_DIR" ]]; then
        log_error "Installation '$installation_name' not found at $INSTALLATION_DIR"
        return 1
    fi
    
    # Load installation.toml to get chain and EL client info
    local installation_toml="$INSTALLATION_DIR/installation.toml"
    if [[ ! -f "$installation_toml" ]]; then
        log_error "Installation configuration not found: $installation_toml"
        return 1
    fi
    
    # Parse installation.toml
    CHAIN=$(bb_parse_toml_value "$installation_toml" "chain" || echo "")
    EL_CLIENT=$(bb_parse_toml_value "$installation_toml" "el_client" || echo "")
    
    # Load path configuration from TOML
    BIN_DIR=""
    CL_LOGS_DIR=$(bb_get_installation_path "$installation_toml" "cl_logs_dir")
    EL_LOGS_DIR=$(bb_get_installation_path "$installation_toml" "el_logs_dir")
    CL_DATA_DIR=$(bb_get_installation_path "$installation_toml" "cl_data_dir")
    
    # Debug: show what paths were loaded
    log_debug "Loaded paths: CL_LOGS_DIR='$CL_LOGS_DIR', EL_LOGS_DIR='$EL_LOGS_DIR', CL_DATA_DIR='$CL_DATA_DIR'"
    
    # Load port configuration for EL args generation
    load_ports "$installation_name"

    # User systemd services automatically run as the current user
}

# Generate systemd service files
generate_service_files() {
    local installation_name="$1"
    load_installation_config "$installation_name"
    
    local service_dir="$INSTALLATION_DIR/systemd"
    
    log_step "Generating CL service file at $service_dir/$installation_name-cl.service..."
    # Use a simpler approach: copy template and do substitutions one by one
    cp "$BERABOX_ROOT/templates/systemd/cl.service.template" "$service_dir/$installation_name-cl.service"
    sed -i "s@{INSTALLATION_NAME}@$installation_name@g" "$service_dir/$installation_name-cl.service" || log_error "Failed to substitute INSTALLATION_NAME"
    sed -i "s@{INSTALLATION_DIR}@$INSTALLATION_DIR@g" "$service_dir/$installation_name-cl.service" || log_error "Failed to substitute INSTALLATION_DIR"
    # Resolve CL binary absolute path
    source "$SCRIPT_DIR/arg-builder.sh"
    CL_BIN_PATH=$(get_cl_binary_path "$INSTALLATION_DIR")
    sed -i "s@{CL_BIN}@$CL_BIN_PATH@g" "$service_dir/$installation_name-cl.service" || log_error "Failed to substitute CL_BIN"
    sed -i "s@{CL_LOGS_DIR}@$CL_LOGS_DIR@g" "$service_dir/$installation_name-cl.service" || log_error "Failed to substitute CL_LOGS_DIR"
    sed -i "s@{CL_DATA_DIR}@$CL_DATA_DIR@g" "$service_dir/$installation_name-cl.service" || log_error "Failed to substitute CL_DATA_DIR"
    sed -i "s@{NODE_API_PORT}@$NODE_API_PORT@g" "$service_dir/$installation_name-cl.service" || log_error "Failed to substitute NODE_API_PORT"
    
    log_step "Generating EL service file at $service_dir/$installation_name-el.service..."
    source "$SCRIPT_DIR/arg-builder.sh"
    
    # Read archive mode from installation.toml
    local archive_mode=$(bb_parse_toml_value "$INSTALLATION_DIR/installation.toml" "archive_mode" || echo "false")
    
    # Generate EL service arguments (without binary path for systemd)
    EL_ARGS=$(build_el_args_only "$EL_CLIENT" "$INSTALLATION_DIR" "$EL_RPC_PORT" "$EL_WS_PORT" "$EL_AUTHRPC_PORT" "$EL_P2P_PORT" "$EL_PROMETHEUS_PORT" "$installation_name" "$archive_mode")
    
    # Use a simpler approach: copy template and do substitutions one by one
    cp "$BERABOX_ROOT/templates/systemd/el.service.template" "$service_dir/$installation_name-el.service"
    sed -i "s@{INSTALLATION_NAME}@$installation_name@g" "$service_dir/$installation_name-el.service" || log_error "Failed to substitute INSTALLATION_NAME"
    sed -i "s@{INSTALLATION_DIR}@$INSTALLATION_DIR@g" "$service_dir/$installation_name-el.service" || log_error "Failed to substitute INSTALLATION_DIR"
    # Resolve EL binary absolute path (repo target for reth)
    EL_BIN_PATH=$(get_el_binary_path "$EL_CLIENT" "$INSTALLATION_DIR")
    sed -i "s@{EL_BIN}@$EL_BIN_PATH@g" "$service_dir/$installation_name-el.service" || log_error "Failed to substitute EL_BIN"
    sed -i "s@{EL_CLIENT}@$EL_CLIENT@g" "$service_dir/$installation_name-el.service" || log_error "Failed to substitute EL_CLIENT"
    sed -i "s@{EL_LOGS_DIR}@$EL_LOGS_DIR@g" "$service_dir/$installation_name-el.service" || log_error "Failed to substitute EL_LOGS_DIR"
    sed -i "s#{EL_ARGS}#$EL_ARGS#g" "$service_dir/$installation_name-el.service" || log_error "Failed to substitute EL_ARGS"
}

# Install user systemd services (no sudo required)
install_services() {
    local installation_name="$1"
    
    log_info "Installing user systemd services for $installation_name"

    # Create user systemd directory
    local user_systemd_dir="$HOME/.config/systemd/user"
    bb_ensure_directory "$user_systemd_dir"

    # Always reload daemon before operations
    systemd_reload
    
    log_step "Generating service files..."
    generate_service_files "$installation_name"
    
    log_step "Configuring trusted peers..."
    # Create trusted-nodes.json for geth from el_persistent_peers in installation.toml
    load_installation_config "$installation_name"
    if [[ "$EL_CLIENT" == "geth" ]]; then
        el_datadir="$INSTALLATION_DIR/data/el/chain"
        trusted_nodes_file="$el_datadir/trusted-nodes.json"
        
        # Read el_persistent_peers array from installation.toml
        trusted_peers=$(bb_parse_toml_array "$INSTALLATION_DIR/installation.toml" "el_persistent_peers" 2>/dev/null || true)
        
        if [[ -n "$trusted_peers" ]]; then
            log_info "Creating trusted-nodes.json for geth..."
            
            # Ensure datadir exists
            mkdir -p "$el_datadir"
            
            # Build JSON array
            echo "[" > "$trusted_nodes_file"
            first=true
            while IFS= read -r peer; do
                if [[ -n "$peer" ]]; then
                    if [[ "$first" == "true" ]]; then
                        echo "  \"$peer\"" >> "$trusted_nodes_file"
                        first=false
                    else
                        echo "  ,\"$peer\"" >> "$trusted_nodes_file"
                    fi
                fi
            done <<< "$trusted_peers"
            echo "]" >> "$trusted_nodes_file"
            
            log_info "✓ Created trusted-nodes.json with $(echo "$trusted_peers" | grep -c '^enode://') peer(s)"
        else
            log_info "No persistent peers configured in installation.toml"
        fi
    else
        log_info "Trusted peers for reth configured via --trusted-peers flag"
    fi
    
    log_step "Creating runtime directories..."
    # Ensure runtime directories exist before service installation
    # IPC socket will be created at runtime/admin.ipc
    local installation_toml="$INSTALLATION_DIR/installation.toml"
    local cl_logs_dir=$(bb_get_installation_path "$installation_toml" "cl_logs_dir")
    local el_logs_dir=$(bb_get_installation_path "$installation_toml" "el_logs_dir")
    bb_ensure_directory "$cl_logs_dir"
    bb_ensure_directory "$el_logs_dir"
    
    local cl_service=$(get_cl_service_name "$installation_name")
    local el_service=$(get_el_service_name "$installation_name")
    
    cp "$INSTALLATION_DIR/systemd/$cl_service.service" "$user_systemd_dir/"
    cp "$INSTALLATION_DIR/systemd/$el_service.service" "$user_systemd_dir/"
    ensure_runtime_dir
    systemctl --user daemon-reload
    systemctl --user enable "$cl_service.service"
    systemctl --user enable "$el_service.service"
    
    log_result "✓ User services installed: $cl_service, $el_service"
    log_info "  Use 'systemctl --user status $cl_service' to check status"
}

# Uninstall systemd services
# UPnP port forwarding cleanup
cleanup_upnp_forwarding() {
    local installation_name="$1"
    local installation_dir="${BB_CONFIG_INSTALLATIONS_DIR:-$BERABOX_ROOT/installations}/$installation_name"
    local installation_toml="$installation_dir/installation.toml"
    
    # Check if UPnP was enabled
    local upnp_enabled=$(bb_parse_toml_value "$installation_toml" "enabled" || echo "false")
    if [[ "$upnp_enabled" != "true" ]]; then
        log_info "UPnP was disabled - skipping port forwarding cleanup"
        return 0
    fi
    
    # Check if upnpc is available
    if ! command -v upnpc >/dev/null 2>&1; then
        log_warn "UPnP was enabled but 'upnpc' not found - cannot clean up port forwarding"
        return 0
    fi
    
    log_step "Cleaning up UPnP port forwarding..."
    
    # Load port configuration
    load_ports "$installation_name"
    
    # Remove P2P port forwarding rules
    local success=true
    
    # Remove CL P2P port - TCP
    log_info "Removing CL P2P port $CL_P2P_PORT → $CL_P2P_PORT TCP forwarding..."
    local temp_file=$(mktemp)
    if upnpc -d "$CL_P2P_PORT" TCP >"$temp_file" 2>&1; then
        log_info "✓ CL P2P port $CL_P2P_PORT → $CL_P2P_PORT TCP forwarding removed"
        if [[ "${BB_DEBUG:-false}" == "true" ]]; then
            cat "$temp_file"
        fi
    else
        log_warn "✗ Failed to remove CL P2P port $CL_P2P_PORT → $CL_P2P_PORT TCP forwarding (may not exist)"
        if [[ "${BB_DEBUG:-false}" == "true" ]]; then
            cat "$temp_file" >&2
        fi
    fi
    rm -f "$temp_file"
    
    # Remove CL P2P port - UDP
    log_info "Removing CL P2P port $CL_P2P_PORT → $CL_P2P_PORT UDP forwarding..."
    local temp_file=$(mktemp)
    if upnpc -d "$CL_P2P_PORT" UDP >"$temp_file" 2>&1; then
        log_info "✓ CL P2P port $CL_P2P_PORT → $CL_P2P_PORT UDP forwarding removed"
        if [[ "${BB_DEBUG:-false}" == "true" ]]; then
            cat "$temp_file"
        fi
    else
        log_warn "✗ Failed to remove CL P2P port $CL_P2P_PORT → $CL_P2P_PORT UDP forwarding (may not exist)"
        if [[ "${BB_DEBUG:-false}" == "true" ]]; then
            cat "$temp_file" >&2
        fi
    fi
    rm -f "$temp_file"
    
    # Remove EL P2P port - TCP
    log_info "Removing EL P2P port $EL_P2P_PORT → $EL_P2P_PORT TCP forwarding..."
    local temp_file=$(mktemp)
    if upnpc -d "$EL_P2P_PORT" TCP >"$temp_file" 2>&1; then
        log_info "✓ EL P2P port $EL_P2P_PORT → $EL_P2P_PORT TCP forwarding removed"
        if [[ "${BB_DEBUG:-false}" == "true" ]]; then
            cat "$temp_file"
        fi
    else
        log_warn "✗ Failed to remove EL P2P port $EL_P2P_PORT → $EL_P2P_PORT TCP forwarding (may not exist)"
        if [[ "${BB_DEBUG:-false}" == "true" ]]; then
            cat "$temp_file" >&2
        fi
    fi
    rm -f "$temp_file"
    
    # Remove EL P2P port - UDP
    log_info "Removing EL P2P port $EL_P2P_PORT → $EL_P2P_PORT UDP forwarding..."
    local temp_file=$(mktemp)
    if upnpc -d "$EL_P2P_PORT" UDP >"$temp_file" 2>&1; then
        log_info "✓ EL P2P port $EL_P2P_PORT → $EL_P2P_PORT UDP forwarding removed"
        if [[ "${BB_DEBUG:-false}" == "true" ]]; then
            cat "$temp_file"
        fi
    else
        log_warn "✗ Failed to remove EL P2P port $EL_P2P_PORT → $EL_P2P_PORT UDP forwarding (may not exist)"
        if [[ "${BB_DEBUG:-false}" == "true" ]]; then
            cat "$temp_file" >&2
        fi
    fi
    rm -f "$temp_file"
    
    log_info "✓ UPnP port forwarding cleanup completed"
}

uninstall_services() {
    local installation_name="$1"
    local user_systemd_dir="$HOME/.config/systemd/user"
    
    # Always reload daemon before operations
    systemd_reload
    
    log_info "Uninstalling user systemd services for: $installation_name"
    
    local cl_service=$(get_cl_service_name "$installation_name")
    local el_service=$(get_el_service_name "$installation_name")
    
    log_step "Stopping services..."
    ensure_runtime_dir
    systemctl --user stop "$cl_service" 2>/dev/null || true
    systemctl --user stop "$el_service" 2>/dev/null || true
    
    log_step "Disabling services..."
    systemctl --user disable "$cl_service" 2>/dev/null || true
    systemctl --user disable "$el_service" 2>/dev/null || true
    
    log_step "Removing service files..."
    rm -f "$user_systemd_dir/$cl_service.service"
    rm -f "$user_systemd_dir/$el_service.service"
    
    log_step "Reloading systemd daemon..."
    systemctl --user daemon-reload
    
    # Clean up UPnP port forwarding if it was enabled
    cleanup_upnp_forwarding "$installation_name"
    
    log_info "✓ User systemd services uninstalled for $installation_name"
}

# Service control functions
start_services() {
    local installation_name="${1-}"
    local component="${2-}"

    # Always reload daemon before operations
    systemd_reload
    
    local cl_service=$(get_cl_service_name "$installation_name")
    local el_service=$(get_el_service_name "$installation_name")
    
    case "$component" in
        "cl")
            systemctl --user start "$cl_service"
            ;;
        "el")
            systemctl --user start "$el_service"
            ;;
        ""|"both")
            systemctl --user start "$el_service"
            sleep 2  # Give EL a moment to start
            systemctl --user start "$cl_service"
            ;;
        *)
            log_error "Invalid component: $component. Use 'cl', 'el', or leave empty for both"
            return 1
            ;;
    esac
}

stop_services() {
    local installation_name="${1-}"
    local component="${2-}"

    # Always reload daemon before operations
    systemctl --user daemon-reload 2>/dev/null || true
    
    case "$component" in
        "cl")
            systemctl --user stop "$installation_name-cl"
            ;;
        "el")
            systemctl --user stop "$installation_name-el"
            ;;
        ""|"both")
            systemctl --user stop "$installation_name-cl"
            systemctl --user stop "$installation_name-el"
            ;;
        *)
            log_error "Invalid component: $component. Use 'cl', 'el', or leave empty for both"
            return 1
            ;;
    esac
}

restart_services() {
    local installation_name="${1-}"
    local component="${2-}"

    # Always reload daemon before operations
    systemctl --user daemon-reload 2>/dev/null || true
    
    case "$component" in
        "cl")
            systemctl --user restart "$installation_name-cl"
            ;;
        "el")
            systemctl --user restart "$installation_name-el"
            ;;
        ""|"both")
            systemctl --user restart "$installation_name-el"
            sleep 2
            systemctl --user restart "$installation_name-cl"
            ;;
        *)
            log_error "Invalid component: $component. Use 'cl', 'el', or leave empty for both"
            return 1
            ;;
    esac
}

status_services() {
    local installation_name="${1-}"
    local component="${2-}"

    # Always reload daemon before operations
    systemctl --user daemon-reload 2>/dev/null || true
    
    case "$component" in
        "cl")
            systemctl --user --no-pager status "$installation_name-cl"
            ;;
        "el")
            systemctl --user --no-pager status "$installation_name-el"
            ;;
        ""|"both")
            echo "=== EL Service Status ==="
            systemctl --user --no-pager status "$installation_name-el"
            echo ""
            echo "=== CL Service Status ==="
            systemctl --user --no-pager status "$installation_name-cl"
            ;;
        *)
            log_error "Invalid component: $component. Use 'cl', 'el', or leave empty for both"
            return 1
            ;;
    esac
}

logs_services() {
    local installation_name="${1-}"
    local component="${2-}"
    local installation_dir="$BERABOX_ROOT/installations/$installation_name"
    local installation_toml="$installation_dir/installation.toml"
    local cl_logs_dir=$(bb_get_installation_path "$installation_toml" "cl_logs_dir")
    local el_logs_dir=$(bb_get_installation_path "$installation_toml" "el_logs_dir")

    # Ensure log directories exist before searching for log files
    bb_ensure_directory "$cl_logs_dir"
    bb_ensure_directory "$el_logs_dir"

    # Always reload daemon before operations
    systemctl --user daemon-reload 2>/dev/null || true
    
    case "$component" in
        "cl")
            # Find most recent CL log file
            local cl_log=$(find "$cl_logs_dir" -name "*.log" -type f 2>/dev/null | sort | tail -1)
            if [[ -f "$cl_log" ]]; then
                log_info "Following CL log file: $cl_log"
                multitail -cT ansi -t "CL" "$cl_log"
            else
                log_info "No CL log files found"
                log_info "Use: $0 status $installation_name cl"
            fi
            ;;
        "el")
            # Find most recent EL log file
            local el_log=$(find "$el_logs_dir" -name "*.log" -type f 2>/dev/null | sort | tail -1)
            if [[ -f "$el_log" ]]; then
                log_info "Following EL log file: $el_log"
                multitail -cT ansi -t "EL" "$el_log"
            else
                log_info "No EL log files found"
                log_info "Use: $0 status $installation_name el"
            fi
            ;;
        ""|"both")
            # Find most recent log files from both components
            local cl_log=$(find "$cl_logs_dir" -name "*.log" -type f 2>/dev/null | sort | tail -1)
            local el_log=$(find "$el_logs_dir" -name "*.log" -type f 2>/dev/null | sort | tail -1)
            
            if [[ -f "$cl_log" ]] && [[ -f "$el_log" ]]; then
                log_info "Following both CL and EL logs with multitail"
                log_info "CL: $cl_log"
                log_info "EL: $el_log"
                multitail -cT ansi -t "CL" "$cl_log" -cT ansi -t "EL" "$el_log"
            elif [[ -f "$cl_log" ]]; then
                log_info "Only CL log found, following: $cl_log"
                tail -n 2000 -f "$cl_log"
            elif [[ -f "$el_log" ]]; then
                log_info "Only EL log found, following: $el_log"
                tail -n 2000 -f "$el_log"
            else
                log_info "No log files found for $installation_name"
                log_info "Available log directories:"
                if [[ -d "$cl_logs_dir" ]]; then
                    log_info "  CL: $cl_logs_dir"
                fi
                if [[ -d "$el_logs_dir" ]]; then
                    log_info "  EL: $el_logs_dir"
                fi
                log_info ""
                log_info "Use separate commands to monitor services:"
                log_info "  CL: $0 logs $installation_name cl"
                log_info "  EL: $0 logs $installation_name el"
            fi
            ;;
        *)
            log_error "Invalid component: $component. Use 'cl', 'el', or leave empty for both"
            return 1
            ;;
    esac
}

list_services() {
    # Always reload daemon before operations
    systemctl --user daemon-reload 2>/dev/null || true
    log_info "Berabox user systemd services:"
    systemctl --user list-units "*" --all
}

# Autostart management
autostart_services() {
    local installation_name="${1-}"
    local action="${2-}"
    
    case "$action" in
        "enable")
            # Check if user lingering is enabled
            local linger_status=$(loginctl show-user "$(whoami)" 2>/dev/null | grep "Linger=" | cut -d= -f2 || echo "no")
            
            if [[ "$linger_status" != "yes" ]]; then
                log_info "Enabling user lingering for automatic service start on boot..."
                if sudo loginctl enable-linger "$(whoami)"; then
                    log_info "✓ User lingering enabled for $(whoami)"
                else
                    log_error "Failed to enable user lingering (requires sudo)"
                    return 1
                fi
            else
                log_info "User lingering already enabled for $(whoami)"
            fi
            
            # Enable the systemd services
            log_step "Enabling systemd services for $installation_name..."
            if systemctl --user enable "$installation_name-cl.service" 2>/dev/null && systemctl --user enable "$installation_name-el.service" 2>/dev/null; then
                log_info "✓ Auto-start enabled for $installation_name"
                log_info "Services will start automatically on system boot"
            else
                log_error "Failed to enable services. Run '$0 install $installation_name' first."
                return 1
            fi
            ;;
        "disable")
            log_step "Disabling auto-start for $installation_name..."
            systemctl --user disable "$installation_name-cl.service" 2>/dev/null || true
            systemctl --user disable "$installation_name-el.service" 2>/dev/null || true
            
            log_info "✓ Auto-start disabled for $installation_name"
            log_info "Note: User lingering remains enabled (affects all user services)"
            ;;
        *)
            log_error "Unknown autostart action: $action. Use 'enable' or 'disable'"
            return 1
            ;;
    esac
}

# Main script logic
if [[ $# -lt 1 ]]; then
    usage
fi

COMMAND="${1-}"
INSTALLATION_NAME="${2-}"
COMPONENT="${3-}"

case "$COMMAND" in
    "install")
        validate_installation_name "$INSTALLATION_NAME" "install"
        install_services "$INSTALLATION_NAME"
        ;;
    "uninstall")
        validate_installation_name "$INSTALLATION_NAME" "uninstall"
        uninstall_services "$INSTALLATION_NAME"
        ;;
    "start")
        validate_installation_name "$INSTALLATION_NAME" "start"
        start_services "$INSTALLATION_NAME" "$COMPONENT"
        ;;
    "stop")
        validate_installation_name "$INSTALLATION_NAME" "stop"
        stop_services "$INSTALLATION_NAME" "$COMPONENT"
        ;;
    "restart")
        validate_installation_name "$INSTALLATION_NAME" "restart"
        restart_services "$INSTALLATION_NAME" "$COMPONENT"
        ;;
    "status")
        validate_installation_name "$INSTALLATION_NAME" "status"
        status_services "$INSTALLATION_NAME" "$COMPONENT"
        ;;
    "logs")
        validate_installation_name "$INSTALLATION_NAME" "logs"
        logs_services "$INSTALLATION_NAME" "$COMPONENT"
        ;;
    "list")
        list_services
        ;;
    "autostart")
        # For autostart, arguments are: autostart <enable|disable> <installation>
        # The generic argument assignment sets INSTALLATION_NAME to the action and
        # COMPONENT to the actual installation name. Validate and dispatch accordingly.
        ACTION="$INSTALLATION_NAME"
        INST_NAME="$COMPONENT"
        validate_installation_name "$INST_NAME" "autostart"
        autostart_services "$INST_NAME" "$ACTION"
        ;;
    *)
        log_error "Unknown command: $COMMAND"
        usage
        ;;
esac
