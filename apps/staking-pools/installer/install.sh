#!/usr/bin/env bash
set -euo pipefail

# Remote staking pool installer — cast commands with optional auto-run.
# Usage: ./install.sh | --help

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../install-helpers/lib-common.sh
source "$SCRIPT_DIR/../install-helpers/lib-common.sh"

readonly INSTALLER_RECEIPTS="${INSTALLER_RECEIPTS:-./staking-pool-receipts.jsonl}"
readonly DEPOSIT_AMOUNT_GWEI="10000000000000"

preflight() {
  ensure_cast || return 1
  ensure_jq || return 1
  if ! have_cmd curl; then
    log_error "curl is required"
    return 1
  fi
  if [[ -z "${EL_RPC_URL:-}" ]]; then
    log_error "Set EL_RPC_URL to your execution-layer JSON-RPC endpoint"
    return 1
  fi
  if [[ -z "${CL_NODE_API_URL:-}" ]]; then
    log_error "Set CL_NODE_API_URL to your Beacon Kit Node API base URL (http://host:port)"
    return 1
  fi
  return 0
}

normalize_cl_base() {
  local url="${1:-}"
  url="${url%/}"
  if [[ "$url" != http://* && "$url" != https://* ]]; then
    url="http://${url}"
  fi
  printf '%s' "$url"
}

verify_el() {
  local rpc="$1"
  local chain_id rc=0
  chain_id=$(cast chain-id -r "$rpc" 2>&1) || rc=$?
  if (( rc != 0 )); then
    log_error "EL_RPC_URL failed eth_chainId: $chain_id"
    return 1
  fi
  chain_id=$(strip_scientific_notation "$chain_id")
  case "$chain_id" in
    80094) echo "mainnet" ;;
    80069) echo "bepolia" ;;
    *)
      log_error "Unsupported chain id $chain_id (expected 80094 mainnet or 80069 bepolia)"
      return 1
      ;;
  esac
}

verify_cl() {
  local base
  base=$(normalize_cl_base "$1")
  local http_status body tmp
  tmp=$(mktemp)
  # shellcheck disable=SC2064
  trap "rm -f '$tmp'" RETURN
  http_status=$(curl -sS -o "$tmp" -w "%{http_code}" "${base}/eth/v1/node/syncing" 2>&1) || {
    log_error "CL Node API unreachable at $base"
    return 1
  }
  body=$(cat "$tmp")
  if [[ "$http_status" != "200" ]]; then
    log_error "CL Node API returned HTTP $http_status: $(echo "$body" | head -c 200)"
    return 1
  fi
  if ! echo "$body" | jq -e . >/dev/null 2>&1; then
    log_error "CL Node API returned non-JSON from ${base}/eth/v1/node/syncing"
    return 1
  fi
  printf '%s' "$base"
}

require_evm_address() {
  local label="$1"
  local value="$2"
  local normalized
  normalized=$(normalize_evm_address "$value")
  if [[ -z "$normalized" ]]; then
    log_error "$label must be 0x followed by 40 hex characters"
    return 1
  fi
  printf '%s' "$normalized"
}

require_tx_hash() {
  local label="$1"
  local value="$2"
  local lower
  lower=$(echo "$value" | tr 'A-F' 'a-f')
  if [[ ! "$lower" =~ ^0x[0-9a-f]{64}$ ]]; then
    log_error "$label must be a 32-byte transaction hash (0x + 64 hex)"
    return 1
  fi
  printf '%s' "$lower"
}

parse_deposit_paste() {
  local pasted="$1"
  local cred sig amt pk
  cred=$(echo "$pasted" | awk '/credentials:/{print $2; exit}')
  sig=$(echo "$pasted" | awk '/signature:/{print $2; exit}')
  amt=$(echo "$pasted" | awk '/amount:/{print $2; exit}')
  pk=$(echo "$pasted" | awk '/pubkey:/{print $2; exit}')
  if [[ -z "$cred" || -z "$sig" || -z "$amt" || -z "$pk" ]]; then
    log_error "Deposit paste must include credentials, signature, amount, and pubkey lines"
    return 1
  fi
  printf '%s\n%s\n%s\n%s\n' "$cred" "$sig" "$amt" "$pk"
}

