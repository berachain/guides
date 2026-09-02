#!/usr/bin/env bash
set -euo pipefail

# Form a DelegationHandler: deploy (if needed), fund, delegate, grant VALIDATOR_ADMIN_ROLE.
# Usage: see --help. Set EL_RPC_URL. Set PRIVATE_KEY to auto-run casts, or run printed commands on Ledger.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib-common.sh"
load_env_if_present "$SCRIPT_DIR"

CLI_PUBKEY=""
CLI_CHAIN=""
CLI_AMOUNT=""
CLI_VALIDATOR_ADMIN=""

print_usage() {
  cat <<'USAGE'
delegator-delegate.sh — form a DelegationHandler for delegated staking

Run on a machine with cast and jq. Not on the validator.

Usage:
  export EL_RPC_URL=https://bepolia.rpc.berachain.com
  ./delegator-delegate.sh
  ./delegator-delegate.sh --pubkey 0x... --amount 500000 --validator-admin 0x...

Required facts (prompted when unset; flags or env supply defaults):
  Validator pubkey, delegate amount (whole BERA), validator-admin address

Environment:
  EL_RPC_URL              Execution-layer JSON-RPC (required)
  PRIVATE_KEY             Optional — run casts from this host when you confirm
  VALIDATOR_PUBKEY        Default pubkey when prompted
  DELEGATE_AMOUNT_BERA    Default delegate amount when prompted
  VALIDATOR_ADMIN         Default operator address for VALIDATOR_ADMIN_ROLE

Optional env.sh in this directory is sourced when present.

Steps:
  1. deployDelegationHandler (skip if handler exists)
  2. Fund handler with delegate amount BERA
  3. delegate(amount) — DEFAULT_ADMIN_ROLE on handler (often Foundation Safe)
  4. grantRole(VALIDATOR_ADMIN_ROLE, operator)

After forming, operator runs ./install.sh to land the pool.
USAGE
}

prompt_delegate_amount() {
  local default="${DELEGATE_AMOUNT_BERA:-}"
  local answer=""
  if [[ -n "$default" ]]; then
    read -r -p "Delegate amount (BERA) [$default]: " answer
    answer=${answer:-$default}
  else
    read -r -p "Delegate amount (BERA): " answer
  fi
  if [[ -z "$answer" || ! "$answer" =~ ^[0-9]+$ ]]; then
    log_error "Delegate amount must be a whole number of BERA"
    return 1
  fi
  printf '%s' "$answer"
}

resolve_pubkey() {
  if [[ -n "$CLI_PUBKEY" ]]; then
    require_validator_pubkey "Validator pubkey" "$CLI_PUBKEY"
    return
  fi
  prompt_validator_pubkey
}

resolve_validator_admin() {
  local normalized=""
  if [[ -n "$CLI_VALIDATOR_ADMIN" ]]; then
    normalized=$(normalize_evm_address "$CLI_VALIDATOR_ADMIN")
    if [[ -z "$normalized" ]]; then
      log_error "--validator-admin must be a valid EVM address"
      return 1
    fi
    printf '%s' "$normalized"
    return
  fi
  local default=""
  if [[ -n "${VALIDATOR_ADMIN:-}" ]]; then
    default=$(normalize_evm_address "$VALIDATOR_ADMIN" || true)
  fi
  prompt_evm_address "Validator admin" "$default"
}

resolve_delegate_amount() {
  if [[ -n "$CLI_AMOUNT" ]]; then
    if ! [[ "$CLI_AMOUNT" =~ ^[0-9]+$ ]]; then
      log_error "--amount must be a whole number of BERA"
      return 1
    fi
    printf '%s' "$CLI_AMOUNT"
    return
  fi
  prompt_delegate_amount
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --pubkey) CLI_PUBKEY="$2"; shift 2 ;;
      --chain) CLI_CHAIN="$2"; shift 2 ;;
      --amount) CLI_AMOUNT="$2"; shift 2 ;;
      --validator-admin) CLI_VALIDATOR_ADMIN="$2"; shift 2 ;;
      -h|--help) print_usage; exit 0 ;;
      *) log_error "Unknown arg: $1"; print_usage; exit 1 ;;
    esac
  done
}

