#!/usr/bin/env bash
set -euo pipefail

# Request yield withdrawal (validator operator with VALIDATOR_ADMIN_ROLE)
# Run with --help for usage information

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib-common.sh"

CLI_HANDLER=""
CLI_PUBKEY=""
CLI_FEE="0.001"

print_usage() {
  cat <<'USAGE'
delegated-withdraw-yield.sh

Requests withdrawal of earned staking rewards (yield) only.
This is for validator operators to claim their portion of staking rewards.

The yield is calculated as: total stBERA shares - locked shares (representing principal).
This withdrawal does NOT affect the delegated principal amount.

This generates TWO commands:
1. Request yield withdrawal (includes withdrawal fee)
2. Complete withdrawal after cooldown period (~3 days / 129,600 blocks)

Usage:
  delegated-withdraw-yield.sh [--fee 0.001]
  
Configuration (via env.sh):
  BEACOND_HOME              Path to beacond home (for auto-detecting pubkey and handler)
  
Optional arguments:
  --fee BERA                Withdrawal request fee (default: 0.001 BERA)

Output:
  delegated-withdraw-yield-1-request.sh
  delegated-withdraw-yield-2-complete.sh

Withdrawn yield goes to the validator admin's address.
USAGE
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      --fee) CLI_FEE="$2"; shift 2 ;;
      -h|--help) print_usage; exit 0 ;;
      *) log_error "Unknown arg: $1"; print_usage; exit 1 ;;
    esac
  done
}

