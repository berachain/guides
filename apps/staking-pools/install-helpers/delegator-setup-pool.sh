#!/usr/bin/env bash
set -euo pipefail

# Generate delegation setup commands
# Run with --help for usage information

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Functions used from lib-common.sh:
# - ensure_cast: Ensures cast command is available
# - load_env: Loads environment variables from env.sh
# - get_delegation_handler_factory_for_network: Gets DelegationHandlerFactory address for network
# - get_rpc_url_for_network: Gets RPC URL for network
# - get_cast_wallet_args: Gets wallet arguments for cast commands (Ledger or private key)
# - normalize_evm_address: Normalizes and validates EVM address
# - validate_amount: Validates amount is positive number
# - log_error, log_info, log_success, log_warn: Logging functions
#
# NOTE: Keep this list updated if additional functions from lib-common.sh are used.

source "$SCRIPT_DIR/lib-common.sh"

CLI_PUBKEY=""
CLI_CHAIN=""
CLI_AMOUNT=""
CLI_VALIDATOR_ADMIN=""

# Global variables set by functions
PUBKEY=""
AMOUNT_WEI=""
VALIDATOR_ADMIN=""
NETWORK=""
RPC_URL=""
FACTORY=""
HANDLER=""
NEEDS_DEPLOYMENT=""

