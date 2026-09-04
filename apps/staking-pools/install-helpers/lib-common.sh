#!/usr/bin/env bash
# Shared helpers for staking pool install scripts.
# Source: source "$SCRIPT_DIR/lib-common.sh"

# === LOGGING ===
log_error() { echo "[error] $*" >&2; }
log_info() { echo "[info] $*" >&2; }
log_success() { echo "[success] $*" >&2; }
log_warn() { echo "[warn] $*" >&2; }

bash_lowercase() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

load_env_if_present() {
  local script_dir="$1"
  local env_file="$script_dir/env.sh"
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    source "$env_file"
  fi
}

# === CAST OUTPUT ===
strip_scientific_notation() {
  local input="${1:-}"
  input=$(echo "$input" | awk '{print $1}')
  if [[ "$input" =~ ^-?[0-9]+(\.[0-9]+)?[eE][+-]?[0-9]+$ ]]; then
    echo "$input" | awk '{ printf "%.0f", $1 }'
  else
    echo "$input"
  fi
}

cast_call_clean() {
  local result
  result=$(cast call "$@")
  strip_scientific_notation "$result"
}

# === VALIDATION ===
normalize_evm_address() {
  local a="$1"
  a=$(echo "$a" | tr 'A-F' 'a-f')
  if [[ "$a" =~ ^0x[0-9a-f]{40}$ ]]; then
    echo "$a"
  else
    echo ""
  fi
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

normalize_validator_pubkey() {
  local pk="$1"
  pk=$(echo "$pk" | tr -d '[:space:]' | tr 'A-F' 'a-f')
  if [[ "$pk" =~ ^0x[0-9a-f]{96}$ ]]; then
    printf '%s' "$pk"
    return 0
  fi
  return 1
}

require_validator_pubkey() {
  local label="$1"
  local value="$2"
  local normalized
  normalized=$(normalize_validator_pubkey "$value") || {
    log_error "$label must be 0x followed by 96 hex characters (48-byte BLS pubkey)"
    return 1
  }
  printf '%s' "$normalized"
}

prompt_validator_pubkey() {
  local default="${VALIDATOR_PUBKEY:-}"
  local answer=""
  if [[ -n "$default" ]]; then
    read -r -p "Validator pubkey (0x...) [$default]: " answer
    answer=${answer:-$default}
  else
    read -r -p "Validator pubkey (0x...): " answer
  fi
  require_validator_pubkey "Validator pubkey" "$answer"
}

prompt_evm_address() {
  local label="$1"
  local default="${2:-}"
  local answer=""
  if [[ -n "$default" ]]; then
    read -r -p "$label [$default]: " answer
    answer=${answer:-$default}
  else
    read -r -p "$label (0x...): " answer
  fi
  require_evm_address "$label" "$answer"
}

# === DEPENDENCIES ===
have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

ensure_jq() {
  if ! have_cmd jq; then
    log_error "jq is required; please install jq"
    return 1
  fi
}

ensure_cast() {
  if ! have_cmd cast; then
    log_error "cast (foundry) is required; please install foundry"
    return 1
  fi
}

# === CHAIN CONSTANTS ===
readonly MAINNET_VALIDATOR_ROOT="0xdf609e3b062842c6425ff716aec2d2092c46455d9b2e1a2c9e32c6ba63ff0bda"
readonly BEPOLIA_VALIDATOR_ROOT="0x3cbcf75b02fe4750c592f1c1ff8b5500a74406f80f038e9ff250e2e294c5615e"
readonly STAKING_POOL_FACTORY_MAINNET="0xb79b43dBA821Cb67751276Ce050fF4111445fB99"
readonly STAKING_POOL_FACTORY_BEPOLIA="0x24b8223864d3936F56e5a24C4245ae7620471D4C"
readonly DELEGATION_HANDLER_FACTORY_MAINNET="0xAd17932a5B1aaeEa73D277a6AE670623F176E0D0"
readonly DELEGATION_HANDLER_FACTORY_BEPOLIA="0x0aEf09EC97bAc354d31F180b401454cB76abc395"
readonly BEACON_DEPOSIT_CONTRACT="0x4242424242424242424242424242424242424242"

get_rpc_url_for_network() {
  case "$1" in
    mainnet) echo "https://rpc.berachain.com" ;;
    bepolia) echo "https://bepolia.rpc.berachain.com" ;;
    *) echo "" ;;
  esac
}

get_factory_address_for_network() {
  case "$1" in
    mainnet) echo "$STAKING_POOL_FACTORY_MAINNET" ;;
    bepolia) echo "$STAKING_POOL_FACTORY_BEPOLIA" ;;
    *) echo "" ;;
  esac
}

get_delegation_handler_factory_for_network() {
  case "$1" in
    mainnet) echo "$DELEGATION_HANDLER_FACTORY_MAINNET" ;;
    bepolia) echo "$DELEGATION_HANDLER_FACTORY_BEPOLIA" ;;
    *) echo "" ;;
  esac
}

get_genesis_validator_root_for_network() {
  case "$1" in
    mainnet) echo "$MAINNET_VALIDATOR_ROOT" ;;
    bepolia) echo "$BEPOLIA_VALIDATOR_ROOT" ;;
    *) echo "" ;;
  esac
}

