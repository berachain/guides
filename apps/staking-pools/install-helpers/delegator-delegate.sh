#!/usr/bin/env bash
set -euo pipefail

# Deploy DelegationHandler (if needed) and delegate funds with validator admin role
# Run with --help for usage information

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib-common.sh"

CLI_PUBKEY=""
CLI_CHAIN=""
CLI_AMOUNT=""
CLI_VALIDATOR_ADMIN=""

print_usage() {
  cat <<'USAGE'
delegator-delegate.sh

Deploys a DelegationHandler (if needed) and delegates funds with validator admin role.
This script combines deployment and delegation into a single workflow.

This script generates ONE command script that executes all steps in order:
1. Deploy DelegationHandler (if not already deployed)
2. Send BERA to the handler contract
3. Call delegate() to mark the funds as delegated
4. Grant VALIDATOR_ADMIN_ROLE to the validator operator

Usage:
  delegator-delegate.sh --pubkey 0x... --chain bepolia|mainnet --amount 250000 --validator-admin 0x...
  
Required arguments:
  --pubkey 0x...            Validator pubkey (96 hex characters)
  --chain bepolia|mainnet   Chain to use (required)
  --amount BERA             Amount of BERA to delegate (e.g., 250000)
  --validator-admin 0x...   Address to grant VALIDATOR_ADMIN_ROLE
  
Output:
  delegator-delegate-command.sh

Review and execute the generated command script.
USAGE
}

validate_pubkey() {
  local pk="$1"
  pk=$(echo "$pk" | tr 'A-F' 'a-f')
  if [[ ! "$pk" =~ ^0x[0-9a-f]{96}$ ]]; then
    log_error "Invalid pubkey: must be 0x followed by 96 hex characters"
    exit 1
  fi
  echo "$pk"
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
  
  if [false && [ "$delegated_amount" != "0" ]]; then
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
  
  # Validate and normalize pubkey
  local PUBKEY
  PUBKEY=$(validate_pubkey "$CLI_PUBKEY")
  
  # Get network and RPC from chain (no automatic detection for delegator scripts)
  local network="$CLI_CHAIN"
  local rpc_url
  rpc_url=$(get_rpc_url_for_network "$network")
  if [[ -z "$rpc_url" ]]; then
    log_error "Unknown chain: $network"
    exit 1
  fi
  
  # Get factory address from network
  local factory
  factory=$(get_delegation_handler_factory_for_network "$network")
  if [[ -z "$factory" || "$factory" == "0x0000000000000000000000000000000000000000" ]]; then
    log_error "DelegationHandlerFactory not available for network: $network"
    exit 1
  fi
  
  # Check if handler already exists
  local HANDLER
  HANDLER=$(get_delegation_handler "$factory" "$PUBKEY" "$rpc_url")
  
  # Trim whitespace
  HANDLER=$(echo "$HANDLER" | xargs)
  
  local needs_deployment=false
  # Check if handler exists: must be non-empty, non-zero address, and valid format
  if [[ -z "$HANDLER" || \
        "$HANDLER" == "0x0000000000000000000000000000000000000000" || \
        ! "$HANDLER" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    needs_deployment=true
    log_info "No DelegationHandler found for this pubkey"
    log_info "Handler will be deployed as part of the command script"
  else
    log_success "DelegationHandler already deployed"
    log_info "Handler address: $HANDLER"
  fi
  
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
  
  log_info "Network: $network"
  log_info "Validator pubkey: $PUBKEY"
  log_info "DelegationHandlerFactory: $factory"
  if [[ "$needs_deployment" == "false" ]]; then
    log_info "DelegationHandler: $HANDLER"
  fi
  log_info "Amount to delegate: $CLI_AMOUNT BERA"
  log_info "Validator admin: $VALIDATOR_ADMIN"
  log_info "RPC URL: $rpc_url"
  echo ""
  
  # If handler exists, check its state
  if [[ "$needs_deployment" == "false" ]]; then
    check_handler_state "$HANDLER" "$rpc_url"
    echo ""
  fi
  
  # Generate single command script
  log_info "Generating combined command script..."
  
  # Get wallet arguments (--ledger or --private-key)
  local wallet_args
  wallet_args=$(get_cast_wallet_args)
  
  # Calculate role hash
  local role_hash
  role_hash=$(cast keccak "VALIDATOR_ADMIN_ROLE")
  
  # Generate single command script
  local cmd_file="delegator-delegate-command.sh"
  
  cat > "$cmd_file" <<EOF
#!/usr/bin/env bash
# Combined deployment and delegation command
# Validator pubkey: $PUBKEY
# Amount: $CLI_AMOUNT BERA
# Validator admin: $VALIDATOR_ADMIN
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

# Step 1: Deploy DelegationHandler (if needed)
EOF

  if [[ "$needs_deployment" == "true" ]]; then
    cat >> "$cmd_file" <<EOF
echo "Step 1: Deploying DelegationHandler..."
cast send $factory \\
  'deployDelegationHandler(bytes)' \\
  "$PUBKEY" \\
  -r $rpc_url $wallet_args

echo ""
echo "Querying handler address..."
HANDLER=\$(cast call $factory \\
  'delegationHandlers(bytes)(address)' \\
  "$PUBKEY" \\
  -r $rpc_url | xargs)

if [[ -z "\$HANDLER" || "\$HANDLER" == "0x0000000000000000000000000000000000000000" ]]; then
  echo "Error: Failed to get handler address after deployment"
  exit 1
fi

echo "DelegationHandler deployed at: \$HANDLER"
echo ""

EOF
  else
    cat >> "$cmd_file" <<EOF
HANDLER="$HANDLER"
echo "Using existing DelegationHandler: \$HANDLER"
echo ""

EOF
  fi

  cat >> "$cmd_file" <<EOF
# Step 2: Send BERA to DelegationHandler
echo "Step 2: Sending $CLI_AMOUNT BERA to DelegationHandler..."
cast send \$HANDLER \\
  --value ${CLI_AMOUNT}ether \\
  -r $rpc_url $wallet_args

echo ""

# Step 3: Mark funds as delegated
echo "Step 3: Marking funds as delegated..."
cast send \$HANDLER \\
  'delegate(uint256)' \\
  "$amount_wei" \\
  -r $rpc_url $wallet_args

echo ""

# Step 4: Grant VALIDATOR_ADMIN_ROLE
echo "Step 4: Granting VALIDATOR_ADMIN_ROLE to $VALIDATOR_ADMIN..."
cast send \$HANDLER \\
  'grantRole(bytes32,address)' \\
  "$role_hash" \\
  "$VALIDATOR_ADMIN" \\
  -r $rpc_url $wallet_args

echo ""
echo "Delegation complete!"
echo "The validator operator can now create their staking pool:"
echo "  delegated-create-pool.sh --pubkey $PUBKEY"
EOF

  chmod +x "$cmd_file"
  
  log_success "Command script generated: $cmd_file"
  echo ""
  log_info "Next steps:"
  echo "  1. Review the command: cat $cmd_file"
  echo "  2. Execute: ./$cmd_file"
}

main "$@"