main() {
  parse_args "$@"

  ensure_cast || exit 1
  ensure_jq || exit 1

  if [[ -z "${EL_RPC_URL:-}" ]]; then
    log_error "Set EL_RPC_URL to your execution-layer JSON-RPC endpoint"
    exit 1
  fi

  local network rpc_url
  network=$(network_from_rpc "$EL_RPC_URL") || exit 1
  rpc_url="$EL_RPC_URL"

  if [[ -n "$CLI_CHAIN" && "$CLI_CHAIN" != "$network" ]]; then
    log_error "--chain $CLI_CHAIN does not match EL_RPC_URL (chain id → $network)"
    exit 1
  fi

  local pubkey validator_admin factory handler wallet_args role_hash amount_wei amount_bera
  pubkey=$(resolve_pubkey) || exit 1
  validator_admin=$(resolve_validator_admin) || exit 1
  amount_bera=$(resolve_delegate_amount) || exit 1

  factory=$(get_delegation_handler_factory_for_network "$network")
  if [[ -z "$factory" || "$factory" == "0x0000000000000000000000000000000000000000" ]]; then
    log_error "DelegationHandlerFactory not available for $network"
    exit 1
  fi

  amount_wei=$(cast to-wei "$amount_bera" ether 2>/dev/null) || {
    log_error "Could not convert amount to wei"
    exit 1
  }

  role_hash=$(cast keccak "VALIDATOR_ADMIN_ROLE")

  log_info "Network: $network"
  log_info "Factory: $factory"
  log_info "Pubkey: ${pubkey:0:10}...${pubkey: -4}"
  log_info "Amount: $amount_bera BERA"
  log_info "Validator admin: $validator_admin"
  echo ""

  handler=$(get_delegation_handler "$factory" "$pubkey" "$rpc_url" | tr -d '[:space:]')
  if [[ "$handler" == "0x0000000000000000000000000000000000000000" || -z "$handler" ]]; then
    log_info "No handler yet — deploy first"
    local -a deploy_argv=(send "$factory" 'deployDelegationHandler(bytes)' "$pubkey" -r "$rpc_url")
    append_cast_wallet_args deploy_argv
    run_cast_or_paste "deploy-handler" "$rpc_url" "${deploy_argv[@]}" || exit 1
    handler=$(get_delegation_handler "$factory" "$pubkey" "$rpc_url" | tr -d '[:space:]')
    if [[ "$handler" == "0x0000000000000000000000000000000000000000" || -z "$handler" ]]; then
      log_error "Handler still zero after deploy"
      exit 1
    fi
  else
    log_success "Using existing handler: $handler"
  fi

  local -a fund_argv delegate_argv grant_argv
  fund_argv=(send "$handler" --value "${amount_bera}ether" -r "$rpc_url")
  append_cast_wallet_args fund_argv
  run_cast_or_paste "fund-handler" "$rpc_url" "${fund_argv[@]}" || exit 1

  log_warn "delegate() and grantRole() require DEFAULT_ADMIN_ROLE on the handler (often the Foundation Safe)"
  delegate_argv=(send "$handler" 'delegate(uint256)' "$amount_wei" -r "$rpc_url")
  append_cast_wallet_args delegate_argv
  run_cast_or_paste "delegate" "$rpc_url" "${delegate_argv[@]}" || exit 1

  grant_argv=(send "$handler" 'grantRole(bytes32,address)' "$role_hash" "$validator_admin" -r "$rpc_url")
  append_cast_wallet_args grant_argv
  run_cast_or_paste "grant-role" "$rpc_url" "${grant_argv[@]}" || exit 1

  echo ""
  log_success "Done. Handler: $handler"
  log_info "Operator next: ./install.sh"
}

main "$@"