get_beacon_deposit_address() {
  echo "$BEACON_DEPOSIT_CONTRACT"
}

get_withdrawal_vault_for_network() {
  local network="$1"
  local rpc_url="${2:-}"
  local factory_addr
  factory_addr=$(get_factory_address_for_network "$network")
  if [[ -z "$rpc_url" ]]; then
    rpc_url=$(get_rpc_url_for_network "$network")
  fi
  cast_call_clean "$factory_addr" "withdrawalVault()(address)" -r "$rpc_url" 2>/dev/null || echo ""
}

get_cast_wallet_args() {
  if [[ -n "${PRIVATE_KEY:-}" ]]; then
    echo "--private-key $PRIVATE_KEY"
  else
    echo "--ledger"
  fi
}

append_cast_wallet_args() {
  local -n _argv=$1
  if [[ -n "${PRIVATE_KEY:-}" ]]; then
    _argv+=(--private-key "$PRIVATE_KEY")
  else
    _argv+=(--ledger)
  fi
}

format_cast_argv_for_display() {
  local -a display=("cast")
  local redact_next=0
  local arg
  for arg in "$@"; do
    if (( redact_next )); then
      display+=("[REDACTED]")
      redact_next=0
      continue
    fi
    if [[ "$arg" == "--private-key" ]]; then
      display+=("$arg")
      redact_next=1
      continue
    fi
    display+=("$arg")
  done
  printf '%q ' "${display[@]}"
  printf '\n'
}

redact_cast_cmd_for_display() {
  # Legacy string helper for printed cast one-liners (cold-signing display only).
  echo "$1" | sed -E 's/--private-key [^ ]+/--private-key [REDACTED]/g'
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

run_cast_or_paste() {
  local label="$1"
  local rpc_url="$2"
  shift 2
  local -a cast_argv=("$@")

  echo "" >&2
  log_info "$label command:"
  format_cast_argv_for_display "${cast_argv[@]}" >&2
  echo "" >&2

  local tx_hash=""
  if [[ -n "${PRIVATE_KEY:-}" ]]; then
    local ans
    read -r -p "Run this command now? [y/N] " ans
    if [[ "$ans" =~ ^[yY] ]]; then
      local out rc=0
      out=$(cast "${cast_argv[@]}" 2>&1) || rc=$?
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
  receipt=$(cast receipt "$tx_hash" -r "$rpc_url" --json 2>&1) || rc=$?
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
  printf '%s' "$tx_hash"
}

get_validator_index_from_api() {
  local api_url="$1"
  local pubkey="$2"

  ensure_jq

  local normalized_pk
  normalized_pk=$(normalize_validator_pubkey "$pubkey" 2>/dev/null) || {
    echo ""
    return
  }

  api_url="${api_url%/}"
  local response index
  response=$(curl -sS "${api_url}/eth/v1/beacon/states/head/validators/${normalized_pk}" 2>/dev/null) || {
    echo ""
    return
  }

  index=$(echo "$response" | jq -r '.data.index // empty' 2>/dev/null)
  if [[ -z "$index" || "$index" == "null" ]]; then
    echo ""
    return
  fi
  echo "$index"
}

get_delegation_handler() {
  local factory="$1"
  local pubkey="$2"
  local rpc="$3"
  cast_call_clean "$factory" "delegationHandlers(bytes)(address)" "$pubkey" -r "$rpc" 2>/dev/null \
    || echo "0x0000000000000000000000000000000000000000"
}

predict_and_display_addresses() {
  local factory_addr="$1"
  local rpc_url="$2"
  local pubkey="$3"

  if ! have_cmd cast; then
    log_error "cast not found; install foundry (https://book.getfoundry.sh/)"
    echo ""
    return
  fi

  local predicted_addrs
  predicted_addrs=$(cast call "$factory_addr" \
    "predictStakingPoolContractsAddresses(bytes)(address,address,address,address)" \
    "$pubkey" -r "$rpc_url" 2>/dev/null)
  if [[ -z "$predicted_addrs" ]]; then
    log_error "prediction call failed"
    echo ""
    return
  fi

  local normalized_addrs
  normalized_addrs=$(echo "$predicted_addrs" | tr -d '()' | tr ',' ' ' | tr '\n' ' ' | tr -s ' ' ' ')
  local smart_operator staking_pool staking_rewards_vault incentive_collector
  read -r smart_operator staking_pool staking_rewards_vault incentive_collector <<< "$normalized_addrs"

  if [[ -z "$staking_pool" ]]; then
    log_error "prediction call failed"
    echo ""
    return
  fi

  log_info "Predicted contract addresses:" >&2
  echo "  SmartOperator:       $smart_operator" >&2
  echo "  StakingPool:         $staking_pool" >&2
  echo "  StakingRewardsVault: $staking_rewards_vault" >&2
  echo "  IncentiveCollector:  $incentive_collector" >&2

  echo "$staking_pool"
}

network_from_rpc() {
  local rpc="$1"
  local chain_id rc=0
  chain_id=$(cast chain-id -r "$rpc" 2>&1) || rc=$?
  if (( rc != 0 )); then
    log_error "RPC failed eth_chainId: $chain_id"
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