assert_deposit_pubkey() {
  local deposit_pk="$1"
  local identity_pk="$2"
  if [[ "$(bash_lowercase "$deposit_pk")" != "$(bash_lowercase "$identity_pk")" ]]; then
    log_error "Deposit pubkey $deposit_pk does not match validator pubkey $identity_pk"
    return 1
  fi
}

validate_deposit() {
  local pubkey="$1"
  local cred="$2"
  local amount_gwei="$3"
  local sig="$4"
  local genesis_root="$5"

  if [[ "$amount_gwei" != "$DEPOSIT_AMOUNT_GWEI" ]]; then
    log_error "Deposit amount $amount_gwei gwei does not match required $DEPOSIT_AMOUNT_GWEI"
    return 1
  fi

  local beacond_bin="${BEACOND_BIN:-beacond}"
  if [[ -z "${BEACOND_HOME:-}" ]] || ! have_cmd "$beacond_bin"; then
    log_info "Run deposit validate on the validator before pasting (must exit 0, no output):"
    echo "  beacond --home <BEACOND_HOME> deposit validate \\"
    echo "    $pubkey $cred $amount_gwei $sig -g $genesis_root"
    return 0
  fi

  local vout rc=0
  vout=$("$beacond_bin" --home "$BEACOND_HOME" deposit validate \
    "$pubkey" "$cred" "$amount_gwei" "$sig" -g "$genesis_root" 2>&1) || rc=$?
  if (( rc != 0 )); then
    log_error "beacond deposit validate failed: $vout"
    return 1
  fi
  log_success "beacond deposit validate: OK"
}

lookup_delegation_handler() {
  local network="$1"
  local pubkey="$2"
  local rpc="$3"
  local factory handler
  factory=$(get_delegation_handler_factory_for_network "$network")
  if [[ -z "$factory" || "$factory" == "0x0000000000000000000000000000000000000000" ]]; then
    return 1
  fi
  handler=$(get_delegation_handler "$factory" "$pubkey" "$rpc")
  if [[ "$handler" == "0x0000000000000000000000000000000000000000" ]]; then
    return 1
  fi
  printf '%s' "$handler"
}

assert_delegated_landing_ready() {
  local handler="$1"
  local pubkey="$2"
  local rpc="$3"

  local delegated_amount
  delegated_amount=$(cast_call_clean "$handler" "delegatedAmount()(uint256)" -r "$rpc" 2>/dev/null || echo "0")
  if [[ "$delegated_amount" == "0" ]]; then
    log_error "DelegationHandler has no delegated funds — the delegator must form the handler first"
    return 1
  fi

  local existing_pool
  existing_pool=$(cast_call_clean "$handler" "stakingPool()(address)" -r "$rpc" 2>/dev/null || echo "0x0")
  if [[ "$existing_pool" != "0x0000000000000000000000000000000000000000" ]]; then
    log_error "Staking pool already exists for this handler: $existing_pool"
    return 1
  fi

  local handler_pubkey
  handler_pubkey=$(cast call "$handler" "pubkey()(bytes)" -r "$rpc" 2>/dev/null || echo "")
  handler_pubkey=$(echo "$handler_pubkey" | tr 'A-F' 'a-f')
  if [[ "$handler_pubkey" != "$(bash_lowercase "$pubkey")" ]]; then
    log_error "Handler pubkey $handler_pubkey does not match validator pubkey $pubkey"
    return 1
  fi

  local delegated_eth
  delegated_eth=$(cast from-wei "$delegated_amount" ether 2>/dev/null || echo "$delegated_amount")
  log_success "DelegationHandler ready: $delegated_eth BERA delegated"
  return 0
}

