#!/usr/bin/env bash
set -euo pipefail

# Staking pool activation helper
# Run with --help for usage information

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-common.sh
source "$SCRIPT_DIR/lib-common.sh"

load_env "$SCRIPT_DIR"

SEND_MODE=0

print_usage() {
  cat <<'USAGE'
activate.sh

Activates a deployed staking pool for your validator.

Usage:
  activate.sh [--send]

Options:
  --send                    Broadcast the activation transaction immediately
                            (default: write command to generated/activation-command.sh)
  -h, --help                Show this help

The script uses the validator pubkey and withdrawal vault configured for this
install (via setup_staking_pool_env) and deterministically predicts the pool
address from the factory. The pool must already be deployed (use register.sh
first).

Output (default mode):
  generated/activation-command.sh

Note: Proofs are valid for exactly 10 minutes after generation (contract-
enforced MAX_TIMESTAMP_AGE). The generated script refuses to run after that
window.
USAGE
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      --send) SEND_MODE=1; shift ;;
      -h|--help) print_usage; exit 0 ;;
      *) log_error "Unknown arg: $1"; print_usage; exit 1 ;;
    esac
  done
}

# Map known revert selectors on the activation path to human-readable names.
# Keep in sync with:
#   contracts-staking-pools/src/interfaces/IStakingPoolContractsFactory.sol
#   contracts-staking-pools/src/helpers/BeaconRootsHelper.sol
#   contracts-staking-pools/src/core/StakingPool.sol
decode_activation_revert() {
  local msg="${1:-}"
  local lower
  lower=$(echo "$msg" | tr 'A-Z' 'a-z')
  case "$lower" in
    *0x7b5d09a5*) echo "InvalidInitialDepositAmount() — validator balance < 10000 ether (gwei units)" ;;
    *0xccea9e6f*) echo "InvalidOperator() — BeaconDeposit.getOperator(pubkey) != coreContracts.smartOperator" ;;
    *0x9be73159*) echo "InvalidWithdrawalCredentials() — validator WC != 0x010000…||withdrawalVault" ;;
    *0xb7d09497*) echo "InvalidTimestamp() — proof timestamp in the future or > 10 minutes old" ;;
    *0xa7baf889*) echo "InvalidBeaconBlockRoot() — EIP-4788 has no root for this timestamp (buffer miss)" ;;
    *0x09bde339*) echo "InvalidProof() — SSZ proof does not verify against the beacon block root" ;;
    *0xc52e3eff*) echo "InvalidBalance() — balanceLeaf does not encode the claimed validator balance" ;;
    *0x1390f2a1*) echo "IndexOutOfRange() — validatorIndex outside the registry limit" ;;
    *0x6cbf06ef*) echo "StakingPoolAlreadyActivated() — pool.isActive() is already true" ;;
    *) echo "$msg" ;;
  esac
}

# Pull a JSON blob from the node API. Errors out with a useful message instead
# of returning silent empty JSON that would hot-spin the proof loop.
fetch_json() {
  local url="$1"
  local label="${2:-$url}"
  local body http_status
  local tmp
  tmp=$(mktemp)
  # shellcheck disable=SC2064
  trap "rm -f '$tmp'" RETURN

  http_status=$(curl -sS -o "$tmp" -w "%{http_code}" "$url" 2>&1) || {
    log_error "curl failed for $label: $http_status"
    return 1
  }
  body=$(cat "$tmp")

  if [[ "$http_status" != "200" ]]; then
    log_error "$label returned HTTP $http_status: $(echo "$body" | head -c 200)"
    return 1
  fi
  if [[ -z "$body" ]]; then
    log_error "$label returned empty body"
    return 1
  fi
  # Must be valid JSON
  if ! echo "$body" | jq -e . >/dev/null 2>&1; then
    log_error "$label returned non-JSON response: $(echo "$body" | head -c 200)"
    return 1
  fi
  printf '%s' "$body"
}

