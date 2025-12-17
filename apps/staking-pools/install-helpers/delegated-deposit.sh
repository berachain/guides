#!/usr/bin/env bash
set -euo pipefail

# Deposit additional delegated funds to staking pool (validator operator with VALIDATOR_ADMIN_ROLE)
# Run with --help for usage information

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib-common.sh"

CLI_HANDLER=""
CLI_PUBKEY=""
CLI_AMOUNT=""

print_usage() {
  cat <<'USAGE'
delegated-deposit.sh

Deposits additional delegated funds from the DelegationHandler to the staking pool.
This is for validator operators using delegated funds to reach the 250,000 BERA minimum.

The staking pool must be activated before deposits can be made. Run activate.sh first if the pool is paused.

Usage:
  delegated-deposit.sh --amount 240000
  
Required arguments:
  --amount BERA             Amount of BERA to deposit (e.g., 240000)

Output:
  generated/delegated-deposit-command.sh

The amount must be a multiple of 1 gwei and cannot exceed the available delegated amount.
USAGE
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      --amount) CLI_AMOUNT="$2"; shift 2 ;;
      -h|--help) print_usage; exit 0 ;;
      *) log_error "Unknown arg: $1"; print_usage; exit 1 ;;
    esac
  done
}

check_available_funds() {
  local handler="$1"
  local amount_wei="$2"
  local rpc="$3"
  
  log_info "Checking available delegated funds..."
  
  # Get delegated amount available
  local available_amount pending_amount
  available_amount=$(cast_call_clean "$handler" "delegatedAmountAvailable()(uint256)" -r "$rpc" 2>/dev/null || echo "0")
  
  if [[ "$available_amount" == "0" ]]; then
    log_error "No delegated funds available"
    log_error "All delegated funds may have been used"
    exit 1
  fi
  
  # Get pending withdrawal amount
  pending_amount=$(cast_call_clean "$handler" "delegatedFundsPendingWithdrawal()(uint256)" -r "$rpc" 2>/dev/null || echo "0")
  
  # Calculate truly available amount (available - pending) using bc for large numbers
  local truly_available
  truly_available=$(echo "$available_amount - $pending_amount" | bc)
  
  if [[ $(echo "$truly_available <= 0" | bc) -eq 1 ]]; then
    log_error "No funds available for deposit"
    local available_eth pending_eth
    available_eth=$(cast from-wei "$available_amount" 2>/dev/null || echo "$available_amount wei")
    pending_eth=$(cast from-wei "$pending_amount" 2>/dev/null || echo "$pending_amount wei")
    log_error "Available: $available_eth BERA"
    log_error "Pending withdrawal: $pending_eth BERA"
    exit 1
  fi
  
  if [[ $(echo "$amount_wei > $truly_available" | bc) -eq 1 ]]; then
    log_error "Insufficient funds available"
    local requested_eth available_eth pending_eth
    requested_eth=$(cast from-wei "$amount_wei" 2>/dev/null || echo "$amount_wei wei")
    available_eth=$(cast from-wei "$truly_available" 2>/dev/null || echo "$truly_available wei")
    pending_eth=$(cast from-wei "$pending_amount" 2>/dev/null || echo "$pending_amount wei")
    log_error "Requested: $requested_eth BERA"
    log_error "Available: $available_eth BERA"
    log_error "Pending withdrawal: $pending_eth BERA"
    exit 1
  fi
  
  local available_eth
  available_eth=$(cast from-wei "$truly_available" 2>/dev/null || echo "$truly_available wei")
  log_success "Sufficient funds available: $available_eth BERA"
}

