#!/usr/bin/env bash
set -euo pipefail

# Request principal withdrawal (delegator DEFAULT_ADMIN_ROLE only)
# Run with --help for usage information

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib-common.sh"

CLI_HANDLER=""
CLI_PUBKEY=""
CLI_CHAIN=""
CLI_FEE="0.001"

print_usage() {
  cat <<'USAGE'
delegator-withdraw-principal.sh

Requests withdrawal of original delegated funds (delegator DEFAULT_ADMIN_ROLE only).
This is for capital providers to reclaim their principal after validator exit.

This generates FOUR commands:
1. Request principal withdrawal (includes withdrawal fee)
2. Complete withdrawal after cooldown period (~3 days / 129,600 blocks)
3. Undelegate funds after withdrawal completion
4. Withdraw BERA from handler to your address

Usage:
  delegator-withdraw-principal.sh --pubkey 0x... --chain bepolia|mainnet [--fee 0.001]
  
Required arguments:
  --pubkey 0x...            Validator pubkey (handler will be auto-detected from factory)
  --chain bepolia|mainnet   Chain to use (required)
  
Optional arguments:
  --fee BERA                Withdrawal request fee (default: 0.001 BERA)

Output:
  generated/delegator-withdraw-principal-1-request.sh
  generated/delegator-withdraw-principal-2-complete.sh
  generated/delegator-withdraw-principal-3-undelegate.sh
  generated/delegator-withdraw-principal-4-withdraw.sh

Note: Principal withdrawals are independent of yield withdrawals.
The validator admin can withdraw yield at any time without affecting principal.
USAGE
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      --pubkey) CLI_PUBKEY="$2"; shift 2 ;;
      --chain) CLI_CHAIN="$2"; shift 2 ;;
      --fee) CLI_FEE="$2"; shift 2 ;;
      -h|--help) print_usage; exit 0 ;;
      *) log_error "Unknown arg: $1"; print_usage; exit 1 ;;
    esac
  done
}

