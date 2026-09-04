#!/usr/bin/env bash
set -euo pipefail

# Remote staking pool installer — cast commands with optional auto-run.
# Usage: ./install.sh | --help

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-common.sh
source "$SCRIPT_DIR/lib-common.sh"
load_env_if_present "$SCRIPT_DIR"

readonly INSTALLER_RECEIPTS="$SCRIPT_DIR/staking-pool-receipts.jsonl"
readonly DEPOSIT_AMOUNT_GWEI="10000000000000"
readonly REGISTRATION_WAIT_MAX=360
readonly ACTIVATION_MAX_AGE=600
ACTIVATION_TIMESTAMP=""
ACTIVATION_CAST_ARGV=()

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
  http_status=$(curl -sS -o "$tmp" -w "%{http_code}" "${base}/eth/v1/node/syncing" 2>&1) || {
    rm -f "$tmp"
    log_error "CL Node API unreachable at $base"
    return 1
  }
  body=$(cat "$tmp")
  rm -f "$tmp"
  if [[ "$http_status" != "200" ]]; then
    log_error "CL Node API returned HTTP $http_status: $(echo "$body" | head -c 200)"
    return 1
  fi
  if ! echo "$body" | jq -e . >/dev/null 2>&1; then
    log_error "CL Node API returned non-JSON from ${base}/eth/v1/node/syncing"
    return 1
  fi
  local is_syncing is_optimistic
  is_syncing=$(echo "$body" | jq -r '.data.is_syncing // empty')
  is_optimistic=$(echo "$body" | jq -r '.data.is_optimistic // empty')
  if [[ "$is_syncing" == "true" ]]; then
    log_error "CL Node API reports syncing=true — wait for sync before landing a pool"
    return 1
  fi
  if [[ "$is_optimistic" == "true" ]]; then
    log_warn "CL Node API reports is_optimistic=true — activation proofs may be unreliable"
  fi
  printf '%s' "$base"
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

  log_info "Run deposit validate on the validator. You should see: ✅ Deposit message is valid!"
  echo "  beacond --home <validator-data-dir> deposit validate \\"
  echo "    $pubkey $cred $amount_gwei $sig -g $genesis_root"
  local ans
  read -r -p "Did deposit validate print ✅ Deposit message is valid!? [y/N] " ans
  if [[ ! "$ans" =~ ^[yY] ]]; then
    log_error "Confirm deposit validate on the validator before continuing"
    return 1
  fi
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
  handler_pubkey=$(normalize_validator_pubkey "$handler_pubkey" 2>/dev/null || echo "")
  local normalized_pk
  normalized_pk=$(normalize_validator_pubkey "$pubkey" 2>/dev/null || echo "")
  if [[ -z "$handler_pubkey" || "$handler_pubkey" != "$normalized_pk" ]]; then
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
  local default=""
  if [[ -n "${FUNDING_ADDRESS:-}" ]]; then
    default=$(normalize_evm_address "$FUNDING_ADDRESS" || true)
  fi
  prompt_evm_address "Funding wallet address" "$default"
}

run_install_cast_or_paste() {
  local label="$1"
  local amount="${2:-}"
  local pool="${3:-}"
  shift 3

  if [[ "$label" == "activate" ]]; then
    log_warn "Activation proofs expire ${ACTIVATION_MAX_AGE}s after generation — run the command promptly"
  fi

  local tx_hash
  tx_hash=$(run_cast_or_paste "$label" "$EL_RPC_URL" "$@") || return 1
  append_receipt "$label" "$tx_hash" "$amount" "$pool"
  printf '%s' "$tx_hash"
}

wait_for_validator_registration() {
  local cl_base="$1"
  local pubkey="$2"
  local index=""
  local attempt=0
  log_info "Waiting for validator registration on beacon chain..."
  while [[ -z "$index" ]]; do
    (( attempt++ )) || true
    if (( attempt > REGISTRATION_WAIT_MAX )); then
      log_error "Timed out waiting for validator registration after $((REGISTRATION_WAIT_MAX * 5))s"
      return 1
    fi
    index=$(get_validator_index_from_api "$cl_base" "$pubkey")
    if [[ -n "$index" ]]; then
      log_success "Registered (index $index)."
      printf '%s' "$index"
      return 0
    fi
    if (( attempt % 12 == 0 )); then
      log_info "Still waiting for registration (attempt $attempt/$REGISTRATION_WAIT_MAX)..."
    fi
    sleep 5
  done
}