main() {
  parse_args "$@"
  
  if [[ -z "$CLI_AMOUNT" ]]; then
    log_error "Missing --amount"
    print_usage
    exit 2
  fi
  
  if [[ ! "$CLI_AMOUNT" =~ ^[0-9]+$ ]]; then
    log_error "--amount must be a positive integer (BERA)"
    exit 2
  fi
  
  if ! ensure_cast; then
    exit 1
  fi
  if ! ensure_bc; then
    exit 1
  fi
  load_env "$SCRIPT_DIR"
  
  # Require BEACOND_HOME
  if [[ -z "$BEACOND_HOME" ]]; then
    log_error "BEACOND_HOME must be set in env.sh"
    exit 1
  fi
  if [[ ! -d "$BEACOND_HOME" ]]; then
    log_error "beacond_home not found: $BEACOND_HOME"
    exit 1
  fi
  
  # Resolve beacond binary
  local beacond_bin
  beacond_bin=$(resolve_beacond_bin)
  if [[ -z "$beacond_bin" ]]; then
    log_error "beacond binary not found"
    exit 1
  fi
  
  # Get validator pubkey from beacond
  local pubkey
  pubkey=$(get_validator_pubkey "$beacond_bin" "$BEACOND_HOME")
  if [[ -z "$pubkey" ]]; then
    log_error "Failed to get validator pubkey from beacond"
    exit 1
  fi
  log_info "Validator pubkey: $pubkey"
  
  # Detect network and RPC
  local network rpc_url
  read -r network rpc_url <<< "$(detect_network_and_rpc)"
  
  # Auto-detect handler from pubkey
  local factory
  factory=$(get_delegation_handler_factory_for_network "$network")
  if [[ -z "$factory" || "$factory" == "0x0000000000000000000000000000000000000000" ]]; then
    log_error "DelegationHandlerFactory not available for network: $network"
    exit 1
  fi
  
  local handler
  handler=$(get_delegation_handler "$factory" "$pubkey" "$rpc_url")
  
  if [[ "$handler" == "0x0000000000000000000000000000000000000000" ]]; then
    log_error "No delegation handler found for pubkey: $pubkey"
    log_error "The delegator must deploy a handler first using: delegator-deploy-handler.sh"
    exit 1
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
  
  log_info "DelegationHandler: $handler"
  log_info "Amount to deposit: $CLI_AMOUNT BERA"
  log_info "RPC URL: $rpc_url"
  echo ""
  
  # Check available funds
  check_available_funds "$handler" "$amount_wei" "$rpc_url"
  
  # Check if staking pool exists and is activated
  local staking_pool
  staking_pool=$(cast_call_clean "$handler" "stakingPool()(address)" -r "$rpc_url" 2>/dev/null || echo "0x0000000000000000000000000000000000000000")
  
  if [[ "$staking_pool" == "0x0000000000000000000000000000000000000000" ]]; then
    log_error "No staking pool found for this handler"
    log_error "Create the pool first using: delegated-create-pool.sh"
    exit 1
  fi
  
  local is_paused
  is_paused=$(cast_call_clean "$staking_pool" "paused()(bool)" -r "$rpc_url" 2>/dev/null || echo "true")
  
  if [[ "$is_paused" == "true" ]]; then
    log_error "Staking pool is paused and must be activated before deposits"
    log_error "Activate the pool first using: activate.sh --sr <shares_recipient> --op <operator_address>"
    exit 1
  fi
  
  echo ""
  
  # Generate deposit command
  mkdir -p generated
  local cmd_file="generated/delegated-deposit-command.sh"
  local wallet_args
  wallet_args=$(get_cast_wallet_args)
  
  cat > "$cmd_file" <<EOF
#!/usr/bin/env bash
# Deposit delegated funds to staking pool
# Handler: $handler
# Amount: $CLI_AMOUNT BERA ($amount_wei wei)
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

cast send $handler \\
  'depositDelegatedFunds(uint256)' \\
  "$amount_wei" \\
  -r $rpc_url $wallet_args

echo ""
echo "Deposit complete"
echo "Check status with: status.sh --pubkey ${CLI_PUBKEY:-<pubkey>}"
EOF
  
  chmod +x "$cmd_file"
  
  log_success "Deposit command written to: $cmd_file"
  log_info "Next steps:"
  echo "  1. Review the command: cat $cmd_file"
  echo "  2. Execute: ./$cmd_file"
}

main "$@"