check_withdrawal_feasibility() {
  local handler="$1"
  local rpc="$2"
  
  log_info "Checking withdrawal feasibility..."
  
  # Get delegated amounts
  local delegated_amount available_amount pending_amount
  delegated_amount=$(cast_call_clean "$handler" "delegatedAmount()(uint256)" -r "$rpc" 2>/dev/null || echo "0")
  available_amount=$(cast_call_clean "$handler" "delegatedAmountAvailable()(uint256)" -r "$rpc" 2>/dev/null || echo "0")
  pending_amount=$(cast_call_clean "$handler" "delegatedFundsPendingWithdrawal()(uint256)" -r "$rpc" 2>/dev/null || echo "0")
  
  if [[ "$delegated_amount" == "0" ]]; then
    log_error "No funds delegated"
    exit 1
  fi
  
  # Check if withdrawal already pending
  if [[ "$pending_amount" != "0" ]]; then
    local pending_eth
    pending_eth=$(cast from-wei "$pending_amount" 2>/dev/null || echo "$pending_amount wei")
    log_error "Withdrawal already pending: $pending_eth BERA"
    log_error "Complete or cancel the existing withdrawal first"
    exit 1
  fi
  
  # Calculate used amount using bc for large numbers
  local used_amount
  used_amount=$(echo "$delegated_amount - $available_amount" | bc)
  
  # Check if funds are available (allowing 1 wei tolerance for rounding)
  if [[ $(echo "$used_amount > 1" | bc) -eq 1 ]]; then
    local used_eth available_eth delegated_eth
    used_eth=$(cast from-wei "$used_amount" 2>/dev/null || echo "$used_amount wei")
    available_eth=$(cast from-wei "$available_amount" 2>/dev/null || echo "$available_amount wei")
    delegated_eth=$(cast from-wei "$delegated_amount" 2>/dev/null || echo "$delegated_amount wei")
    
    log_error "Delegated funds not fully available for withdrawal"
    log_error "Delegated amount:  $delegated_eth BERA"
    log_error "Available amount:  $available_eth BERA"
    log_error "In staking pool:   $used_eth BERA"
    log_error ""
    log_error "The validator must exit the staking pool before principal withdrawal."
    log_error "Only the amount currently in the pool ($used_eth BERA) will be withdrawn."
    exit 1
  fi
  
  local delegated_eth
  delegated_eth=$(cast from-wei "$used_amount" 2>/dev/null || echo "$used_amount wei")
  log_success "Principal withdrawal is feasible"
  log_info "Amount that will be withdrawn: $delegated_eth BERA"
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
    exit 1
  fi
  
  local CLI_FEE_WEI
  CLI_FEE_WEI=$(cast to-wei "$CLI_FEE" 2>/dev/null)
  
  log_info "DelegationHandler: $HANDLER"
  log_info "Withdrawal fee: $CLI_FEE BERA"
  log_info "RPC URL: $rpc_url"
  echo ""
  
  # Check withdrawal feasibility
  check_withdrawal_feasibility "$HANDLER" "$rpc_url"
  echo ""
  
  log_info "Generating withdrawal commands..."
  
  # Get wallet arguments
  local wallet_args
  wallet_args=$(get_cast_wallet_args)
  
  # Command 1: Request withdrawal
  mkdir -p generated
  cat > "generated/delegator-withdraw-principal-1-request.sh" <<EOF
#!/usr/bin/env bash
# Step 1: Request principal withdrawal
# Handler: $HANDLER
# Fee: $CLI_FEE BERA
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

# Request principal withdrawal
tx_output=\$(cast send $HANDLER \\
  'requestDelegatedFundsWithdrawal()' \\
  --value ${CLI_FEE}ether \\
  -r $rpc_url $wallet_args --json)

# Extract request ID from logs
request_id=\$(echo "\$tx_output" | jq -r '.logs[] | select(.topics[0] == "'\$(cast sig-event 'DelegatedFundsRedeemRequested(uint256,uint256)')") | .topics[1]' | head -n1)

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
  echo "  ./generated/delegator-withdraw-principal-2-complete.sh"
  echo ""
  echo "Update the REQUEST_ID in that script with: \$request_id_dec"
else
  echo "Warning: Could not extract request ID from transaction logs"
  echo "Check the transaction receipt manually"
fi
EOF
  chmod +x "generated/delegator-withdraw-principal-1-request.sh"
  
  # Command 2: Complete withdrawal (template - user needs to update with actual request ID)
  cat > "generated/delegator-withdraw-principal-2-complete.sh" <<EOF
#!/usr/bin/env bash
# Step 2: Complete principal withdrawal after cooldown
# Handler: $HANDLER
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

# UPDATE THIS with your actual request ID from step 1
REQUEST_ID=""

if [[ -z "\$REQUEST_ID" ]]; then
  echo "ERROR: Set REQUEST_ID in this script before running"
  echo "Find your request ID from the output of step 1"
  exit 1
fi

cast send $HANDLER \\
  'completeWithdrawal(uint256)' \\
  "\$REQUEST_ID" \\
  -r $rpc_url $wallet_args

echo ""
echo "Principal withdrawal completed"
echo "Funds are now in the handler contract"
echo "Next: Run step 3 to undelegate"
EOF
  chmod +x "generated/delegator-withdraw-principal-2-complete.sh"
  
  # Command 3: Undelegate
  cat > "generated/delegator-withdraw-principal-3-undelegate.sh" <<EOF
#!/usr/bin/env bash
# Step 3: Undelegate funds (mark as no longer delegated)
# Handler: $HANDLER
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

cast send $HANDLER \\
  'undelegate()' \\
  -r $rpc_url $wallet_args

echo ""
echo "Funds undelegated"
echo "Next: Run step 4 to withdraw BERA to your address"
EOF
  chmod +x "generated/delegator-withdraw-principal-3-undelegate.sh"
  
  # Command 4: Withdraw to receiver
  cat > "generated/delegator-withdraw-principal-4-withdraw.sh" <<EOF
#!/usr/bin/env bash
# Step 4: Withdraw BERA from handler to your address
# Handler: $HANDLER
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

# Set the receiver address and amount
RECEIVER_ADDRESS=""
AMOUNT_WEI=""

if [[ -z "\$RECEIVER_ADDRESS" ]]; then
  echo "ERROR: Set RECEIVER_ADDRESS in this script before running"
  echo "This is the address where you want to receive the BERA"
  exit 1
fi

if [[ -z "\$AMOUNT_WEI" ]]; then
  echo "ERROR: Set AMOUNT_WEI in this script before running"
  echo "Query available amount with:"
  echo "  cast call $HANDLER 'delegatedAmountAvailable()(uint256)' -r $rpc_url"
  exit 1
fi

cast send $HANDLER \\
  'withdraw(uint256,address)' \\
  "\$AMOUNT_WEI" \\
  "\$RECEIVER_ADDRESS" \\
  -r $rpc_url $wallet_args

echo ""
echo "BERA withdrawn to \$RECEIVER_ADDRESS"
EOF
  chmod +x "generated/delegator-withdraw-principal-4-withdraw.sh"
  
  log_success "Commands generated successfully"
  echo ""
  log_info "Next steps:"
  echo "  1. Review and execute: ./generated/delegator-withdraw-principal-1-request.sh"
  echo "  2. Wait ~3 days for cooldown period"
  echo "  3. Update REQUEST_ID in step 2 script, then execute it"
  echo "  4. Review and execute: ./generated/delegator-withdraw-principal-3-undelegate.sh"
  echo "  5. Update RECEIVER_ADDRESS and AMOUNT_WEI in step 4, then execute it"
}

main "$@"





