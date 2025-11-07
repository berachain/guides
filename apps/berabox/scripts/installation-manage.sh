#!/bin/bash

# Berabox Installation Management Script
# Handles installation creation, listing, removal, and reset operations

set -e

# Source common functions and configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BERABOX_ROOT="$(dirname "$SCRIPT_DIR")"
source "$SCRIPT_DIR/common.sh"

# Installation creation command
create_installation() {
    local chain="${1:-}"
    local el_client="${2:-}"
    local name="${3:-}"
    
    # Only shift the arguments we actually have
    local shift_count=0
    [[ -n "$chain" ]] && shift_count=$((shift_count + 1))
    [[ -n "$el_client" ]] && shift_count=$((shift_count + 1))
    [[ -n "$name" ]] && shift_count=$((shift_count + 1))
    shift $shift_count || true
    
    local port_base=""
    
    # Parse additional arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --port-base)
                port_base="$2"
                shift 2
                ;;
            *)
                log_error "Unknown option for create: $1"
                show_usage
                return 1
                ;;
        esac
    done
    
    # Validation
    if [[ -z "$chain" || -z "$el_client" ]]; then
        log_error "Chain and EL client required"
        echo "Usage: $0 create <chain> <el-client> [name] [--port-base <port>]"
        return 1
    fi
    
    if [[ "$chain" != "mainnet" && "$chain" != "testnet" ]]; then
        log_error "Invalid chain: $chain (must be 'mainnet' or 'testnet')"
        return 1
    fi
    
    if [[ "$el_client" != "reth" && "$el_client" != "geth" ]]; then
        log_error "Invalid EL client: $el_client (must be 'reth' or 'geth')"
        return 1
    fi
    
    # Build install command
    local install_args=(--chain "$chain" --el-client "$el_client")
    [[ -n "$name" ]] && install_args+=(--name "$name")
    [[ -n "$port_base" ]] && install_args+=(--port-base "$port_base")
    
    log_info "Creating new installation with $chain + $el_client"
    
    if "${SCRIPT_DIR}/create.sh" "${install_args[@]}"; then
        log_info "Installation created"
        log_info "Next steps: build → init → install → start"
    else
        log_error "Failed to create installation"
        return 1
    fi
}

