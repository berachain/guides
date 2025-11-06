#!/usr/bin/env bash
set -euo pipefail

# Delegate funds to a DelegationHandler and grant validator admin role
# Run with --help for usage information

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib-common.sh"

CLI_HANDLER=""
CLI_PUBKEY=""
CLI_CHAIN=""
CLI_AMOUNT=""
CLI_VALIDATOR_ADMIN=""

print_usage() {
  cat <<'USAGE'
delegator-delegate.sh

Delegates funds to a DelegationHandler and grants the validator admin role.
This is step 2 for delegators providing capital to validators.

This script generates THREE commands that must be executed in order:
1. Send BERA to the handler contract
2. Call delegate() to mark the funds as delegated
3. Grant VALIDATOR_ADMIN_ROLE to the validator operator

Usage:
  delegator-delegate.sh --pubkey 0x... --chain bepolia|mainnet --amount 250000 --validator-admin 0x...
  
Required arguments:
  --pubkey 0x...            Validator pubkey (handler will be auto-detected from factory)
  --chain bepolia|mainnet   Chain to use (required)
  --amount BERA             Amount of BERA to delegate (e.g., 250000)
  --validator-admin 0x...   Address to grant VALIDATOR_ADMIN_ROLE
  
Output:
  delegator-delegate-1-send-funds.sh
  delegator-delegate-2-delegate.sh
  delegator-delegate-3-grant-role.sh

Execute them in order after reviewing each command.
USAGE
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      --pubkey) CLI_PUBKEY="$2"; shift 2 ;;
      --chain) CLI_CHAIN="$2"; shift 2 ;;
      --amount) CLI_AMOUNT="$2"; shift 2 ;;
      --validator-admin) CLI_VALIDATOR_ADMIN="$2"; shift 2 ;;
      -h|--help) print_usage; exit 0 ;;
      *) log_error "Unknown arg: $1"; print_usage; exit 1 ;;
    esac
  done
}

check_handler_state() {
  local handler="$1"
  local rpc="$2"
  
  log_info "Checking current delegation state..."
  
  # Check current delegated amount
  local delegated_amount
  delegated_amount=$(cast_call_clean "$handler" "delegatedAmount()(uint256)" -r "$rpc" 2>/dev/null || echo "0")
  
  if [[ "$delegated_amount" != "0" ]]; then
    local delegated_eth
    delegated_eth=$(cast from-wei "$delegated_amount" 2>/dev/null || echo "$delegated_amount wei")
    log_error "Funds already delegated: $delegated_eth BERA"
    log_error "Only one delegation per handler is allowed"
    log_error "You must undelegate first before delegating again"
    exit 1
  fi
  
  log_success "Handler is ready for delegation"
}