staking_pool_from_handler() {
  local handler="$1"
  local rpc="$2"
  cast_call_clean "$handler" "stakingPool()(address)" -r "$rpc" 2>/dev/null
}

append_receipt() {
  local action="$1"
  local hash="$2"
  local amount="${3:-}"
  local pool="${4:-}"
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local line
  if [[ -n "$pool" ]]; then
    line=$(jq -nc \
      --arg ts "$ts" --arg action "$action" --arg hash "$hash" \
      --arg amount "$amount" --arg pool "$pool" \
      '{timestamp:$ts,action:$action,hash:$hash,amount:$amount,pool:$pool}')
  else
    line=$(jq -nc \
      --arg ts "$ts" --arg action "$action" --arg hash "$hash" \
      --arg amount "$amount" \
      '{timestamp:$ts,action:$action,hash:$hash,amount:$amount}')
  fi
  printf '%s\n' "$line" >> "$INSTALLER_RECEIPTS"
}

funding_address() {
  if [[ -n "${PRIVATE_KEY:-}" ]]; then
    cast wallet address --private-key "$PRIVATE_KEY" 2>/dev/null | tr 'A-F' 'a-f'
    return
  fi
  local addr
  read -r -p "Funding wallet address (0x...): " addr
  require_evm_address "Funding address" "$addr"
}

run_cast_or_paste() {
  local label="$1"
  local cast_cmd="$2"
  local amount="${3:-}"
  local pool="${4:-}"

  echo "" >&2
  log_info "$label command:"
  echo "$cast_cmd" >&2
  echo "" >&2

  local tx_hash=""
  if [[ -n "${PRIVATE_KEY:-}" ]]; then
    local ans
    read -r -p "Run this command now? [y/N] " ans
    if [[ "$ans" =~ ^[yY] ]]; then
      local out rc=0
      out=$(eval "$cast_cmd" 2>&1) || rc=$?
      if (( rc != 0 )); then
        log_error "$label broadcast failed: $out"
        return 1
      fi
      tx_hash=$(echo "$out" | grep -Eo '0x[0-9a-fA-F]{64}' | head -n1 || true)
      if [[ -z "$tx_hash" ]]; then
        log_error "Could not read transaction hash from cast output"
        return 1
      fi
    fi
  fi

  if [[ -z "$tx_hash" ]]; then
    read -r -p "Paste $label transaction hash (0x...): " tx_hash
    tx_hash=$(require_tx_hash "$label transaction hash" "$tx_hash") || return 1
  fi

  local receipt rc=0
  receipt=$(cast receipt "$tx_hash" -r "$EL_RPC_URL" --json 2>&1) || rc=$?
  if (( rc != 0 )); then
    log_error "Transaction $tx_hash not found or not confirmed yet: $receipt"
    return 1
  fi
  local status
  status=$(echo "$receipt" | jq -r '.status // empty')
  if [[ "$status" != "0x1" && "$status" != "1" ]]; then
    log_error "Transaction $tx_hash failed on chain"
    return 1
  fi
  log_success "$label confirmed: $tx_hash"
  append_receipt "$label" "$tx_hash" "$amount" "$pool"
  printf '%s' "$tx_hash"
}

wait_for_validator_registration() {
  local cl_base="$1"
  local pubkey="$2"
  local index=""
  log_info "Waiting for validator registration on beacon chain..."
  while [[ -z "$index" ]]; do
    index=$(get_validator_index_from_api "$cl_base" "$pubkey")
    if [[ -n "$index" ]]; then
      log_success "Registered (index $index)."
      printf '%s' "$index"
      return 0
    fi
    sleep 5
  done
}