# Installation listing command
list_installations() {
    log_step "Listing all BeraBox installations..."
    echo ""
    
    if [[ ! -d "$BB_CONFIG_INSTALLATIONS_DIR" ]]; then
        log_warn "No installations directory found"
        echo "Create an installation with: $0 create <chain> <el-client>"
        return
    fi
    
    printf "%-25s %-12s %-12s %-25s %-15s\n" "NAME" "CHAIN" "EL CLIENT" "STATUS" "OWNERSHIP"
    printf "%-25s %-12s %-12s %-25s %-15s\n" "----" "-----" "---------" "------" "----------"
    
    local found_any=false
    for installation_dir in "$BB_CONFIG_INSTALLATIONS_DIR"/*; do
        if [[ -d "$installation_dir" && -f "$installation_dir/installation.toml" ]]; then
            local name=$(basename "$installation_dir")
            local chain=$(bb_parse_toml_value "$installation_dir/installation.toml" "chain" || echo "Unknown")
            local el_client=$(bb_parse_toml_value "$installation_dir/installation.toml" "el_client" || echo "Unknown")
            
            # Check service status
            local status=$(bb_get_installation_status "$name")
            local status_color=""
            case "$status" in
                "Running")
                    status_color="${GREEN}Running${NC}"
                    ;;
                "Partial")
                    status_color="${YELLOW}Partial${NC}"
                    ;;
                "Stopped")
                    status_color="${CYAN}Stopped${NC}"
                    ;;
                "Not Installed")
                    status_color="${RED}Not Installed${NC}"
                    ;;
                *)
                    status_color="$status"
                    ;;
            esac
            
            # Check ownership
            local owner=$(bb_get_installation_owner "$name")
            local current_user=$(whoami)
            local ownership_status=""
            local ownership_color=""
            
            if [[ "$owner" == "$current_user" ]]; then
                ownership_status="Owned"
                ownership_color="${GREEN}Owned${NC}"
            else
                ownership_status="Other User"
                ownership_color="${YELLOW}Other User${NC}"
            fi
            
            printf "%-25s %-12s %-12s %-25s %-15s\n" "$name" "$chain" "$el_client" "$(echo -e "$status_color")" "$(echo -e "$ownership_color")"
            found_any=true
        fi
    done
    
    if [[ "$found_any" == "false" ]]; then
        echo ""
        log_warn "No installations found"
        echo "Create one with: $0 create <chain> <el-client>"
    fi
}

# Installation removal command
remove_installation() {
    local installation="$1"
    local force_mode="${2:-}"
    
    if ! bb_validate_installation "$installation"; then
        return 1
    fi
    
    if [[ "$force_mode" != "--force" ]]; then
        log_warn "⚠️  Removing installation '$installation'"
    fi
    
    local installation_dir=$(bb_get_installation_dir "$installation")
    
    # Stop and uninstall systemd services first
    log_step "Resetting installation before removal..."
    if "${SCRIPT_DIR}/systemd-manage.sh" list 2>/dev/null | grep -q "$installation"; then
        "${SCRIPT_DIR}/systemd-manage.sh" uninstall "$installation" || true
    fi
    
    # Remove the entire installation directory
    log_warn "Removing installation directory: $installation_dir"
    rm -rf "$installation_dir"
    
    log_info "✓ Installation '$installation' removed"
}

# Installation reset command
reset_installation() {
    local installation="$1"
    local force_mode="${2:-}"
    
    if ! bb_validate_installation "$installation"; then
        return 1
    fi
    
    if [[ "$force_mode" != "--force" ]]; then
        log_warn "⚠️  Resetting installation '$installation' services and data"
    fi
    
    local installation_dir=$(bb_get_installation_dir "$installation")
    
    # Stop and uninstall systemd services
    if "${SCRIPT_DIR}/systemd-manage.sh" list 2>/dev/null | grep -q "$installation"; then
        log_step "Removing systemd services..."
        "${SCRIPT_DIR}/systemd-manage.sh" uninstall "$installation" || true
    fi
    
    # Clean data directories
    log_step "Wiping data directories..."
    rm -rf "$installation_dir/data/cl" || true
    rm -rf "$installation_dir/data/el/chain" || true
    rm -rf "$installation_dir/data/seed-data"* || true
    rm -rf "$installation_dir/logs"/* || true
    rm -rf "$installation_dir/runtime"/* || true
    
            log_info "✓ Installation '$installation' reset"
}

# Installation info command
show_installation_info() {
    local installation="$1"
    
    if ! bb_validate_installation "$installation"; then
        return 1
    fi
    
    log_info "Installation Information: $installation"
    echo ""
    
    local installation_dir=$(bb_get_installation_dir "$installation")
    local config_file=$(bb_get_installation_toml "$installation")
    
    # Load configuration
    declare -A config_ref
    config_ref[chain]=$(bb_parse_toml_value "$config_file" "chain" || echo "Unknown")
    config_ref[el_client]=$(bb_parse_toml_value "$config_file" "el_client" || echo "Unknown")
    config_ref[created]=$(bb_parse_toml_value "$config_file" "created" || echo "Unknown")
    config_ref[beacon_kit_version]=$(bb_parse_toml_value "$config_file" "beacon_kit" || echo "Unknown")
    config_ref[base_port]=$(bb_parse_toml_value "$config_file" "base_port" || echo "Unknown")
    
    # Get EL version based on client type
    if [[ "${config_ref[el_client]}" == "reth" ]]; then
        config_ref[el_version]=$(bb_parse_toml_value "$config_file" "bera_reth" || echo "Unknown")
    elif [[ "${config_ref[el_client]}" == "geth" ]]; then
        config_ref[el_version]=$(bb_parse_toml_value "$config_file" "bera_geth" || echo "Unknown")
    else
        config_ref[el_version]="Unknown"
    fi
    
    # Display information
    printf "%-20s %s\n" "Chain:" "${config_ref[chain]}"
    printf "%-20s %s\n" "EL Client:" "${config_ref[el_client]}"
    printf "%-20s %s\n" "Created:" "${config_ref[created]}"
    printf "%-20s %s\n" "Base Port:" "${config_ref[base_port]}"
    printf "%-20s %s\n" "Beacon Kit:" "${config_ref[beacon_kit_version]}"
    printf "%-20s %s\n" "EL Version:" "${config_ref[el_version]}"
    echo ""
    
    # Service status
    local cl_status=$(bb_get_service_status "$installation" "cl")
    local el_status=$(bb_get_service_status "$installation" "el")
    
    # Format service status with colors
    local cl_status_formatted="$cl_status"
    local el_status_formatted="$el_status"
    
    if [[ "$cl_status" == Running* ]]; then
        cl_status_formatted="${GREEN}$cl_status${NC}"
    elif [[ "$cl_status" == "Stopped" ]]; then
        cl_status_formatted="${YELLOW}$cl_status${NC}"
    elif [[ "$cl_status" == "Not Installed" ]]; then
        cl_status_formatted="${RED}$cl_status${NC}"
    fi
    
    if [[ "$el_status" == Running* ]]; then
        el_status_formatted="${GREEN}$el_status${NC}"
    elif [[ "$el_status" == "Stopped" ]]; then
        el_status_formatted="${YELLOW}$el_status${NC}"
    elif [[ "$el_status" == "Not Installed" ]]; then
        el_status_formatted="${RED}$el_status${NC}"
    fi
    
    printf "%-20s %b\n" "CL Service:" "$cl_status_formatted"
    printf "%-20s %b\n" "EL Service:" "$el_status_formatted"
    echo ""
    
    # Directory information
    printf "%-20s %s\n" "Installation Dir:" "$installation_dir"
    printf "%-20s %s\n" "Data Dir:" "$installation_dir/data"
    printf "%-20s %s\n" "Logs Dir:" "$installation_dir/logs"
    echo ""
    
    # Port information
    local base_port="${config_ref[base_port]}"
    local external_ip=$(bb_get_external_ip || echo "127.0.0.1")
    echo "Port Information:"
    echo "Consensus Layer:"
    printf "%-20s %s\n" "  CL RPC:" "http://$external_ip:$((base_port + 0)) (external)"
    printf "%-20s %s\n" "  CL P2P:" "$((base_port + 1)) (external)"
    printf "%-20s %s\n" "  CL Prometheus:" "http://127.0.0.1:$((base_port + 3))"
    printf "%-20s %s\n" "  CL PProf:" "http://127.0.0.1:$((base_port + 4))"
    printf "%-20s %s\n" "  CL Node API:" "http://$external_ip:$((base_port + 5)) (external)"
    echo "Execution Layer:"
    printf "%-20s %s\n" "  EL RPC:" "http://$external_ip:$((base_port + 10)) (external)"
    printf "%-20s %s\n" "  EL WS:" "ws://$external_ip:$((base_port + 15)) (external)"
    printf "%-20s %s\n" "  EL Auth RPC:" "http://127.0.0.1:$((base_port + 11))"
    printf "%-20s %s\n" "  EL P2P:" "$((base_port + 12)) (external)"
    printf "%-20s %s\n" "  EL Prometheus:" "http://127.0.0.1:$((base_port + 13))"
    echo ""
    
    # Validator keys (if CL is initialized)
    if bb_check_cl_initialized "$installation"; then
        echo "Validator Keys:"
        local validator_keys=$(bb_get_validator_keys "$installation")
        if [[ $? -eq 0 && -n "$validator_keys" ]]; then
            local comet_address=$(echo "$validator_keys" | grep "^comet_address=" | cut -d= -f2)
            local comet_pubkey=$(echo "$validator_keys" | grep "^comet_pubkey=" | cut -d= -f2)
            local eth_beacon_pubkey=$(echo "$validator_keys" | grep "^eth_beacon_pubkey=" | cut -d= -f2)
            
            printf "%-20s %s\n" "  Comet Address:" "$comet_address"
            printf "%-20s %s\n" "  Comet Pubkey:" "$comet_pubkey"
            printf "%-20s %s\n" "  Eth/Beacon Pubkey:" "$eth_beacon_pubkey"
        else
            echo "  (Unable to retrieve validator keys)"
        fi
    else
        echo "Validator Keys:"
        echo "  (CL not initialized - run 'init' first)"
    fi
    echo ""
    
    # Enode (if EL is running)
    if [[ "$el_status" == Running* ]]; then
        echo "Execution Layer Enode:"
        local enode=$(bb_get_el_enode "$installation")
        if [[ $? -eq 0 && -n "$enode" ]]; then
            printf "%-20s %s\n" "  Enode:" "$enode"
        else
            echo "  (Unable to retrieve enode - EL may not be fully started)"
        fi
    else
        echo "Execution Layer Enode:"
        echo "  (EL not running - start the service first)"
    fi
}

# Global operations
list_all_installations() {
    list_installations
}

reset_all_installations() {
    bb_iterate_all_installations_with_errors "reset" "reset_installation" "$@"
}

remove_all_installations() {
    bb_iterate_all_installations_with_errors "remove" "remove_installation" "$@"
}

show_usage() {
    echo "Berabox Installation Management"
    echo ""
    echo "Usage: $0 <action> [options]"
    echo ""
    echo "Actions:"
    echo "  create <chain> <el-client> [name] [--port-base <port>]  Create new installation"
    echo "  list                                                      List all installations"
    echo "  info <installation>                                       Show installation details"
    echo "  reset <installation> [--force]                           Reset installation data"
    echo "  remove <installation> [--force]                          Remove installation completely"
    echo "  reset-all [--force]                                       Reset all installations"
    echo "  remove-all [--force]                                      Remove all installations"
    echo ""
    echo "Examples:"
    echo "  $0 create testnet reth my-testnet"
    echo "  $0 create mainnet geth --port-base 30000"
    echo "  $0 list"
    echo "  $0 info bb-mainnet-reth"
    echo "  $0 reset bb-testnet-geth --force"
    echo ""
    echo "Chains: mainnet, testnet"
    echo "EL Clients: reth, geth"
}

# Main script logic
main() {
    if [[ $# -eq 0 ]]; then
        show_usage
        exit 1
    fi
    
    local action="$1"
    shift
    
    case "$action" in
        "create")
            create_installation "$@"
            ;;
        "list")
            list_all_installations
            ;;
        "info")
            if [[ $# -eq 0 ]]; then
                log_error "Installation name required"
                show_usage
                exit 1
            fi
            show_installation_info "$1"
            ;;
        "reset")
            if [[ $# -eq 0 ]]; then
                log_error "Installation name required"
                show_usage
                exit 1
            fi
            reset_installation "$@"
            ;;
        "remove")
            if [[ $# -eq 0 ]]; then
                log_error "Installation name required"
                show_usage
                exit 1
            fi
            remove_installation "$@"
            ;;
        "reset-all")
            reset_all_installations "$@"
            ;;
        "remove-all")
            remove_all_installations "$@"
            ;;
        "help"|"--help"|"-h")
            show_usage
            ;;
        *)
            log_error "Unknown action: $action"
            show_usage
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