print_usage() {
  cat <<'USAGE'
delegator-setup-pool.sh

Generates commands for delegation setup in 3 steps:
1. Deploy DelegationHandler (anyone can execute)
2. Fund handler via BitGo transaction
3. Delegate funds and grant role via Safe transaction

Usage:
  delegator-setup-pool.sh --pubkey 0x... --amount BERA --validator-admin 0x... [options]

Required arguments:
  --pubkey 0x...            Validator pubkey (96 hex characters)
  --amount BERA             Amount of BERA to delegate
  --validator-admin 0x...   Address to grant VALIDATOR_ADMIN_ROLE

Required arguments:
  --chain bepolia|mainnet   Chain to use

Output files (in generated/ directory):
  generated/deploy-command.sh
  generated/bitgo-fund-handler.json
  generated/safe-delegate-and-grant.txt
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

validate_inputs() {
  if [[ -z "$CLI_PUBKEY" ]]; then
    log_error "Missing --pubkey (required)"
    print_usage
    exit 1
  fi
  
  if [[ -z "$CLI_AMOUNT" ]]; then
    log_error "Missing --amount (required)"
    print_usage
    exit 1
  fi
  
  if [[ -z "$CLI_VALIDATOR_ADMIN" ]]; then
    log_error "Missing --validator-admin (required)"
    print_usage
    exit 1
  fi
  
  if [[ -z "$CLI_CHAIN" ]]; then
    log_error "Missing --chain (required)"
    print_usage
    exit 1
  fi
  
  if [[ "$CLI_CHAIN" != "bepolia" && "$CLI_CHAIN" != "mainnet" ]]; then
    log_error "Invalid chain: $CLI_CHAIN (must be 'bepolia' or 'mainnet')"
    exit 1
  fi
  
  # Validate and normalize pubkey
  local pubkey
  pubkey=$(validate_pubkey "$CLI_PUBKEY")
  
  # Validate amount
  if ! validate_amount "$CLI_AMOUNT" "amount"; then
    exit 1
  fi
  
  # Convert to wei
  local amount_wei
  amount_wei=$(cast to-wei "$CLI_AMOUNT" 2>/dev/null)
  
  # Validate validator admin
  local validator_admin
  validator_admin=$(normalize_evm_address "$CLI_VALIDATOR_ADMIN")
  if [[ -z "$validator_admin" ]]; then
    log_error "--validator-admin must be a valid EVM address"
    exit 1
  fi
  
  # Return values via global variables (bash limitation)
  PUBKEY="$pubkey"
  AMOUNT_WEI="$amount_wei"
  VALIDATOR_ADMIN="$validator_admin"
}

setup_network_and_rpc() {
  local network="$CLI_CHAIN"
  local rpc_url
  local factory
  
  rpc_url=$(get_rpc_url_for_network "$network")
  if [[ -z "$rpc_url" ]]; then
    log_error "Unknown chain: $network"
    exit 1
  fi
  
  factory=$(get_delegation_handler_factory_for_network "$network")
  if [[ -z "$factory" || "$factory" == "0x0000000000000000000000000000000000000000" ]]; then
    log_error "DelegationHandlerFactory not available for network: $network"
    exit 1
  fi
  
  # Return values via global variables
  NETWORK="$network"
  RPC_URL="$rpc_url"
  FACTORY="$factory"
}

get_handler_status() {
  local factory="$1"
  local pubkey="$2"
  local rpc_url="$3"
  local handler
  local needs_deployment=false
  
  handler=$(cast call "$factory" "delegationHandlers(bytes)(address)" "$pubkey" -r "$rpc_url" 2>/dev/null | xargs || echo "")
  handler=$(echo "$handler" | xargs)
  
  if [[ -z "$handler" || "$handler" == "0x0000000000000000000000000000000000000000" ]]; then
    needs_deployment=true
    log_info "Handler not deployed - will generate deployment command"
  else
    local handler_code
    handler_code=$(cast code "$handler" -r "$rpc_url" 2>/dev/null || echo "0x")
    if [[ -z "$handler_code" || "$handler_code" == "0x" ]]; then
      needs_deployment=true
      log_info "Handler address exists but not deployed - will generate deployment command"
    else
      needs_deployment=false
      log_info "Handler already deployed at: $handler"
    fi
  fi
  
  # Return values via global variables
  HANDLER="$handler"
  NEEDS_DEPLOYMENT="$needs_deployment"
}

print_summary() {
  local network="$1"
  local pubkey="$2"
  local amount="$3"
  local amount_wei="$4"
  local validator_admin="$5"
  local handler="$6"
  local needs_deployment="$7"
  
  log_info "Network: $network"
  log_info "Validator pubkey: $pubkey"
  log_info "Amount: $amount BERA ($amount_wei wei)"
  log_info "Validator admin: $validator_admin"
  if [[ "$needs_deployment" == "true" ]]; then
    log_info "Delegation Handler: Will be deployed"
  else
    log_info "Delegation Handler: $handler"
  fi
  echo ""
}

generate_deploy_command() {
  local factory="$1"
  local pubkey="$2"
  local rpc_url="$3"
  local deploy_file="generated/deploy-command.sh"
  local wallet_args
  wallet_args=$(get_cast_wallet_args)
  
  cat > "$deploy_file" <<EOF
#!/usr/bin/env bash
# Deploy DelegationHandler
# Validator pubkey: $pubkey
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

cast send $factory \\
  'deployDelegationHandler(bytes)' \\
  "$pubkey" \\
  -r $rpc_url $wallet_args

echo ""
echo "Query handler address:"
cast call $factory \\
  'delegationHandlers(bytes)(address)' \\
  "$pubkey" \\
  -r $rpc_url
EOF
  chmod +x "$deploy_file"
  log_success "Generated: $deploy_file"
}

generate_bitgo_transaction() {
  local handler="$1"
  local amount_wei="$2"
  local bitgo_file="generated/bitgo-fund-handler.json"
  
  cat > "$bitgo_file" <<EOF
{
  "recipients": [
    {
      "address": "$handler",
      "amount": "$amount_wei"
    }
  ],
  "type": "transfer"
}
EOF
  log_success "Generated: $bitgo_file"
}

generate_safe_transaction() {
  local handler="$1"
  local amount_wei="$2"
  local role_hash="$3"
  local validator_admin="$4"
  local safe_file="generated/safe-delegate-and-grant.txt"
  
  cat > "$safe_file" <<EOF
Safe Transaction Builder Instructions
=====================================

FROM: Governance Wallet

Step 1: Set TO address
-----------------------
TO: $handler

Step 2: Paste ABI into Safe transaction builder
------------------------------------------------
[
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "delegate",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "grantRole",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "VALIDATOR_ADMIN_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
]

Step 3: Add Transaction 1
---------------------------
Value: 0
Function: delegate
Parameters:
  amount: $amount_wei

Step 4: Add Transaction 2
---------------------------
Value: 0
Function: grantRole
Parameters:
  role: $role_hash
  account: $validator_admin

Step 5: Review and execute the Safe transaction
EOF
  log_success "Generated: $safe_file"
}

print_next_steps() {
  local needs_deployment="$1"
  
  echo ""
  if [[ "$needs_deployment" == "true" ]]; then
    log_info "Next steps:"
    echo "  1. Execute: ./generated/deploy-command.sh"
    echo "  2. Run this script again to generate BitGo and Safe transactions"
  else
    log_info "Next steps:"
    echo "  1. Submit BitGo transaction: tsx submit-bitgo-transaction.ts generated/bitgo-fund-handler.json"
    echo "  2. Follow instructions in generated/safe-delegate-and-grant.txt"
  fi
}

main() {
  parse_args "$@"
  
  if ! ensure_cast; then
    exit 1
  fi
  
  validate_inputs
  
  load_env "$SCRIPT_DIR"
  
  setup_network_and_rpc
  
  get_handler_status "$FACTORY" "$PUBKEY" "$RPC_URL"
  
  # Calculate role hash
  local role_hash
  role_hash=$(cast keccak "VALIDATOR_ADMIN_ROLE")
  
  print_summary "$NETWORK" "$PUBKEY" "$CLI_AMOUNT" "$AMOUNT_WEI" "$VALIDATOR_ADMIN" "$HANDLER" "$NEEDS_DEPLOYMENT"
  
  mkdir -p generated
  
  if [[ "$NEEDS_DEPLOYMENT" == "true" ]]; then
    generate_deploy_command "$FACTORY" "$PUBKEY" "$RPC_URL"
  else
    generate_bitgo_transaction "$HANDLER" "$AMOUNT_WEI"
    generate_safe_transaction "$HANDLER" "$AMOUNT_WEI" "$role_hash" "$VALIDATOR_ADMIN"
  fi
  
  print_next_steps "$NEEDS_DEPLOYMENT"
}

main "$@"
