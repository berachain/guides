#!/bin/bash
set -euo pipefail
# Berabox Argument Builder
# This script generates the command-line arguments for the CL and EL services.

# Source common functions for external IP detection
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

# Return the absolute path to the EL binary for a given client
get_el_binary_path() {
    local el_client="$1"
    local installation_dir="$2"

    case "$el_client" in
        "reth")
            # Check for release binary first, then debug
            if [[ -f "$installation_dir/src/bera-reth/reth" ]]; then
                echo "$installation_dir/src/bera-reth/reth"
            elif [[ -f "$installation_dir/src/bera-reth/reth-debug" ]]; then
                echo "$installation_dir/src/bera-reth/reth-debug"
            else
                echo "$installation_dir/src/bera-reth/target/debug/bera-reth"
            fi
            ;;
        "geth")
            # Check for release binary first, then debug
            if [[ -f "$installation_dir/src/bera-geth/geth" ]]; then
                echo "$installation_dir/src/bera-geth/geth"
            else
                echo "$installation_dir/src/bera-geth/geth-debug"
            fi
            ;;
        *)
            echo "";
            return 1
            ;;
    esac
}

# Return the absolute path to the CL binary
get_cl_binary_path() {
    local installation_dir="$1"
    # Check for release binary first, then debug
    if [[ -f "$installation_dir/src/beacon-kit/beacond" ]]; then
        echo "$installation_dir/src/beacon-kit/beacond"
    else
        echo "$installation_dir/src/beacon-kit/beacond-debug"
    fi
}

# Build EL arguments - core function with optional binary path inclusion
_build_el_args_core() {
    local el_client="$1"
    local installation_dir="$2"
    local el_rpc_port="$3"
    local el_ws_port="$4"
    local el_authrpc_port="$5"
    local el_p2p_port="$6"
    local el_prometheus_port="$7"
    local installation_name="$8"
    local archive_mode="${9:-false}"  # Optional 9th parameter for archive mode
    local el_debugger_port="${10:-0}"  # Optional 10th parameter for debugger port
    local include_binary_path="${11:-true}"  # Whether to include binary path in output

    # Get external IP for NAT configuration
    local external_ip=$(bb_get_external_ip)
    local ip_option=""
    if [[ -n "$external_ip" ]]; then
        ip_option="--nat extip:$external_ip"
    fi

    # Build bootnodes option if bootnode file exists
    local bootnodes_option=""
    local bootnodes_file="$installation_dir/data/cl/config/el-bootnodes.txt"
    if [[ -f "$bootnodes_file" ]]; then
        # Extract enode URLs from bootnode file (skip comments and empty lines)
        local bootnodes=$(grep '^enode://' "$bootnodes_file" | tr '\n' ',' | sed 's/,$//')
        if [[ -n "$bootnodes" ]]; then
            bootnodes_option="--bootnodes $bootnodes"
        fi
    fi

    case "$el_client" in
        "reth")
            # For reth: archive mode removes --full flag, standard mode adds --full
            local archive_option=""
            if [[ "$archive_mode" != "true" ]]; then
                archive_option="--full"
            fi
            local args="node -vvv --datadir $installation_dir/data/el/chain --chain $installation_dir/data/el/config/genesis.json $archive_option $bootnodes_option --authrpc.addr 127.0.0.1 --authrpc.port $el_authrpc_port --authrpc.jwtsecret $installation_dir/data/cl/config/jwt.hex --port $el_p2p_port --rpc.max-logs-per-response 1000000 --metrics $el_prometheus_port --http --http.addr 0.0.0.0 --http.port $el_rpc_port --ws --ws.addr 0.0.0.0 --ws.port $el_ws_port --ipcpath $installation_dir/runtime/admin.ipc --discovery.port $el_p2p_port --http.corsdomain '*' --log.file.max-files 0 $ip_option --max-inbound-peers 300"
            if [[ "$include_binary_path" == "true" ]]; then
                echo "$(get_el_binary_path reth "$installation_dir") $args"
            else
                echo "$args"
            fi
            ;;
        "geth")
            # For geth: archive mode adds history parameters
            local archive_option=""
            if [[ "$archive_mode" == "true" ]]; then
                archive_option="--history.logs 0 --history.state 0 --history.transactions 0"
            fi
            local args="--verbosity 3 --datadir $installation_dir/data/el/chain --syncmode full --state.scheme path --ipcpath $installation_dir/runtime/admin.ipc --rpc.batch-response-max-size 100000000 --miner.gasprice 1 $archive_option $bootnodes_option --metrics --metrics.addr 127.0.0.1 --metrics.port $el_prometheus_port --http --http.addr 0.0.0.0 --http.port $el_rpc_port --ws --ws.addr 0.0.0.0 --ws.port $el_ws_port --port $el_p2p_port --discovery.port $el_p2p_port --authrpc.addr 127.0.0.1 --authrpc.port $el_authrpc_port --authrpc.jwtsecret $installation_dir/data/cl/config/jwt.hex --authrpc.vhosts localhost $ip_option"
            if [[ "$include_binary_path" == "true" ]]; then
                echo "$(get_el_binary_path geth "$installation_dir") $args"
            else
                echo "$args"
            fi
            ;;
    esac
}

# Build EL arguments only (for systemd service files)
build_el_args_only() {
    _build_el_args_core "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8" "${9:-false}" "${10:-0}" "false"
}

# Build full EL command with binary path (for VS Code launch configs)
build_el_args() {
    _build_el_args_core "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8" "${9:-false}" "${10:-0}" "true"
}