fetch_json() {
  local url="$1"
  local label="${2:-$url}"
  local body http_status tmp
  tmp=$(mktemp)
  # shellcheck disable=SC2064
  trap "rm -f '$tmp'" RETURN
  http_status=$(curl -sS -o "$tmp" -w "%{http_code}" "$url" 2>&1) || {
    log_error "curl failed for $label"
    return 1
  }
  body=$(cat "$tmp")
  if [[ "$http_status" != "200" ]]; then
    log_error "$label returned HTTP $http_status"
    return 1
  fi
  if ! echo "$body" | jq -e . >/dev/null 2>&1; then
    log_error "$label returned non-JSON"
    return 1
  fi
  printf '%s' "$body"
}

build_activation_cast() {
  local factory="$1"
  local rpc="$2"
  local cl_base="$3"
  local pubkey="$4"
  local withdrawal_vault="$5"
  local validator_index="$6"

  local head_json slot
  head_json=$(fetch_json "${cl_base}/eth/v1/beacon/headers/head" "beacon head") || return 1
  slot=$(echo "$head_json" | jq -r '.data.header.message.slot // empty')
  if [[ -z "$slot" || ! "$slot" =~ ^[0-9]+$ ]]; then
    log_error "Could not read head slot from beacon API"
    return 1
  fi
  log_info "Pinned CL slot: $slot"

  local pubkey_proof_json credentials_proof_json balance_proof_json
  pubkey_proof_json=$(fetch_json \
    "${cl_base}/bkit/v1/proof/validator_pubkey/${slot}/${validator_index}" \
    "validator_pubkey proof") || return 1
  credentials_proof_json=$(fetch_json \
    "${cl_base}/bkit/v1/proof/validator_credentials/${slot}/${validator_index}" \
    "validator_credentials proof") || return 1
  balance_proof_json=$(fetch_json \
    "${cl_base}/bkit/v1/proof/validator_balance/${slot}/${validator_index}" \
    "validator_balance proof") || return 1

  local el_block_number=$((10#$slot + 1))
  local block_json=""
  local attempt
  for attempt in $(seq 1 60); do
    if block_json=$(cast block "$el_block_number" --json -r "$rpc" 2>/dev/null); then
      if [[ -n "$block_json" && "$block_json" != "null" ]]; then
        break
      fi
    fi
    sleep 1
  done
  if [[ -z "$block_json" || "$block_json" == "null" ]]; then
    log_error "Timed out waiting for EL block $el_block_number"
    return 1
  fi

  local timestamp_hex timestamp_dec
  timestamp_hex=$(echo "$block_json" | jq -r '.timestamp // empty')
  timestamp_dec=$((timestamp_hex))

  local v_pubkey v_withdrawal_creds v_balance
  v_pubkey=$(echo "$pubkey_proof_json" | jq -r '.validator_pubkey')
  v_withdrawal_creds=$(echo "$credentials_proof_json" | jq -r '.validator_withdrawal_credentials')
  v_balance=$(echo "$balance_proof_json" | jq -r '.validator_balance')
  if [[ "$v_balance" == 0x* ]]; then
    v_balance=$((v_balance))
  else
    v_balance=$((10#$v_balance))
  fi

  local pubkey_proof_cast withdrawal_creds_proof_cast balance_proof_cast balance_leaf
  pubkey_proof_cast=$(echo "$pubkey_proof_json" | jq -r '.validator_pubkey_proof | join(",")')
  withdrawal_creds_proof_cast=$(echo "$credentials_proof_json" | jq -r '.withdrawal_credentials_proof | join(",")')
  balance_proof_cast=$(echo "$balance_proof_json" | jq -r '.balance_proof | join(",")')
  balance_leaf=$(echo "$balance_proof_json" | jq -r '.balance_leaf')

  local wallet_args
  wallet_args=$(get_cast_wallet_args)

  local cast_cmd
  cast_cmd=$(cat <<EOF
cast send $factory 'activateStakingPool((bytes,bytes,uint64,uint64),(bytes32[],bytes32[],bytes32[],bytes32),uint64)' "($v_pubkey,$v_withdrawal_creds,$v_balance,$validator_index)" "([$pubkey_proof_cast],[$withdrawal_creds_proof_cast],[$balance_proof_cast],$balance_leaf)" $timestamp_dec -r $rpc $wallet_args
EOF
)
  printf '%s' "$cast_cmd"
}

print_usage() {
  cat <<'USAGE'
install.sh — remote staking pool installer

Run on a machine with cast, jq, and curl. Not on the validator.
Set EL_RPC_URL and CL_NODE_API_URL. Set PRIVATE_KEY to auto-run casts, or
leave unset and run printed cast commands on your Ledger machine.

Self-funded: prompts for operator/shares and sends 10,000 BERA with deploy.
Delegated: auto-detected when a DelegationHandler exists for your pubkey
(handler must already be formed and funded by the delegator).

Usage:
  ./install.sh
  ./install.sh --help

Environment:
  EL_RPC_URL          Execution-layer JSON-RPC (required)
  CL_NODE_API_URL     Beacon Kit Node API base URL (required)
  PRIVATE_KEY         Optional — run casts from this host when you confirm
USAGE
}

cmd_install() {
  preflight || exit 1

  local network rpc_url cl_base genesis_root
  network=$(verify_el "$EL_RPC_URL") || exit 1
  rpc_url="$EL_RPC_URL"
  cl_base=$(verify_cl "$CL_NODE_API_URL") || exit 1
  genesis_root=$(get_genesis_validator_root_for_network "$network")

  local factory withdrawal_vault
  factory=$(get_factory_address_for_network "$network")
  withdrawal_vault=$(get_withdrawal_vault_for_network "$network")
  if [[ -z "$factory" || -z "$withdrawal_vault" ]]; then
    log_error "Could not resolve factory or withdrawal vault for $network"
    exit 1
  fi

  local pubkey operator shares funding cred sig dep_pk parsed pasted line
  local delegated_mode=false delegation_handler="" staking_pool wallet_args deploy_cmd

  read -r -p "Validator pubkey (0x...): " pubkey
  pubkey=$(echo "$pubkey" | tr -d '[:space:]')
  if [[ -z "$pubkey" ]]; then
    log_error "Validator pubkey is required"
    exit 1
  fi

  delegation_handler=$(lookup_delegation_handler "$network" "$pubkey" "$rpc_url" 2>/dev/null || true)
  if [[ -n "$delegation_handler" ]]; then
    assert_delegated_landing_ready "$delegation_handler" "$pubkey" "$rpc_url" || exit 1
    delegated_mode=true
    log_info "Delegated landing mode — using DelegationHandler (not self-funded deploy)"
  else
    log_warn "No DelegationHandler for this pubkey — self-funded deploy (10,000 BERA from your wallet + gas)"
    funding=$(funding_address) || exit 1
    read -r -p "Operator address [$funding]: " operator
    operator=${operator:-$funding}
    operator=$(require_evm_address "Operator address" "$operator") || exit 1
    read -r -p "Shares recipient [$funding]: " shares
    shares=${shares:-$funding}
    shares=$(require_evm_address "Shares recipient" "$shares") || exit 1
  fi

  echo ""
  log_info "On the validator, run beacond deposit create-validator:"
  echo "  beacond --home <BEACOND_HOME> deposit create-validator \\"
  echo "    $withdrawal_vault $DEPOSIT_AMOUNT_GWEI -g $genesis_root"
  echo ""
  log_info "Then verify the signature on the validator (must exit 0, no output):"
  echo "  beacond --home <BEACOND_HOME> deposit validate \\"
  echo "    <pubkey> <credentials> <amount> <signature> -g $genesis_root"
  echo "  (use the four values from create-validator output)"
  echo ""
  echo "Paste the full beacond output, then a blank line:"
  pasted=""
  while IFS= read -r line; do
    [[ -z "$line" && -n "$pasted" ]] && break
    pasted+="${line}"$'\n'
  done
  parsed=$(parse_deposit_paste "$pasted") || exit 1
  cred=$(echo "$parsed" | sed -n '1p')
  sig=$(echo "$parsed" | sed -n '2p')
  local amount_gwei
  amount_gwei=$(echo "$parsed" | sed -n '3p')
  dep_pk=$(echo "$parsed" | sed -n '4p')
  assert_deposit_pubkey "$dep_pk" "$pubkey" || exit 1
  validate_deposit "$dep_pk" "$cred" "$amount_gwei" "$sig" "$genesis_root" || exit 1
  pubkey="$dep_pk"

  log_info "Network: $network"
  log_info "Validator pubkey: ${pubkey:0:10}...${pubkey: -4}"
  echo ""

  wallet_args=$(get_cast_wallet_args)
  if [[ "$delegated_mode" == true ]]; then
    log_info "DelegationHandler: $delegation_handler"
    deploy_cmd="cast send $delegation_handler 'createStakingPoolWithDelegatedFunds(bytes,bytes,bytes)' \"$pubkey\" \"$cred\" \"$sig\" -r $rpc_url $wallet_args"
    run_cast_or_paste "delegated-create" "$deploy_cmd" "10000" "" || exit 1
    staking_pool=$(staking_pool_from_handler "$delegation_handler" "$rpc_url")
    if [[ -z "$staking_pool" || "$staking_pool" == "0x0000000000000000000000000000000000000000" ]]; then
      log_error "Could not read staking pool address from DelegationHandler after create"
      exit 1
    fi
    log_success "Staking pool: $staking_pool"
  else
    staking_pool=$(predict_and_display_addresses "$factory" "$rpc_url" "$pubkey" | tr -d '[:space:]')
    echo ""
    deploy_cmd="cast send $factory 'deployStakingPoolContracts(bytes,bytes,bytes,address,address)' \"$pubkey\" \"$cred\" \"$sig\" $operator $shares --value 10000ether -r $rpc_url $wallet_args"
    run_cast_or_paste "deploy" "$deploy_cmd" "10000" "$staking_pool" || exit 1
  fi

  local validator_index
  validator_index=$(get_validator_index_from_api "$cl_base" "$pubkey")
  if [[ -z "$validator_index" ]]; then
    validator_index=$(wait_for_validator_registration "$cl_base" "$pubkey")
  else
    log_success "Registered (index $validator_index)."
  fi

  log_info "Waiting for activation proofs..."
  local activate_cmd
  activate_cmd=$(build_activation_cast "$factory" "$rpc_url" "$cl_base" "$pubkey" "$withdrawal_vault" "$validator_index") || exit 1
  run_cast_or_paste "activate" "$activate_cmd" "" "$staking_pool" || exit 1

  if [[ "$delegated_mode" == true ]]; then
    local deposit_bera amount_wei deposit_cmd
    read -r -p "Deposit remaining delegated BERA (whole number, blank to skip): " deposit_bera
    if [[ -n "$deposit_bera" ]]; then
      if ! [[ "$deposit_bera" =~ ^[0-9]+$ ]]; then
        log_error "Deposit amount must be a whole number of BERA"
        exit 1
      fi
      amount_wei=$(cast to-wei "$deposit_bera" ether 2>/dev/null) || {
        log_error "Could not convert deposit amount to wei"
        exit 1
      }
      deposit_cmd="cast send $delegation_handler 'depositDelegatedFunds(uint256)' $amount_wei -r $rpc_url $wallet_args"
      run_cast_or_paste "delegated-deposit" "$deposit_cmd" "$deposit_bera" "$staking_pool" || exit 1
    fi
  fi

  echo ""
  log_success "Done. Staking pool: $staking_pool"
  if [[ -f "$INSTALLER_RECEIPTS" ]]; then
    echo "Receipts: $INSTALLER_RECEIPTS"
  fi
}

main() {
  case "${1:-}" in
    -h|--help|help) print_usage ;;
    "")
      cmd_install
      ;;
    *)
      log_error "Unknown option: $1"
      print_usage
      exit 1
      ;;
  esac
}

main "$@"
