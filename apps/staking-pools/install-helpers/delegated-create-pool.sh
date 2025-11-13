#!/usr/bin/env bash
set -euo pipefail

# Create staking pool with delegated funds (validator operator with VALIDATOR_ADMIN_ROLE)
# Run with --help for usage information

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib-common.sh"

print_usage() {
  cat <<'USAGE'
delegated-create-pool.sh

Creates a staking pool using delegated funds.
This is for validator operators who have been granted VALIDATOR_ADMIN_ROLE by a delegator.

This script creates the staking pool contracts and deposits the first 10,000 BERA using delegated funds. It is designed for validator operators who have been granted the VALIDATOR_ADMIN_ROLE by a delegator. After running this script, use delegated-deposit.sh to deposit the remaining funds and reach the required 250,000 BERA.

You do not need to provide most configuration manually: the BEACOND_HOME environment variable should point to your beacond home directory, but the script will auto-detect the network from the beacond genesis, auto-detect the validator public key from beacond, and determine the correct DelegationHandler by querying the factory using your public key.

Usage:
  delegated-create-pool.sh

Output:
  delegated-create-pool-command.sh

USAGE
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      -h|--help) print_usage; exit 0 ;;
      *) log_error "Unknown arg: $1"; print_usage; exit 1 ;;
    esac
  done
}

check_delegation_state() {
  local handler="$1"
  local rpc="$2"

  log_info "Checking delegation state..."

  # Check delegated amount
  local delegated_amount
  delegated_amount=$(cast_call_clean "$handler" "delegatedAmount()(uint256)" -r "$rpc" 2>/dev/null || echo "0")

  if [[ "$delegated_amount" == "0" ]]; then
    log_error "No funds delegated to this handler"
    log_error "Run delegator-delegate.sh first to delegate funds"
    exit 1
  fi

  # Check if staking pool already exists
  local staking_pool
  staking_pool=$(cast_call_clean "$handler" "stakingPool()(address)" -r "$rpc" 2>/dev/null || echo "0x0000000000000000000000000000000000000000")

  if [[ "$staking_pool" != "0x0000000000000000000000000000000000000000" ]]; then
    log_error "Staking pool already created for this handler"
    log_error "Staking pool address: $staking_pool"
    log_error "Use delegated-deposit.sh to add more funds"
    exit 1
  fi

  local delegated_eth
  delegated_eth=$(cast from-wei "$delegated_amount" 2>/dev/null || echo "$delegated_amount wei")
  log_success "Handler has delegated funds: $delegated_eth BERA"
}

verify_handler_pubkey() {
  local handler="$1"
  local expected_pubkey="$2"
  local rpc="$3"

  local handler_pubkey
  handler_pubkey=$(cast call "$handler" "pubkey()(bytes)" -r "$rpc" 2>/dev/null || echo "")

  if [[ -z "$handler_pubkey" ]]; then
    log_error "Could not query handler pubkey"
    exit 1
  fi

  # Normalize both for comparison
  handler_pubkey=$(echo "$handler_pubkey" | tr 'A-F' 'a-f')
  expected_pubkey=$(echo "$expected_pubkey" | tr 'A-F' 'a-f')

  if [[ "$handler_pubkey" != "$expected_pubkey" ]]; then
    log_error "Pubkey mismatch!"
    log_error "Handler pubkey:  $handler_pubkey"
    log_error "Expected pubkey: $expected_pubkey"
    exit 1
  fi

  log_success "Handler pubkey matches validator pubkey"
}