main() {
  parse_args "$@"

  if ! setup_staking_pool_env; then
    exit 1
  fi
  ensure_jq || exit 1

  log_info "Network: $network"
  log_info "Validator pubkey: $pubkey"
  log_info "Node API: $node_api_url"
  log_info "Factory: $factory_addr"
  log_info "Withdrawal vault: $withdrawal_vault"
  echo ""

  # --- Predict pool address and confirm the contract is deployed ---
  local predicted_staking_pool
  predicted_staking_pool=$(predict_and_display_addresses "$factory_addr" "$rpc_url" "$pubkey")
  if [[ -z "$predicted_staking_pool" ]]; then
    exit 1
  fi
  predicted_staking_pool=$(echo "$predicted_staking_pool" | tr -d '[:space:]')
  echo ""

  local pool_code
  pool_code=$(cast code "$predicted_staking_pool" -r "$rpc_url" 2>/dev/null || echo "0x")
  if [[ -z "$pool_code" || "$pool_code" == "0x" ]]; then
    log_error "Staking pool contract not found at predicted address: $predicted_staking_pool"
    log_error "Deploy the pool first using register.sh"
    exit 1
  fi

  # --- Check activation via isActive() (the true activation flag). `paused()` is
  # not equivalent: the owner can pause an already-activated pool, and the pool
  # re-pauses itself on full exit. ---
  local is_active
  is_active=$(cast call "$predicted_staking_pool" "isActive()(bool)" -r "$rpc_url" 2>/dev/null | tr -d '[:space:]' || echo "")
  case "$is_active" in
    true)
      log_success "Pool is already activated (isActive=true) — no action needed"
      exit 0
      ;;
    false)
      log_info "Pool is deployed but not activated — proceeding"
      ;;
    *)
      log_error "Could not read isActive() from $predicted_staking_pool (got: '$is_active')"
      exit 1
      ;;
  esac

  # --- Preflight the two preconditions the contract enforces that have nothing
  # to do with proofs, so we can tell the operator *why* activation would fail
  # without spending any gas. ---

  local beacon_deposit core_smart_op beacon_deposit_op
  beacon_deposit=$(get_beacon_deposit_address)

  local core_contracts_raw
  core_contracts_raw=$(cast call "$factory_addr" \
      "getCoreContracts(bytes)((address,address,address,address))" \
      "$pubkey" -r "$rpc_url" 2>/dev/null || echo "")
  if [[ -n "$core_contracts_raw" ]]; then
    core_smart_op=$(echo "$core_contracts_raw" | tr -d '()' | awk -F',' '{print $1}' | tr -d '[:space:]' | tr 'A-F' 'a-f')
  else
    core_smart_op=""
  fi

  beacon_deposit_op=$(cast call "$beacon_deposit" \
      "getOperator(bytes)(address)" "$pubkey" -r "$rpc_url" 2>/dev/null \
      | tr -d '[:space:]' | tr 'A-F' 'a-f' || echo "")

  if [[ -z "$core_smart_op" || -z "$beacon_deposit_op" ]]; then
    log_warn "Could not verify BEACON_DEPOSIT.getOperator vs coreContracts.smartOperator; will rely on on-chain preflight."
  elif [[ "$core_smart_op" != "$beacon_deposit_op" ]]; then
    log_error "BEACON_DEPOSIT operator mismatch — the contract will revert with InvalidOperator()."
    log_error "  BeaconDeposit.getOperator(pubkey): $beacon_deposit_op"
    log_error "  CoreContracts.smartOperator:       $core_smart_op"
    log_error "Re-run register.sh or investigate why the beacon deposit record differs."
    exit 1
  else
    log_info "BeaconDeposit.getOperator matches coreContracts.smartOperator"
  fi

  # What the factory expects the validator's withdrawal_credentials to be.
  local withdrawal_vault_lower expected_wc_lower
  withdrawal_vault_lower=$(echo "$withdrawal_vault" | tr 'A-F' 'a-f')
  expected_wc_lower="0x010000000000000000000000${withdrawal_vault_lower#0x}"

  # --- Resolve validator index on the beacon chain ---
  local validator_index
  validator_index=$(get_validator_index_from_api "http://$node_api_url" "$pubkey")
  if [[ -z "$validator_index" ]]; then
    log_error "Validator not yet registered on beacon chain"
    log_error "Wait for validator registration before activating the pool"
    exit 1
  fi
  if ! [[ "$validator_index" =~ ^[0-9]+$ ]]; then
    log_error "Unexpected validator index format: '$validator_index'"
    exit 1
  fi
  log_success "Validator registered on beacon chain (index: $validator_index)"
  echo ""

  # --- Pin head slot once and fetch all three proofs at that slot, so the slot
  # cannot race between calls. ---
  local head_json slot
  head_json=$(fetch_json "http://${node_api_url}/eth/v1/beacon/headers/head" "beacon head") || exit 1
  slot=$(echo "$head_json" | jq -r '.data.header.message.slot // empty')
  if [[ -z "$slot" || ! "$slot" =~ ^[0-9]+$ ]]; then
    log_error "Could not read head slot from beacon API (got: '$slot')"
    exit 1
  fi
  log_info "Pinned CL slot: $slot"

  local pubkey_proof_json credentials_proof_json balance_proof_json
  pubkey_proof_json=$(fetch_json \
    "http://${node_api_url}/bkit/v1/proof/validator_pubkey/${slot}/${validator_index}" \
    "validator_pubkey proof") || exit 1
  credentials_proof_json=$(fetch_json \
    "http://${node_api_url}/bkit/v1/proof/validator_credentials/${slot}/${validator_index}" \
    "validator_credentials proof") || exit 1
  balance_proof_json=$(fetch_json \
    "http://${node_api_url}/bkit/v1/proof/validator_balance/${slot}/${validator_index}" \
    "validator_balance proof") || exit 1

  # Defensive: each proof response includes its own beacon_block_header.slot;
  # confirm they all equal the pinned slot. Compare numerically — the standard
  # beacon headers endpoint returns slot as a decimal string, but the bkit
  # proof endpoints return it hex-encoded ("0x120ba31").
  local j_var got_slot got_slot_dec
  local slot_dec=$((10#$slot))
  for j_var in pubkey_proof_json credentials_proof_json balance_proof_json; do
    got_slot=$(eval "echo \"\$$j_var\"" | jq -r '.beacon_block_header.slot // empty')
    if [[ -z "$got_slot" ]]; then
      log_error "Proof $j_var missing beacon_block_header.slot"
      exit 1
    fi
    if [[ "$got_slot" == 0x* ]]; then
      got_slot_dec=$((got_slot))
    elif [[ "$got_slot" =~ ^[0-9]+$ ]]; then
      got_slot_dec=$((10#$got_slot))
    else
      log_error "Proof $j_var returned non-numeric slot: '$got_slot'"
      exit 1
    fi
    if (( got_slot_dec != slot_dec )); then
      log_error "Proof $j_var reports slot $got_slot_dec ('$got_slot') but we pinned slot $slot_dec"
      exit 1
    fi
  done
  log_success "All proofs pinned to slot $slot_dec"

  # --- Derive EIP-4788 timestamp. On Berachain beacon-kit, CL slot == EL block
  # number; EIP-4788 stores the parent beacon root at each EL block's timestamp,
  # so we read the timestamp of EL block (slot+1). ---
  local el_block_number
  el_block_number=$((10#$slot + 1))
  log_info "Reading EIP-4788 timestamp from EL block $el_block_number..."

  local block_json=""
  for _ in $(seq 1 60); do
    if block_json=$(cast block "$el_block_number" --json -r "$rpc_url" 2>/dev/null); then
      if [[ -n "$block_json" && "$block_json" != "null" ]]; then
        break
      fi
    fi
    sleep 1
  done
  if [[ -z "$block_json" || "$block_json" == "null" ]]; then
    log_error "Timed out waiting for EL block $el_block_number on $rpc_url"
    exit 1
  fi

  local timestamp_hex timestamp_dec
  timestamp_hex=$(echo "$block_json" | jq -r '.timestamp // empty')
  if [[ -z "$timestamp_hex" ]]; then
    log_error "Failed to extract timestamp from EL block $el_block_number"
    exit 1
  fi
  timestamp_dec=$((timestamp_hex))
  log_success "EIP-4788 timestamp: $timestamp_dec"
  echo ""

  # --- Extract validator fields from the proofs ---
  local v_pubkey v_withdrawal_creds v_balance v_wc_lower
  v_pubkey=$(echo "$pubkey_proof_json" | jq -r '.validator_pubkey')
  v_withdrawal_creds=$(echo "$credentials_proof_json" | jq -r '.validator_withdrawal_credentials')
  v_balance=$(echo "$balance_proof_json" | jq -r '.validator_balance')

  if [[ -z "$v_pubkey" || -z "$v_withdrawal_creds" || -z "$v_balance" ]]; then
    log_error "Missing fields in proof responses (pubkey='$v_pubkey' wc='$v_withdrawal_creds' bal='$v_balance')"
    exit 1
  fi

  # Verify withdrawal credentials match what the factory requires, so we can
  # fail loudly instead of reverting on-chain.
  v_wc_lower=$(echo "$v_withdrawal_creds" | tr 'A-F' 'a-f')
  if [[ "$v_wc_lower" != "$expected_wc_lower" ]]; then
    log_error "Validator withdrawal credentials mismatch — the contract will revert with InvalidWithdrawalCredentials()."
    log_error "  Validator WC: $v_withdrawal_creds"
    log_error "  Expected WC:  $expected_wc_lower"
    log_error "The validator was registered with different credentials than this install's withdrawal vault."
    exit 1
  fi

  # Balance must be a decimal or 0x-hex integer. Force base-10 to avoid bash's
  # default-octal interpretation of strings with leading zeros.
  if ! [[ "$v_balance" =~ ^(0x[0-9a-fA-F]+|[1-9][0-9]*|0)$ ]]; then
    log_error "Unexpected validator_balance format from API: '$v_balance'"
    exit 1
  fi
  # shellcheck disable=SC2004
  if [[ "$v_balance" == 0x* ]]; then
    v_balance_dec=$((v_balance))
  else
    v_balance_dec=$((10#$v_balance))
  fi
  # FIRST_DEPOSIT_AMOUNT_GWEI = 10_000 gwei = 10^13 (bare integer in the contract)
  if (( v_balance_dec < 10000000000000 )); then
    log_error "Validator balance too low for activation: $v_balance_dec (need >= 10000000000000)"
    log_error "Contract will revert with InvalidInitialDepositAmount()."
    exit 1
  fi
  log_info "Validator balance at slot $slot: $v_balance_dec gwei"

  # --- Format proof arrays for cast ---
  local pubkey_proof_cast withdrawal_creds_proof_cast balance_proof_cast balance_leaf
  pubkey_proof_cast=$(echo "$pubkey_proof_json" | jq -r '.validator_pubkey_proof | join(",")')
  withdrawal_creds_proof_cast=$(echo "$credentials_proof_json" | jq -r '.withdrawal_credentials_proof | join(",")')
  balance_proof_cast=$(echo "$balance_proof_json" | jq -r '.balance_proof | join(",")')
  balance_leaf=$(echo "$balance_proof_json" | jq -r '.balance_leaf')

  if [[ -z "$pubkey_proof_cast" || -z "$withdrawal_creds_proof_cast" || -z "$balance_proof_cast" || -z "$balance_leaf" ]]; then
    log_error "Missing proof arrays in API response"
    exit 1
  fi

  # --- Preflight via cast call (eth_call). Catches InvalidProof / InvalidBalance
  # / InvalidTimestamp / InvalidBeaconBlockRoot before we ask the user to sign. ---
  log_info "Preflighting activateStakingPool via cast call..."
  local preflight_out preflight_rc=0
  preflight_out=$(cast call "$factory_addr" \
      'activateStakingPool((bytes,bytes,uint64,uint64),(bytes32[],bytes32[],bytes32[],bytes32),uint64)' \
      "($v_pubkey,$v_withdrawal_creds,$v_balance_dec,$validator_index)" \
      "([$pubkey_proof_cast],[$withdrawal_creds_proof_cast],[$balance_proof_cast],$balance_leaf)" \
      "$timestamp_dec" \
      -r "$rpc_url" 2>&1) || preflight_rc=$?

  if (( preflight_rc != 0 )); then
    log_error "Preflight revert: $(decode_activation_revert "$preflight_out")"
    log_error "Raw: $(echo "$preflight_out" | head -c 400)"
    exit 1
  fi
  log_success "Preflight OK"
  echo ""

  # --- Emit the generated script (and optionally send it now) ---
  mkdir -p generated
  local cmd_file="generated/activation-command.sh"
  local wallet_args
  wallet_args=$(get_cast_wallet_args)

  local expiry expiry_iso now_iso
  expiry=$((timestamp_dec + 600))
  if expiry_iso=$(date -u -r "$expiry" +"%Y-%m-%d %H:%M:%S UTC" 2>/dev/null); then
    :
  elif expiry_iso=$(date -u -d "@$expiry" +"%Y-%m-%d %H:%M:%S UTC" 2>/dev/null); then
    :
  else
    expiry_iso="unix $expiry"
  fi
  now_iso=$(date -u +"%Y-%m-%d %H:%M:%S UTC")

  cat > "$cmd_file" <<EOF
#!/usr/bin/env bash
set -euo pipefail
# Activation command for staking pool
# Validator pubkey:   $v_pubkey
# Validator index:    $validator_index
# Pinned CL slot:     $slot
# EIP-4788 timestamp: $timestamp_dec
# Generated:          $now_iso
# Hard expiry:        $expiry_iso (timestamp + 600s)

now=\$(date -u +%s)
if (( now >= $expiry )); then
  echo "[error] Proof window expired at $expiry_iso. Re-run activate.sh to regenerate." >&2
  exit 10
fi

cast send $factory_addr \\
  'activateStakingPool((bytes,bytes,uint64,uint64),(bytes32[],bytes32[],bytes32[],bytes32),uint64)' \\
  "($v_pubkey,$v_withdrawal_creds,$v_balance_dec,$validator_index)" \\
  "([$pubkey_proof_cast],[$withdrawal_creds_proof_cast],[$balance_proof_cast],$balance_leaf)" \\
  "$timestamp_dec" \\
  -r $rpc_url $wallet_args
EOF

  chmod +x "$cmd_file"

  log_success "Activation command written to: $cmd_file"
  log_warn "Hard expiry: $expiry_iso (contract enforces MAX_TIMESTAMP_AGE = 10 min)"

  if (( SEND_MODE == 1 )); then
    log_info "Broadcasting now (--send)..."
    exec "$cmd_file"
  else
    log_info "Next step: ./$cmd_file (or re-run with --send to broadcast immediately)"
  fi
}

main "$@"