fetch_json() {
  local url="$1"
  local label="${2:-$url}"
  local body http_status tmp
  tmp=$(mktemp)
  http_status=$(curl -sS -o "$tmp" -w "%{http_code}" "$url" 2>&1) || {
    rm -f "$tmp"
    log_error "curl failed for $label"
    return 1
  }
  body=$(cat "$tmp")
  rm -f "$tmp"
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

decode_activation_revert() {
  local msg="${1:-}"
  local lower
  lower=$(echo "$msg" | tr 'A-F' 'a-f')
  case "$lower" in
    *0x7b5d09a5*) echo "InvalidInitialDepositAmount() — validator balance < 10000 ether" ;;
    *0xccea9e6f*) echo "InvalidOperator() — BeaconDeposit.getOperator(pubkey) != smartOperator" ;;
    *0x9be73159*) echo "InvalidWithdrawalCredentials() — validator WC != withdrawal vault" ;;
    *0xb7d09497*) echo "InvalidTimestamp() — proof timestamp in the future or > 10 minutes old" ;;
    *0xa7baf889*) echo "InvalidBeaconBlockRoot() — EIP-4788 root missing for timestamp" ;;
    *0x09bde339*) echo "InvalidProof() — SSZ proof failed" ;;
    *0xc52e3eff*) echo "InvalidBalance() — balanceLeaf mismatch" ;;
    *0x6cbf06ef*) echo "StakingPoolAlreadyActivated() — pool.isActive() is already true" ;;
    *) echo "$msg" ;;
  esac
}