check_yield_available() {
  local handler="$1"
  local rpc="$2"
  
  log_info "Checking available yield..."
  
  # Get staking pool address
  local staking_pool
  staking_pool=$(cast_call_clean "$handler" "stakingPool()(address)" -r "$rpc" 2>/dev/null || echo "0x0000000000000000000000000000000000000000")
  
  if [[ "$staking_pool" == "0x0000000000000000000000000000000000000000" ]]; then
    log_error "No staking pool found"
    log_error "Create a pool first with: delegated-create-pool.sh"
    exit 1
  fi
  
  # Get handler's stBERA balance
  local shares_balance
  shares_balance=$(cast_call_clean "$staking_pool" "balanceOf(address)(uint256)" "$handler" -r "$rpc" 2>/dev/null || echo "0")
  
  if [[ "$shares_balance" == "0" ]]; then
    log_error "No stBERA balance in handler"
    log_error "No yield available to withdraw"
    exit 1
  fi
  
  # Get delegated amount
  local delegated_amount available_amount
  delegated_amount=$(cast_call_clean "$handler" "delegatedAmount()(uint256)" -r "$rpc" 2>/dev/null || echo "0")
  available_amount=$(cast_call_clean "$handler" "delegatedAmountAvailable()(uint256)" -r "$rpc" 2>/dev/null || echo "0")
  
  # Calculate used amount (in staking pool) using bc for large numbers
  local delegated_used
  delegated_used=$(echo "$delegated_amount - $available_amount" | bc)
  
  # Estimate locked shares (shares representing delegated principal)
  local locked_shares=0
  if [[ $(echo "$delegated_used > 0" | bc) -eq 1 ]]; then
    # Call previewWithdraw to see how many shares represent the delegated amount
    locked_shares=$(cast_call_clean "$staking_pool" "previewWithdraw(uint256)(uint256)" "$delegated_used" -r "$rpc" 2>/dev/null || echo "0")
  fi
  
  # Calculate redeemable yield shares using bc for large numbers
  local yield_shares
  yield_shares=$(echo "$shares_balance - $locked_shares" | bc)
  
  if [[ $(echo "$yield_shares <= 0" | bc) -eq 1 ]]; then
    log_warn "No yield shares available to redeem"
    local shares_eth locked_eth
    shares_eth=$(cast from-wei "$shares_balance" 2>/dev/null || echo "$shares_balance wei")
    locked_eth=$(cast from-wei "$locked_shares" 2>/dev/null || echo "$locked_shares wei")
    log_error "Total shares:  $shares_eth"
    log_error "Locked shares: $locked_eth"
    log_error "Yield shares:  0"
    exit 1
  fi
  
  # Estimate yield amount
  local yield_amount
  yield_amount=$(cast_call_clean "$staking_pool" "previewRedeem(uint256)(uint256)" "$yield_shares" -r "$rpc" 2>/dev/null || echo "0")
  
  local yield_eth
  yield_eth=$(cast from-wei "$yield_amount" 2>/dev/null || echo "$yield_amount wei")
  log_success "Yield available: ~$yield_eth BERA"
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
  
  local fee_wei
  fee_wei=$(cast to-wei "$CLI_FEE" 2>/dev/null)
  
  log_info "DelegationHandler: $handler"
  log_info "Withdrawal fee: $CLI_FEE BERA"
  log_info "RPC URL: $rpc_url"
  echo ""
  
  # Check yield availability
  check_yield_available "$handler" "$rpc_url"
  echo ""
  
  log_info "Generating withdrawal commands..."
  
  # Get wallet arguments
  local wallet_args
  wallet_args=$(get_cast_wallet_args)
  
  # Command 1: Request withdrawal
  cat > "delegated-withdraw-yield-1-request.sh" <<EOF
#!/usr/bin/env bash
# Step 1: Request yield withdrawal
# Handler: $handler
# Fee: $CLI_FEE BERA
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

# Request yield withdrawal
tx_output=\$(cast send $handler \\
  'requestYieldWithdrawal()' \\
  --value ${CLI_FEE}ether \\
  -r $rpc_url $wallet_args --json)

# Extract request ID from logs
request_id=\$(echo "\$tx_output" | jq -r '.logs[] | select(.topics[0] == "'\$(cast sig-event 'YieldRedeemRequested(uint256,uint256)')") | .topics[1]' | head -n1)

if [[ -n "\$request_id" && "\$request_id" != "null" ]]; then
  # Convert hex to decimal
  request_id_dec=\$(printf "%d" "\$request_id")
  echo ""
  echo "Withdrawal request ID: \$request_id_dec"
  echo ""
  echo "Save this request ID to complete the withdrawal after cooldown!"
  echo "Cooldown period: ~3 days (129,600 blocks)"
  echo ""
  echo "To complete withdrawal, run:"
  echo "  ./delegated-withdraw-yield-2-complete.sh"
  echo ""
  echo "Update the REQUEST_ID in that script with: \$request_id_dec"
else
  echo "Warning: Could not extract request ID from transaction logs"
  echo "Check the transaction receipt manually"
fi
EOF
  chmod +x "delegated-withdraw-yield-1-request.sh"
  
  # Command 2: Complete withdrawal (template - user needs to update with actual request ID)
  cat > "delegated-withdraw-yield-2-complete.sh" <<EOF
#!/usr/bin/env bash
# Step 2: Complete yield withdrawal after cooldown
# Handler: $handler
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

# UPDATE THIS with your actual request ID from step 1
REQUEST_ID=""

if [[ -z "\$REQUEST_ID" ]]; then
  echo "ERROR: Set REQUEST_ID in this script before running"
  echo "Find your request ID from the output of step 1"
  exit 1
fi

cast send $handler \\
  'completeWithdrawal(uint256)' \\
  "\$REQUEST_ID" \\
  -r $rpc_url $wallet_args

echo ""
echo "Yield withdrawn to your address"
EOF
  chmod +x "delegated-withdraw-yield-2-complete.sh"
  
  log_success "Commands generated successfully"
  echo ""
  log_info "Next steps:"
  echo "  1. Review and execute: ./delegated-withdraw-yield-1-request.sh"
  echo "  2. Wait ~3 days for cooldown period"
  echo "  3. Update REQUEST_ID in step 2 script, then execute it"
}

main "$@"





