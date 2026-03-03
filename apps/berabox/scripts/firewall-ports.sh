#!/bin/bash
# Ensure firewall allows berabox external ports (same as "bb <installation> info" (external)).
# Opens: CL RPC, CL P2P (tcp+udp), CL Node API, EL RPC, EL P2P (tcp+udp), EL WS.
# Reports how many port/protocol rules were added (ports were closed).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BERABOX_ROOT="$(dirname "$SCRIPT_DIR")"

source "$SCRIPT_DIR/common.sh"
source "$SCRIPT_DIR/port-utils.sh"

# Returns 0 if ufw allows the given port/proto, 1 otherwise.
ufw_allows() {
    local port="$1"
    local proto="$2"
    local status
    status=$(sudo ufw status 2>/dev/null) || return 1
    echo "$status" | grep -qE "^[[:space:]]*${port}/${proto}[[:space:]]" && return 0
    return 1
}

# Add ufw allow for port/proto. Returns 0 on success.
ufw_allow() {
    local port="$1"
    local proto="$2"
    sudo ufw allow "${port}/${proto}" >/dev/null 2>&1
}

setup_firewall_external_ports() {
    local installation_name="$1"
    local installations_dir="${BB_CONFIG_INSTALLATIONS_DIR:-$BERABOX_ROOT/installations}"
    local toml="$installations_dir/$installation_name/installation.toml"

    if [[ ! -f "$toml" ]]; then
        log_error "Installation '$installation_name' not found: $toml"
        return 1
    fi

    if ! command -v ufw >/dev/null 2>&1; then
        log_warn "ufw not found; ensure the following external ports are open in your firewall:"
        load_ports "$installation_name" || return 1
        echo "  CL RPC: $CL_RPC_PORT/tcp, CL P2P: $CL_P2P_PORT/tcp+udp, CL Node API: $NODE_API_PORT/tcp"
        echo "  EL RPC: $EL_RPC_PORT/tcp, EL P2P: $EL_P2P_PORT/tcp+udp, EL WS: $EL_WS_PORT/tcp"
        return 0
    fi

    local status_out
    if ! status_out=$(sudo ufw status 2>/dev/null); then
        log_warn "Cannot read firewall status (sudo required). To open external ports run:"
        load_ports "$installation_name" || return 1
        echo "  sudo ufw allow $CL_RPC_PORT/tcp && sudo ufw allow $CL_P2P_PORT/tcp && sudo ufw allow $CL_P2P_PORT/udp"
        echo "  sudo ufw allow $NODE_API_PORT/tcp && sudo ufw allow $EL_RPC_PORT/tcp"
        echo "  sudo ufw allow $EL_P2P_PORT/tcp && sudo ufw allow $EL_P2P_PORT/udp && sudo ufw allow $EL_WS_PORT/tcp"
        return 0
    fi

    load_ports "$installation_name" || return 1

    # External port/proto pairs (same as bb <installation> info)
    # Format: "port:proto" — P2P gets both tcp and udp.
    local rules_added=0

    add_if_closed() {
        local port="$1"
        local proto="$2"
        if ! ufw_allows "$port" "$proto"; then
            if ufw_allow "$port" "$proto"; then
                log_info "Firewall: allowed ${port}/${proto}"
                ((rules_added++)) || true
            else
                log_warn "Firewall: failed to allow ${port}/${proto}"
            fi
        fi
    }

    log_operation "Ensuring firewall allows external ports for $installation_name..."

    add_if_closed "$CL_RPC_PORT" "tcp"
    add_if_closed "$CL_P2P_PORT" "tcp"
    add_if_closed "$CL_P2P_PORT" "udp"
    add_if_closed "$NODE_API_PORT" "tcp"
    add_if_closed "$EL_RPC_PORT" "tcp"
    add_if_closed "$EL_P2P_PORT" "tcp"
    add_if_closed "$EL_P2P_PORT" "udp"
    add_if_closed "$EL_WS_PORT" "tcp"

    if [[ $rules_added -gt 0 ]]; then
        log_result "$rules_added firewall rule(s) added (ports were closed)."
    else
        log_info "All external ports already allowed."
    fi
    return 0
}

# Allow script to be called with installation name as first arg
if [[ "${1:-}" == "--installation" ]]; then
    shift
    INSTALLATION_NAME="${1:-}"
elif [[ $# -gt 0 && "${1:-}" != "-h" && "${1:-}" != "--help" ]]; then
    INSTALLATION_NAME="$1"
else
    INSTALLATION_NAME=""
fi

if [[ -z "$INSTALLATION_NAME" ]]; then
    echo "Usage: $0 --installation <name>   or   $0 <installation_name>" >&2
    exit 1
fi

setup_firewall_external_ports "$INSTALLATION_NAME"