assert_proof_slots_match() {
  local pinned_slot="$1"
  local slot_dec="$((10#$pinned_slot))"
  shift
  local json_var got_slot got_slot_dec
  for json_var in "$@"; do
    got_slot=$(echo "$json_var" | jq -r '.beacon_block_header.slot // empty')
    if [[ -z "$got_slot" ]]; then
      log_error "Proof response missing beacon_block_header.slot"
      return 1
    fi
    if [[ "$got_slot" == 0x* ]]; then
      got_slot_dec=$((got_slot))
    else
      got_slot_dec=$((10#$got_slot))
    fi
    if (( got_slot_dec != slot_dec )); then
      log_error "Proof slot $got_slot_dec does not match pinned slot $slot_dec"
      return 1
    fi
  done
  return 0
}

assert_pool_ready_for_activation() {
  local factory="$1"
  local rpc="$2"
  local staking_pool="$3"
  local pubkey="$4"
  local withdrawal_vault="$5"

  local pool_code
  pool_code=$(cast code "$staking_pool" -r "$rpc" 2>/dev/null || echo "0x")
  if [[ -z "$pool_code" || "$pool_code" == "0x" ]]; then
    log_error "Staking pool contract not deployed at $staking_pool"
    return 1
  fi

  local is_active
  is_active=$(cast call "$staking_pool" "isActive()(bool)" -r "$rpc" 2>/dev/null | tr -d '[:space:]' || echo "")
  if [[ "$is_active" == "true" ]]; then
    log_success "Pool is already activated (isActive=true)"
    return 2
  fi
  if [[ "$is_active" != "false" ]]; then
    log_error "Could not read isActive() from $staking_pool"
    return 1
  fi

  local beacon_deposit core_contracts_raw core_smart_op beacon_deposit_op
  beacon_deposit=$(get_beacon_deposit_address)
  core_contracts_raw=$(cast call "$factory" \
    "getCoreContracts(bytes)((address,address,address,address))" \
    "$pubkey" -r "$rpc" 2>/dev/null || echo "")
  if [[ -n "$core_contracts_raw" ]]; then
    core_smart_op=$(echo "$core_contracts_raw" | tr -d '()' | awk -F',' '{print $1}' | tr -d '[:space:]' | tr 'A-F' 'a-f')
    beacon_deposit_op=$(cast call "$beacon_deposit" "getOperator(bytes)(address)" "$pubkey" -r "$rpc" 2>/dev/null \
      | tr -d '[:space:]' | tr 'A-F' 'a-f' || echo "")
    if [[ -n "$core_smart_op" && -n "$beacon_deposit_op" && "$core_smart_op" != "$beacon_deposit_op" ]]; then
      log_error "BeaconDeposit.getOperator ($beacon_deposit_op) != smartOperator ($core_smart_op)"
      return 1
    fi
  fi

  local withdrawal_vault_lower expected_wc_lower v_wc_lower v_wc
  withdrawal_vault_lower=$(echo "$withdrawal_vault" | tr 'A-F' 'a-f')
  expected_wc_lower="0x010000000000000000000000${withdrawal_vault_lower#0x}"
  v_wc=$(cast call "$beacon_deposit" "getWithdrawalCredentials(bytes)(bytes32)" "$pubkey" -r "$rpc" 2>/dev/null || echo "")
  if [[ -n "$v_wc" ]]; then
    v_wc_lower=$(echo "$v_wc" | tr 'A-F' 'a-f')
    if [[ "$v_wc_lower" != "$expected_wc_lower" ]]; then
      log_error "Validator withdrawal credentials mismatch (expected $expected_wc_lower, got $v_wc_lower)"
      return 1
    fi
  fi

  return 0
}

build_activation_cast() {
  local factory="$1"
  local rpc="$2"
  local cl_base="$3"
  local pubkey="$4"
  local withdrawal_vault="$5"
  local validator_index="$6"
  local staking_pool="$7"

  local ready_rc=0
  assert_pool_ready_for_activation "$factory" "$rpc" "$staking_pool" "$pubkey" "$withdrawal_vault" || ready_rc=$?
  if (( ready_rc == 2 )); then
    log_info "Activation skipped — pool already active"
    return 2
  fi
  if (( ready_rc != 0 )); then
    return 1
  fi

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

  assert_proof_slots_match "$slot" "$pubkey_proof_json" "$credentials_proof_json" "$balance_proof_json" || return 1

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
  ACTIVATION_TIMESTAMP="$timestamp_dec"

  local v_pubkey v_withdrawal_creds v_balance v_balance_dec
  v_pubkey=$(echo "$pubkey_proof_json" | jq -r '.validator_pubkey')
  v_withdrawal_creds=$(echo "$credentials_proof_json" | jq -r '.validator_withdrawal_credentials')
  v_balance=$(echo "$balance_proof_json" | jq -r '.validator_balance')
  if [[ -z "$v_pubkey" || -z "$v_withdrawal_creds" || -z "$v_balance" ]]; then
    log_error "Missing fields in proof responses"
    return 1
  fi

  local expected_wc_lower withdrawal_vault_lower v_wc_lower
  withdrawal_vault_lower=$(echo "$withdrawal_vault" | tr 'A-F' 'a-f')
  expected_wc_lower="0x010000000000000000000000${withdrawal_vault_lower#0x}"
  v_wc_lower=$(echo "$v_withdrawal_creds" | tr 'A-F' 'a-f')
  if [[ "$v_wc_lower" != "$expected_wc_lower" ]]; then
    log_error "Proof withdrawal credentials mismatch (expected $expected_wc_lower)"
    return 1
  fi

  if [[ "$v_balance" == 0x* ]]; then
    v_balance_dec=$((v_balance))
  else
    v_balance_dec=$((10#$v_balance))
  fi
  if (( v_balance_dec < DEPOSIT_AMOUNT_GWEI )); then
    log_error "Validator balance $v_balance_dec gwei is below required $DEPOSIT_AMOUNT_GWEI"
    return 1
  fi

  local pubkey_proof_cast withdrawal_creds_proof_cast balance_proof_cast balance_leaf
  pubkey_proof_cast=$(echo "$pubkey_proof_json" | jq -r '.validator_pubkey_proof | join(",")')
  withdrawal_creds_proof_cast=$(echo "$credentials_proof_json" | jq -r '.withdrawal_credentials_proof | join(",")')
  balance_proof_cast=$(echo "$balance_proof_json" | jq -r '.balance_proof | join(",")')
  balance_leaf=$(echo "$balance_proof_json" | jq -r '.balance_leaf')
  if [[ -z "$pubkey_proof_cast" || -z "$withdrawal_creds_proof_cast" || -z "$balance_proof_cast" || -z "$balance_leaf" ]]; then
    log_error "Missing proof arrays in API response"
    return 1
  fi

  local preflight_out preflight_rc=0
  preflight_out=$(cast call "$factory" \
    'activateStakingPool((bytes,bytes,uint64,uint64),(bytes32[],bytes32[],bytes32[],bytes32),uint64)' \
    "($v_pubkey,$v_withdrawal_creds,$v_balance_dec,$validator_index)" \
    "([$pubkey_proof_cast],[$withdrawal_creds_proof_cast],[$balance_proof_cast],$balance_leaf)" \
    "$timestamp_dec" \
    -r "$rpc" 2>&1) || preflight_rc=$?
  if (( preflight_rc != 0 )); then
    log_error "Activation preflight failed: $(decode_activation_revert "$preflight_out")"
    return 1
  fi
  log_success "Activation preflight OK (timestamp $timestamp_dec, valid ~${ACTIVATION_MAX_AGE}s)"

  ACTIVATION_CAST_ARGV=(
    send "$factory" 'activateStakingPool((bytes,bytes,uint64,uint64),(bytes32[],bytes32[],bytes32[],bytes32),uint64)'
    "($v_pubkey,$v_withdrawal_creds,$v_balance_dec,$validator_index)"
    "([$pubkey_proof_cast],[$withdrawal_creds_proof_cast],[$balance_proof_cast],$balance_leaf)"
    "$timestamp_dec"
    -r "$rpc"
  )
  append_cast_wallet_args ACTIVATION_CAST_ARGV
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

Optional defaults (still prompted; press Enter to accept):
  VALIDATOR_PUBKEY    Validator pubkey
  FUNDING_ADDRESS     Funding wallet (cold signing; skipped when PRIVATE_KEY set)
  OPERATOR_ADDRESS    Self-funded operator address
  SHARES_RECIPIENT    Self-funded shares recipient

Optional env.sh in this directory is sourced when present.
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
  withdrawal_vault=$(get_withdrawal_vault_for_network "$network" "$rpc_url")
  if [[ -z "$factory" || -z "$withdrawal_vault" ]]; then
    log_error "Could not resolve factory or withdrawal vault for $network"
    exit 1
  fi

  local pubkey operator shares funding cred sig dep_pk parsed pasted line
  local delegated_mode=false delegation_handler="" staking_pool
  local -a deploy_argv deposit_argv

  pubkey=$(prompt_validator_pubkey) || exit 1

  delegation_handler=$(lookup_delegation_handler "$network" "$pubkey" "$rpc_url" 2>/dev/null || true)
  if [[ -n "$delegation_handler" ]]; then
    assert_delegated_landing_ready "$delegation_handler" "$pubkey" "$rpc_url" || exit 1
    delegated_mode=true
    log_info "Delegated landing mode — using DelegationHandler (not self-funded deploy)"
  else
    log_warn "No DelegationHandler for this pubkey — self-funded deploy (10,000 BERA from your wallet + gas)"
    funding=$(funding_address) || exit 1
    local op_default="$funding" shares_default="$funding"
    if [[ -n "${OPERATOR_ADDRESS:-}" ]]; then
      op_default=$(normalize_evm_address "$OPERATOR_ADDRESS" || echo "$funding")
      [[ -z "$op_default" ]] && op_default="$funding"
    fi
    if [[ -n "${SHARES_RECIPIENT:-}" ]]; then
      shares_default=$(normalize_evm_address "$SHARES_RECIPIENT" || echo "$funding")
      [[ -z "$shares_default" ]] && shares_default="$funding"
    fi
    operator=$(prompt_evm_address "Operator address" "$op_default") || exit 1
    shares=$(prompt_evm_address "Shares recipient" "$shares_default") || exit 1
  fi

  echo ""
  log_info "On the validator, run beacond deposit create-validator:"
  echo "  beacond --home <validator-data-dir> deposit create-validator \\"
  echo "    $withdrawal_vault $DEPOSIT_AMOUNT_GWEI -g $genesis_root"
  echo ""
  log_info "Then verify on the validator. You should see: ✅ Deposit message is valid!"
  echo "  beacond --home <validator-data-dir> deposit validate \\"
  echo "    <pubkey> <credentials> <amount> <signature> -g $genesis_root"
  echo "  (use the four values from create-validator output)"
  echo ""
  echo "Paste the full beacond output, then a blank line:"
  pasted=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" && -n "$pasted" ]] && break
    pasted+="${line}"$'\n'
  done
  if [[ -z "$pasted" ]]; then
    log_error "No deposit output pasted"
    exit 1
  fi
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

  if [[ "$delegated_mode" == true ]]; then
    log_info "DelegationHandler: $delegation_handler"
    deploy_argv=(send "$delegation_handler" 'createStakingPoolWithDelegatedFunds(bytes,bytes,bytes)' "$pubkey" "$cred" "$sig" -r "$rpc_url")
    append_cast_wallet_args deploy_argv
    run_install_cast_or_paste "delegated-create" "10000" "" "${deploy_argv[@]}" || exit 1
    staking_pool=$(staking_pool_from_handler "$delegation_handler" "$rpc_url")
    if [[ -z "$staking_pool" || "$staking_pool" == "0x0000000000000000000000000000000000000000" ]]; then
      log_error "Could not read staking pool address from DelegationHandler after create"
      exit 1
    fi
    log_success "Staking pool: $staking_pool"
  else
    staking_pool=$(predict_and_display_addresses "$factory" "$rpc_url" "$pubkey" | tr -d '[:space:]')
    if [[ -z "$staking_pool" ]]; then
      log_error "Could not predict staking pool address"
      exit 1
    fi
    local pool_code
    pool_code=$(cast code "$staking_pool" -r "$rpc_url" 2>/dev/null || echo "0x")
    if [[ -n "$pool_code" && "$pool_code" != "0x" ]]; then
      log_error "Staking pool already deployed at $staking_pool — refusing duplicate deploy"
      exit 1
    fi
    echo ""
    deploy_argv=(send "$factory" 'deployStakingPoolContracts(bytes,bytes,bytes,address,address)' "$pubkey" "$cred" "$sig" "$operator" "$shares" --value 10000ether -r "$rpc_url")
    append_cast_wallet_args deploy_argv
    run_install_cast_or_paste "deploy" "10000" "$staking_pool" "${deploy_argv[@]}" || exit 1
  fi

  local validator_index
  validator_index=$(get_validator_index_from_api "$cl_base" "$pubkey")
  if [[ -z "$validator_index" ]]; then
    validator_index=$(wait_for_validator_registration "$cl_base" "$pubkey")
  else
    log_success "Registered (index $validator_index)."
  fi

  log_info "Waiting for activation proofs..."
  local activate_rc activate_attempt=0
  while (( activate_attempt < 3 )); do
    (( activate_attempt++ )) || true
    build_activation_cast "$factory" "$rpc_url" "$cl_base" "$pubkey" "$withdrawal_vault" "$validator_index" "$staking_pool"
    activate_rc=$?
    if (( activate_rc == 2 )); then
      break
    fi
    if (( activate_rc != 0 )); then
      exit 1
    fi
    if [[ -n "${PRIVATE_KEY:-}" && -n "$ACTIVATION_TIMESTAMP" ]]; then
      local now_ts age
      now_ts=$(date +%s)
      age=$((now_ts - ACTIVATION_TIMESTAMP))
      if (( age > ACTIVATION_MAX_AGE - 60 )); then
        log_warn "Activation proofs near expiry — regenerating"
        continue
      fi
    fi
    if run_install_cast_or_paste "activate" "" "$staking_pool" "${ACTIVATION_CAST_ARGV[@]}"; then
      break
    fi
    if (( activate_attempt >= 3 )); then
      log_error "Activation failed after $activate_attempt attempts"
      exit 1
    fi
    log_warn "Activation failed — regenerating proofs (attempt $activate_attempt/3)"
  done

  if [[ "$delegated_mode" == true ]]; then
    local deposit_bera amount_wei
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
      deposit_argv=(send "$delegation_handler" 'depositDelegatedFunds(uint256)' "$amount_wei" -r "$rpc_url")
      append_cast_wallet_args deposit_argv
      run_install_cast_or_paste "delegated-deposit" "$deposit_bera" "$staking_pool" "${deposit_argv[@]}" || exit 1
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
    -h|--help|help)
      print_usage
      exit 0
      ;;
    "")
      cmd_install
      exit 0
      ;;
    *)
      log_error "Unknown option: $1"
      print_usage
      exit 1
      ;;
  esac
}

main "$@"
