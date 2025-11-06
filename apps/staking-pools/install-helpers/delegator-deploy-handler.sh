#!/usr/bin/env bash
set -euo pipefail

# Deploy delegation handler for a validator pubkey
# Run with --help for usage information

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib-common.sh"

CLI_PUBKEY=""
CLI_CHAIN=""
CLI_RPC_URL=""
CLI_FACTORY_ADDR=""

print_usage() {
  cat <<'USAGE'
delegator-deploy-handler.sh

Deploys a DelegationHandler contract for a validator pubkey.
This is step 1 for delegators providing capital to validators.

Usage:
  delegator-deploy-handler.sh --pubkey 0x... --chain bepolia|mainnet
  
Required arguments:
  --pubkey 0x...            Validator pubkey (96 hex characters)
  --chain bepolia|mainnet   Chain to use (required)
  
Output:
  delegator-deploy-handler-command.sh
USAGE
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      --pubkey) CLI_PUBKEY="$2"; shift 2 ;;
      --chain) CLI_CHAIN="$2"; shift 2 ;;
      -h|--help) print_usage; exit 0 ;;
      *) log_error "Unknown arg: $1"; print_usage; exit 1 ;;
    esac
  done
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

main() {
  parse_args "$@"
  
  if [[ -z "$CLI_PUBKEY" ]]; then
    log_error "Missing --pubkey (validator pubkey)"
    print_usage
    exit 2
  fi
  
  if [[ -z "$CLI_CHAIN" ]]; then
    log_error "Missing --chain (required for delegator scripts)"
    print_usage
    exit 2
  fi
  
  if ! ensure_cast; then
    exit 1
  fi
  load_env "$SCRIPT_DIR"
  
  local PUBKEY
  PUBKEY=$(validate_pubkey "$CLI_PUBKEY")
  
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
  
  # Get factory address from network
  local factory
  factory=$(get_delegation_handler_factory_for_network "$network")
  if [[ -z "$factory" || "$factory" == "0x0000000000000000000000000000000000000000" ]]; then
    log_error "DelegationHandlerFactory not available for network: $network"
    exit 1
  fi
  
  log_info "Network: $network"
  log_info "Validator pubkey: $PUBKEY"
  log_info "DelegationHandlerFactory: $factory"
  log_info "RPC URL: $rpc_url"
  echo ""
  
  # Check if handler already exists
  local existing_handler
  existing_handler=$(get_delegation_handler "$factory" "$PUBKEY" "$rpc_url")
  
  # Trim whitespace
  existing_handler=$(echo "$existing_handler" | xargs)
  
  # Check if handler exists: must be non-empty, non-zero address, and valid format
  if [[ -n "$existing_handler" && \
        "$existing_handler" != "0x0000000000000000000000000000000000000000" && \
        "$existing_handler" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    log_success "DelegationHandler already deployed for this pubkey"
    log_info "Handler address: $existing_handler"
    echo ""
    log_info "No deployment needed. Use this address in other scripts:"
    echo "  delegator-delegate.sh --pubkey $PUBKEY"
    exit 0
  fi
  
  log_info "No existing handler found. Generating deployment command..."
  echo ""
  
  # Get wallet arguments (--ledger or --private-key)
  local wallet_args
  wallet_args=$(get_cast_wallet_args)
  
  # Generate deployment command
  local cmd_file="delegator-deploy-handler-command.sh"
  
  cat > "$cmd_file" <<EOF
#!/usr/bin/env bash
# Deploy DelegationHandler command
# Validator pubkey: $PUBKEY
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

cast send $factory \\
  'deployDelegationHandler(bytes)' \\
  "$PUBKEY" \\
  -r $rpc_url $wallet_args

# After successful deployment, query the handler address:
echo ""
echo "Handler address:"
cast call $factory \\
  'delegationHandlers(bytes)(address)' \\
  "$PUBKEY" \\
  -r $rpc_url
EOF
  
  chmod +x "$cmd_file"
  
  log_success "Deployment command written to: $cmd_file"
  log_info "Next steps:"
  echo "  1. Review the command: cat $cmd_file"
  echo "  2. Execute: ./$cmd_file"
  echo "  3. After deployment, delegate funds using:"
  echo "     delegator-delegate.sh --pubkey $PUBKEY --amount 250000 --validator-admin 0x..."
}

main "$@"