main() {
  parse_args "$@"
  
  if ! ensure_cast; then
    exit 1
  fi
  if ! ensure_bc; then
    exit 1
  fi
  load_env "$SCRIPT_DIR"
  
  # Validate required arguments
  if [[ -z "$CLI_PUBKEY" ]]; then
    log_error "Missing --pubkey"
    print_usage
    exit 1
  fi
  
  if [[ -z "$CLI_CHAIN" ]]; then
    log_error "Missing --chain (required for delegator scripts)"
    print_usage
    exit 2
  fi
  
  # Validate chain
  if [[ "$CLI_CHAIN" != "bepolia" && "$CLI_CHAIN" != "mainnet" ]]; then
    log_error "Invalid chain: $CLI_CHAIN (must be 'bepolia' or 'mainnet')"
    exit 1
  fi
  
  # Get network and RPC from chain (no automatic detection for delegator scripts)
  local network="$CLI_CHAIN"
  local rpc_url
  rpc_url=$(get_rpc_url_for_network "$network")
  if [[ -z "$rpc_url" ]]; then
    log_error "Unknown chain: $network"
    exit 1
  fi
  
  # Auto-detect handler from pubkey
  local factory
  factory=$(get_delegation_handler_factory_for_network "$network")
  if [[ -z "$factory" || "$factory" == "0x0000000000000000000000000000000000000000" ]]; then
    log_error "DelegationHandlerFactory not available for network: $network"
    exit 1
  fi
  
  local HANDLER
  HANDLER=$(get_delegation_handler "$factory" "$CLI_PUBKEY" "$rpc_url")
  
  if [[ "$HANDLER" == "0x0000000000000000000000000000000000000000" ]]; then
    log_error "No delegation handler found for pubkey: $CLI_PUBKEY"
    log_error "Run delegator-deploy-handler.sh first"
    exit 1
  fi
  
  log_info "DelegationHandler: $HANDLER"
  
  # Validate required arguments
  if [[ -z "$CLI_AMOUNT" ]]; then
    log_error "Missing --amount"
    print_usage
    exit 2
  fi
  
  if [[ ! "$CLI_AMOUNT" =~ ^[0-9]+$ ]]; then
    log_error "--amount must be a positive integer (BERA)"
    exit 2
  fi
  
  local VALIDATOR_ADMIN
  VALIDATOR_ADMIN=$(normalize_evm_address "$CLI_VALIDATOR_ADMIN")
  if [[ -z "$VALIDATOR_ADMIN" ]]; then
    log_error "--validator-admin must be a valid EVM address"
    exit 3
  fi
  
  # Check if amount is multiple of gwei (required by contract)
  local amount_wei
  amount_wei=$(cast to-wei "$CLI_AMOUNT" 2>/dev/null)
  
  if ! validate_gwei_multiple "$amount_wei"; then
    log_warn "Amount must be a multiple of 1 gwei"
    log_warn "Rounding down to nearest gwei..."
    amount_wei=$(round_down_to_gwei "$amount_wei")
    CLI_AMOUNT=$(cast from-wei "$amount_wei")
  fi
  
  log_info "DelegationHandler: $HANDLER"
  log_info "Amount to delegate: $CLI_AMOUNT BERA"
  log_info "Validator admin: $VALIDATOR_ADMIN"
  log_info "RPC URL: $rpc_url"
  echo ""
  
  # Check handler state
  check_handler_state "$HANDLER" "$rpc_url"
  echo ""
  
  # Generate commands
  log_info "Generating delegation commands..."
  
  # Get wallet arguments (--ledger or --private-key)
  local wallet_args
  wallet_args=$(get_cast_wallet_args)
  
  # Command 1: Send funds
  cat > "delegator-delegate-1-send-funds.sh" <<EOF
#!/usr/bin/env bash
# Step 1: Send BERA to DelegationHandler
# Handler: $HANDLER
# Amount: $CLI_AMOUNT BERA
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

cast send $HANDLER \\
  --value ${CLI_AMOUNT}ether \\
  -r $rpc_url $wallet_args
EOF
  chmod +x "delegator-delegate-1-send-funds.sh"
  
  # Command 2: Delegate
  cat > "delegator-delegate-2-delegate.sh" <<EOF
#!/usr/bin/env bash
# Step 2: Mark funds as delegated
# Handler: $HANDLER
# Amount: $amount_wei wei
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

cast send $HANDLER \\
  'delegate(uint256)' \\
  "$amount_wei" \\
  -r $rpc_url $wallet_args
EOF
  chmod +x "delegator-delegate-2-delegate.sh"
  
  # Command 3: Grant role
  local role_hash
  role_hash=$(cast keccak "VALIDATOR_ADMIN_ROLE()")
  
  cat > "delegator-delegate-3-grant-role.sh" <<EOF
#!/usr/bin/env bash
# Step 3: Grant VALIDATOR_ADMIN_ROLE
# Handler: $HANDLER
# Validator admin: $VALIDATOR_ADMIN
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

cast send $HANDLER \\
  'grantRole(bytes32,address)' \\
  "$role_hash" \\
  "$VALIDATOR_ADMIN" \\
  -r $rpc_url $wallet_args
EOF
  chmod +x "delegator-delegate-3-grant-role.sh"
  
  log_success "Commands generated successfully"
  echo ""
  log_info "Next steps:"
  echo "  1. Review and execute: ./delegator-delegate-1-send-funds.sh"
  echo "  2. Review and execute: ./delegator-delegate-2-delegate.sh"
  echo "  3. Review and execute: ./delegator-delegate-3-grant-role.sh"
  echo ""
  echo "After completion, the validator operator can create their staking pool:"
  echo "  delegated-create-pool.sh --pubkey ${CLI_PUBKEY:-<pubkey>}"
}

main "$@"