main() {
  parse_args "$@"

  if ! ensure_cast; then
    exit 1
  fi
  load_env "$SCRIPT_DIR"

  # Get BEACOND_HOME from env.sh (which can itself use env var)
  local beacond_home="${BEACOND_HOME:-}"
  if [[ -z "$beacond_home" ]]; then
    log_error "BEACOND_HOME not set in env.sh or environment"
    print_usage
    exit 1
  fi

  if [[ ! -d "$beacond_home" ]]; then
    log_error "beacond home not found: $beacond_home"
    exit 1
  fi

  # Resolve beacond binary from env.sh or default
  local beacond_bin
  if ! beacond_bin=$(resolve_beacond_bin); then
    log_error "beacond binary not found"
    exit 1
  fi

  # Auto-detect network and pubkey from beacond
  local network pubkey
  network=$(get_network_from_genesis "$beacond_bin" "$beacond_home")
  if ! pubkey=$(get_validator_pubkey "$beacond_bin" "$beacond_home"); then
    exit 1
  fi

  log_info "Network: $network"
  log_info "Validator pubkey: $pubkey"

  # RPC URL from network detection
  local rpc_url
  read -r _ rpc_url <<< "$(detect_network_and_rpc)"

  # Auto-detect handler address from pubkey
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

  log_info "DelegationHandler: $handler"
  log_info "RPC URL: $rpc_url"
  echo ""

  # Verify handler state and pubkey match
  check_delegation_state "$handler" "$rpc_url"
  verify_handler_pubkey "$handler" "$pubkey" "$rpc_url"
  echo ""

  # Get withdrawal vault address from network
  local withdrawal_vault
  withdrawal_vault=$(get_withdrawal_vault_for_network "$network")
  if [[ -z "$withdrawal_vault" || "$withdrawal_vault" == "0x0000000000000000000000000000000000000000" ]]; then
    log_error "WithdrawalVault not available for network: $network"
    exit 1
  fi

  log_info "Withdrawal Vault: $withdrawal_vault"

  # Generate deposit data from beacond
  log_info "Generating deposit credentials and signature..."

  # Use withdrawal vault for withdrawal credentials (all withdrawals go through it)
  local amount_gwei=10000000000000

  set +e
  local dep_out
  dep_out=$("$beacond_bin" --home "$beacond_home" deposit create-validator \
    "$withdrawal_vault" \
    "$amount_gwei" \
    -g "$("$beacond_bin" --home "$beacond_home" genesis validator-root "$beacond_home/config/genesis.json" 2>/dev/null)" 2>&1)
  local rc=$?
  set -e

  if [[ $rc -ne 0 || -z "$dep_out" ]]; then
    log_error "deposit create-validator failed: $dep_out"
    exit 1
  fi

  local cred sig amt_used pk_used
  cred=$(echo "$dep_out" | awk '/credentials:/{print $2; exit}')
  sig=$(echo "$dep_out" | awk '/signature:/{print $2; exit}')
  amt_used=$(echo "$dep_out" | awk '/amount:/{print $2; exit}')
  pk_used=$(echo "$dep_out" | awk '/pubkey:/{print $2; exit}')

  if [[ -z "$cred" || -z "$sig" || -z "$amt_used" || -z "$pk_used" ]]; then
    log_error "Could not parse deposit parameters from beacond output"
    exit 1
  fi

  log_success "Deposit data generated"
  log_info "Withdrawal credentials: $cred"
  echo ""

  # Generate create pool command
  local cmd_file="delegated-create-pool-command.sh"
  local wallet_args
  wallet_args=$(get_cast_wallet_args)

  cat > "$cmd_file" <<EOF
#!/usr/bin/env bash
# Create staking pool with delegated funds
# DelegationHandler: $handler
# Validator pubkey: $pubkey
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

cast send $handler \\
  'createStakingPoolWithDelegatedFunds(bytes,bytes,bytes)' \\
  "$pubkey" \\
  "$cred" \\
  "$sig" \\
  -r $rpc_url $wallet_args

# After successful creation, query the staking pool address:
echo ""
echo "Staking pool address:"
cast call $handler \\
  'stakingPool()(address)' \\
  -r $rpc_url
EOF

  chmod +x "$cmd_file"

  log_success "Create pool command written to: $cmd_file"
  log_info "Next steps:"
  echo "  1. Review the command: cat $cmd_file"
  echo "  2. Execute: ./$cmd_file"
  echo "  3. Then activate your validator:"
  echo "     activate.sh --sr 0x... --op 0x..."
  echo "  4. After creation, deposit remaining funds:"
  echo "     delegated-deposit.sh --amount 240000"
}

main "$@"





