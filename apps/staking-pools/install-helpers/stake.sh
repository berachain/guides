#!/usr/bin/env bash
set -euo pipefail

# Staking helper - generates commands to stake BERA to your pool
# Run with --help for usage information

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib-common.sh"

# Load configuration if available
load_env "$SCRIPT_DIR"

CLI_AMOUNT=""
CLI_RECEIVER=""
CLI_STAKING_POOL="${STAKING_POOL:-}"

print_usage() {
  cat <<'USAGE'
stake.sh

Generates a cast command to stake BERA to a staking pool.

Usage:
  # External users staking to any pool:
  stake.sh --amount 100 --receiver 0x... --staking-pool 0x...
  
  # Validator operators (with BEACOND_HOME in env.sh):
  stake.sh --amount 100 --receiver 0x...
  
Required arguments:
  --amount BERA             Amount of BERA to stake (e.g., 100)
  --receiver 0x...          Address to receive stBERA tokens

Pool identification:
  --staking-pool 0x...      StakingPool address (required if BEACOND_HOME not configured)

Configuration (via env.sh):
  BEACOND_HOME              For auto-detecting pool from validator pubkey (optional)
  STAKING_POOL              Alternative to --staking-pool (optional)

Output:
  generated/stake-command.sh
USAGE
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      --amount) CLI_AMOUNT="$2"; shift 2 ;;
      --receiver) CLI_RECEIVER="$2"; shift 2 ;;
      --staking-pool) CLI_STAKING_POOL="$2"; shift 2 ;;
      -h|--help) print_usage; exit 0 ;;
      *) log_error "Unknown arg: $1"; print_usage; exit 1 ;;
    esac
  done
}

get_staking_pool_address() {
  local factory_addr="$1"; local rpc_url="$2"; local pubkey="$3"
  if ! have_cmd cast; then log_error "cast not found; install foundry (https://book.getfoundry.sh/)"; return 1; fi
  
  local out
  out=$(cast call "$factory_addr" "getCoreContracts(bytes)(address,address,address,address)" "$pubkey" -r "$rpc_url" 2>&1) || return 1
  
  # Parse the tuple response - second address is the staking pool
  out=$(echo "$out" | tr -d '()' | tr ',' ' ' | tr '\n' ' ' | tr -s ' ' ' ')
  local smart_operator staking_pool staking_rewards_vault incentive_collector
  read -r smart_operator staking_pool staking_rewards_vault incentive_collector <<< "$out"
  
  if [[ -z "$staking_pool" || "$staking_pool" == "0x0000000000000000000000000000000000000000" ]]; then
    return 1
  fi
  
  printf '%s' "$staking_pool"
  return 0
}

main() {
  parse_args "$@"
  
  if [[ -z "$CLI_AMOUNT" ]]; then log_error "Missing --amount (amount of BERA to stake)"; exit 1; fi
  if [[ -z "$CLI_RECEIVER" ]]; then log_error "Missing --receiver (address to receive stBERA tokens)"; exit 1; fi

  if ! have_cmd cast; then log_error "cast not found; install foundry (https://book.getfoundry.sh/)"; exit 1; fi

  # Validate amount
  if ! validate_amount "$CLI_AMOUNT" "amount"; then
    exit 1
  fi

  # Validate receiver address
  local RECEIVER
  RECEIVER=$(normalize_evm_address "$CLI_RECEIVER")
  if [[ -z "$RECEIVER" ]]; then
    log_error "--receiver must be a valid EVM address"
    exit 1
  fi

  local STAKING_POOL=""
  local NETWORK=""
  
  # Check if staking pool provided directly
  if [[ -n "$CLI_STAKING_POOL" ]]; then
    STAKING_POOL=$(normalize_evm_address "$CLI_STAKING_POOL")
    if [[ -z "$STAKING_POOL" ]]; then
      log_error "--staking-pool must be a valid EVM address"
      exit 8
    fi
    log_info "Using provided staking pool: $STAKING_POOL"
  else
    # Need to auto-detect from beacond (via env.sh)
    local BEACOND_HOME="${BEACOND_HOME:-}"
    if [[ -z "$BEACOND_HOME" ]]; then
      log_error "Missing --staking-pool or BEACOND_HOME in env.sh"
      log_error "Provide either the staking pool address or configure BEACOND_HOME in env.sh"
      exit 1
    fi
    if [[ ! -d "$BEACOND_HOME" ]]; then log_error "beacond_home not found: $BEACOND_HOME"; exit 1; fi

    local beacond_bin
    beacond_bin=$(resolve_beacond_bin)
    if [[ -z "$beacond_bin" ]]; then log_error "beacond binary not found"; exit 1; fi

    if ! ensure_jq; then
      exit 1
    fi

    NETWORK=$(get_network_from_genesis "$beacond_bin" "$BEACOND_HOME")
    local PUBKEY
    PUBKEY=$(get_validator_pubkey "$beacond_bin" "$BEACOND_HOME")
    if [[ -z "$PUBKEY" ]]; then
      exit 1
    fi

    log_info "Network: $NETWORK"
    log_info "Validator pubkey: $PUBKEY"
    echo ""

    # Resolve RPC URL
    local RPC_URL
    RPC_URL=$(get_rpc_url_for_network "$NETWORK")
    if [[ -z "$RPC_URL" ]]; then
      log_error "Unknown network: $NETWORK"
      exit 1
    fi

    # Resolve factory address
    local FACTORY_ADDR
    FACTORY_ADDR=$(get_factory_address_for_network "$NETWORK")
    if [[ -z "$FACTORY_ADDR" ]]; then
      log_error "Factory address not available for network: $NETWORK"
      exit 1
    fi

    # Get staking pool address
    if ! STAKING_POOL=$(get_staking_pool_address "$FACTORY_ADDR" "$RPC_URL" "$PUBKEY"); then
      log_error "Failed to get staking pool address"
      log_error "Ensure your staking pool has been deployed"
      exit 1
    fi
  fi
  
  # Resolve RPC URL if not already set (for staking-pool-only mode)
  if [[ -z "${RPC_URL:-}" ]]; then
    # Get network from RPC (we don't have beacond in this mode, so use mainnet default)
    RPC_URL="https://rpc.berachain.com"
  fi

  log_info "Staking pool / stBERA token: $STAKING_POOL"
  log_info "Amount to stake: ${CLI_AMOUNT} BERA"
  log_info "Receiver of stBERA: $RECEIVER"
  echo ""

  # Generate stake command
  mkdir -p generated
  local cmd_file="generated/stake-command.sh"
  local wallet_args
  wallet_args=$(get_cast_wallet_args)
  
  cat > "$cmd_file" <<EOF
#!/usr/bin/env bash
# Stake command for staking pool
# Staking pool: $STAKING_POOL
# Amount: ${CLI_AMOUNT} BERA
# Receiver: $RECEIVER
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

cast send $STAKING_POOL \\
  'submit(address)' \\
  $RECEIVER \\
  --value ${CLI_AMOUNT}ether \\
  -r $RPC_URL $wallet_args
EOF
  
  chmod +x "$cmd_file"
  
  log_success "Stake command written to: $cmd_file"
  log_info "Next step: Run ./$cmd_file"
  echo ""
  log_info "After staking, check your stBERA balance:"
  echo "  cast call $STAKING_POOL 'balanceOf(address)(uint256)' $RECEIVER -r $RPC_URL | xargs cast from-wei"
}

main "$@"

