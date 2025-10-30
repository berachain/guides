#!/usr/bin/env bash
# Common library functions for staking pool bash helpers
# Source this file in scripts: source "$SCRIPT_DIR/lib-common.sh"

# === LOGGING ===
log_error() { echo "[error] $*" >&2; }
log_info() { echo "[info] $*"; }
log_success() { echo "[success] $*"; }
log_warn() { echo "[warn] $*"; }

# Deprecated aliases for backward compatibility
err() { log_error "$@"; }

# === CAST OUTPUT HANDLING ===
strip_scientific_notation() {
  # Cast returns "240000000000000000000000 [2.4e23]" for large numbers
  # This extracts just the decimal number
  echo "$1" | awk '{print $1}'
}

cast_from_wei_safe() {
  # Safely convert wei to ether, handling scientific notation
  local wei_amount="$1"
  local unit="${2:-ether}"
  
  # Strip scientific notation if present
  wei_amount=$(echo "$wei_amount" | awk '{print $1}')

  # Guard: must be a non-empty unsigned integer (base-10)
  if [[ -z "$wei_amount" || ! "$wei_amount" =~ ^[0-9]+$ ]]; then
    # Return 0 with 18 decimals to keep formatting consistent
    echo "0.000000000000000000"
    return 0
  fi

  # Convert to ether
  cast from-wei "$wei_amount" "$unit"
}

cast_call_clean() {
  # Wrapper for cast call that strips scientific notation from output
  local result
  result=$(cast call "$@")
  strip_scientific_notation "$result"
}

# === VALIDATION ===
normalize_evm_address() {
  # Normalize an EVM address to lowercase if valid; returns empty if invalid
  local a="$1"
  a=$(echo "$a" | tr 'A-F' 'a-f')
  if [[ "$a" =~ ^0x[0-9a-f]{40}$ ]]; then
    echo "$a"
  else
    echo ""
  fi
}

validate_amount() {
  # Validates that an amount is a positive number
  local amount="$1"
  local name="${2:-amount}"
  
  if [[ -z "$amount" ]]; then
    log_error "$name is required"
    return 1
  fi
  
  # Check if it's a valid positive number (int or decimal)
  if ! [[ "$amount" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    log_error "$name must be a positive number (got: $amount)"
    return 1
  fi
  
  # Check if it's greater than zero
  if (( $(echo "$amount <= 0" | bc -l) )); then
    log_error "$name must be greater than zero"
    return 1
  fi
  
  return 0
}

# === DEPENDENCY CHECKS ===
have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

ensure_jq() {
  if ! have_cmd jq; then
    log_error "jq is required; please install jq"
    return 1
  fi
  return 0
}

ensure_bc() {
  if ! have_cmd bc; then
    log_error "bc is required; please install bc"
    return 1
  fi
  return 0
}

ensure_cast() {
  if ! have_cmd cast; then
    log_error "cast (foundry) is required; please install foundry"
    return 1
  fi
  return 0
}

# === BEACOND INTEGRATION ===
get_validator_pubkey() {
  local beacond_bin="$1"
  local home="$2"
  
  local out rc=0
  out=$("$beacond_bin" --home "$home" deposit validator-keys 2>&1) || rc=$?
  
  if [[ $rc -ne 0 ]]; then
    log_error "$out"
    log_error "beacond deposit validator-keys failed"
    return 1
  fi
  
  local pk
  pk=$(printf '%s\n' "$out" | awk 'BEGIN{IGNORECASE=1} /Eth\/Beacon Pubkey (Compressed 48-byte Hex):/{getline; print; exit}' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' | head -n1)
  if [[ -z "$pk" ]]; then
    pk=$(printf '%s\n' "$out" | grep -Eo '0x[0-9a-fA-F]{96}' | head -n1 || true)
  fi
  
  if [[ -z "$pk" ]]; then
    log_error "Could not parse validator pubkey"
    return 1
  fi
  
  echo "$pk"
  return 0
}

resolve_beacond_bin() {
  # Resolves the beacond binary path, using BEACOND_BIN env var if set
  local beacond_bin="${BEACOND_BIN:-beacond}"
  if command -v "$beacond_bin" >/dev/null 2>&1; then 
    command -v "$beacond_bin"
    return 0
  fi
  return 1
}

find_app_toml() {
  # Discover app.toml under beacond home directory
  local home="$1"
  if [[ -f "$home/config/app.toml" ]]; then 
    printf '%s' "$home/config/app.toml"
    return 0
  fi
  if [[ -f "$home/app.toml" ]]; then 
    printf '%s' "$home/app.toml"
    return 0
  fi
  return 1
}

get_network_from_genesis() {
  local beacond_bin="$1"
  local home="$2"
  
  local root
  root=$("$beacond_bin" --home "$home" genesis validator-root "$home/config/genesis.json" 2>/dev/null) || {
    echo "unknown"
    return 0
  }
  
  if [[ -z "$root" ]]; then
    echo "unknown"
    return 0
  fi
  
  case "$root" in
    "$MAINNET_VALIDATOR_ROOT") echo "mainnet" ;;
    "$BEPOLIA_VALIDATOR_ROOT") echo "bepolia" ;;
    *) echo "unknown" ;;
  esac
}

get_beacon_api_address() {
  local beacond_home="$1"
  local app_toml="$beacond_home/config/app.toml"
  
  if [[ ! -f "$app_toml" ]]; then
    printf ''
    return 0
  fi
  
  local section
  section=$(awk '
    BEGIN{flag=0}
    /^[[:space:]]*\[beacon\.node-api\][[:space:]]*$/ {flag=1; next}
    /^[[:space:]]*\[.*\][[:space:]]*$/ {if(flag==1){flag=0}}
    { if(flag==1) print }
  ' "$app_toml" | awk '{gsub(/\r/,"")}; /^[[:space:]]*[#;]/{next}; NF')
  
  if [[ -z "$section" ]]; then
    printf ''
    return 0
  fi
  
  local address_line
  address_line=$(printf '%s\n' "$section" | awk 'BEGIN{IGNORECASE=1} $0 ~ /^[[:space:]]*address[[:space:]]*=/ {print}' | tail -n1)
  
  if [[ -z "$address_line" ]]; then
    printf ''
    return 0
  fi
  
  echo "$address_line" | sed -E 's/^[[:space:]]*address[[:space:]]*=[[:space:]]*//; s/["\x27]//g; s/[#;].*$//; s/[[:space:]]+$//'
}

maybe_probe_node_api() {
  local addr="$1"
  local host="${addr%:*}"
  local port="${addr##*:}"
  
  if [[ -z "$port" ]]; then
    return 1
  fi
  
  local probe_host
  if [[ -z "$host" || "$host" == "0.0.0.0" || "$host" == "::" || "$host" == "[::]" ]]; then
    probe_host="127.0.0.1"
  else
    probe_host="$host"
  fi
  
  local base="http://$probe_host:$port"
  curl --silent --show-error --fail --max-time 4 "$base/eth/v1/node/syncing" >/dev/null 2>&1 || return 1
  return 0
}

get_validator_index_from_api() {
  local api_url="$1"
  local pubkey="$2"
  
  ensure_jq
  
  local validators_json
  validators_json=$(curl -sS "${api_url}/eth/v1/beacon/states/head/validators" 2>/dev/null) || return 1
  
  if [[ -z "$validators_json" ]]; then
    return 1
  fi
  
  # Find the validator index by searching for the pubkey in the data array
  local index
  index=$(echo "$validators_json" | jq -r --arg pk "$pubkey" '
    .data[] |
    select(.validator.pubkey == $pk) |
    .index
  ' 2>/dev/null)
  
  if [[ -z "$index" || "$index" == "null" ]]; then
    return 1
  fi
  
  echo "$index"
  return 0
}

# === CONTRACT QUERIES ===
get_delegation_handler() {
  local factory="$1"
  local pubkey="$2"
  local rpc="$3"
  
  ensure_cast
  
  local handler
  handler=$(cast_call_clean "$factory" "delegationHandlers(bytes)(address)" "$pubkey" -r "$rpc" 2>/dev/null || echo "0x0000000000000000000000000000000000000000")
  echo "$handler"
}

get_staking_pool_for_pubkey() {
  local factory="$1"
  local pubkey="$2"
  local rpc="$3"
  
  ensure_cast
  
  local pool
  pool=$(cast_call_clean "$factory" "stakingPools(bytes)(address)" "$pubkey" -r "$rpc" 2>/dev/null || echo "0x0000000000000000000000000000000000000000")
  echo "$pool"
}

# === AMOUNT VALIDATION ===
validate_gwei_multiple() {
  local amount_wei="$1"
  
  ensure_bc
  
  local remainder
  remainder=$(echo "$amount_wei % 1000000000" | bc)
  
  if [[ "$remainder" != "0" ]]; then
    return 1
  fi
  
  return 0
}

round_down_to_gwei() {
  local amount_wei="$1"
  
  ensure_bc
  
  local remainder
  remainder=$(echo "$amount_wei % 1000000000" | bc)
  
  if [[ "$remainder" == "0" ]]; then
    echo "$amount_wei"
  else
    echo "$amount_wei - $remainder" | bc
  fi
}

# === ENV LOADING ===
load_env() {
  local script_dir="$1"
  local custom_env_file="${2:-}"
  local env_file
  
  if [[ -n "$custom_env_file" ]]; then
    # Use custom env file (can be absolute or relative path)
    if [[ "$custom_env_file" == /* ]]; then
      env_file="$custom_env_file"
    else
      env_file="$script_dir/$custom_env_file"
    fi
  else
    # Default to env.sh in script directory
    env_file="$script_dir/env.sh"
  fi
  
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    source "$env_file"
    if [[ -n "$custom_env_file" ]]; then
      log_info "Loaded config from: $env_file"
    fi
  fi
}

# === NETWORK CONSTANTS ===

# Genesis validator roots for network detection
readonly MAINNET_VALIDATOR_ROOT="0xdf609e3b062842c6425ff716aec2d2092c46455d9b2e1a2c9e32c6ba63ff0bda"
readonly BEPOLIA_VALIDATOR_ROOT="0x3cbcf75b02fe4750c592f1c1ff8b5500a74406f80f038e9ff250e2e294c5615e"

# StakingPoolContractsFactory addresses
readonly STAKING_POOL_FACTORY_MAINNET="0xa4Fd7E7771e5a752e6e05d4905843519E1df0885"
readonly STAKING_POOL_FACTORY_BEPOLIA="0x176c081E95C82CA68DEa20CA419C7506Aa063C24"

# DelegationHandlerFactory addresses
readonly DELEGATION_HANDLER_FACTORY_MAINNET="0x0000000000000000000000000000000000000000"  # TBD
readonly DELEGATION_HANDLER_FACTORY_BEPOLIA="0x8b472791aC2f9e9Bd85f8919401b8Ce3bdFd464c"

# Beacon deposit contract (same on both networks)
readonly BEACON_DEPOSIT_CONTRACT="0x4242424242424242424242424242424242424242"

# BGT (Berachain Governance Token) addresses (same on both networks)
readonly BGT_ADDRESS="0x656b95E550C07a9ffe548bd4085c72418Ceb1dba"

# === NETWORK DETECTION & DEFAULTS ===
get_rpc_url_for_network() {
  local network="$1"
  
  case "$network" in
    mainnet) echo "https://rpc.berachain.com" ;;
    bepolia) echo "https://bepolia.rpc.berachain.com" ;;
    *) echo "" ;;
  esac
}

get_factory_address_for_network() {
  local network="$1"
  
  case "$network" in
    mainnet) echo "$STAKING_POOL_FACTORY_MAINNET" ;;
    bepolia) echo "$STAKING_POOL_FACTORY_BEPOLIA" ;;
    *) echo "" ;;
  esac
}

get_withdrawal_vault_for_network() {
  local network="$1"
  
  # Get factory address and RPC URL for the network
  local factory_addr rpc_url
  factory_addr=$(get_factory_address_for_network "$network")
  rpc_url=$(get_rpc_url_for_network "$network")
  
  if [[ -z "$factory_addr" || -z "$rpc_url" ]]; then
    echo ""
    return 1
  fi
  
  # Query withdrawalVault() from the factory contract
  local vault
  vault=$(cast_call_clean "$factory_addr" "withdrawalVault()(address)" -r "$rpc_url" 2>/dev/null)
  
  if [[ -z "$vault" || "$vault" == "0x0000000000000000000000000000000000000000" ]]; then
    echo ""
    return 1
  fi
  
  echo "$vault"
}

get_delegation_handler_factory_for_network() {
  local network="$1"
  
  case "$network" in
    mainnet) echo "$DELEGATION_HANDLER_FACTORY_MAINNET" ;;
    bepolia) echo "$DELEGATION_HANDLER_FACTORY_BEPOLIA" ;;
    *) echo "" ;;
  esac
}

get_beacon_deposit_address() {
  echo "$BEACON_DEPOSIT_CONTRACT"
}

get_cast_wallet_args() {
  # Returns appropriate cast wallet arguments based on PRIVATE_KEY
  # If PRIVATE_KEY is set, use --private-key
  # Otherwise, use --ledger
  if [[ -n "${PRIVATE_KEY:-}" ]]; then
    echo "--private-key $PRIVATE_KEY"
  else
    echo "--ledger"
  fi
}

detect_network_and_rpc() {
  # Returns: network rpc_url (space separated)
  # Priority: ENV vars -> beacond detection -> defaults
  
  local network="${NETWORK:-}"
  local rpc_url="${RPC_URL:-}"
  
  # If both set, use them
  if [[ -n "$network" && -n "$rpc_url" ]]; then
    echo "$network $rpc_url"
    return 0
  fi
  
  # Try to detect from beacond
  if [[ -n "${BEACOND_HOME:-}" && -n "${BEACOND_BIN:-beacond}" ]]; then
    if have_cmd "${BEACOND_BIN:-beacond}"; then
      network=$(get_network_from_genesis "${BEACOND_BIN:-beacond}" "$BEACOND_HOME" 2>/dev/null || echo "")
      
      if [[ -n "$network" && "$network" != "unknown" ]]; then
        if [[ -z "$rpc_url" ]]; then
          rpc_url=$(get_rpc_url_for_network "$network")
        fi
        echo "$network $rpc_url"
        return 0
      fi
    fi
  fi
  
  # Default to mainnet
  if [[ -z "$network" ]]; then
    network="mainnet"
  fi
  
  if [[ -z "$rpc_url" ]]; then
    rpc_url=$(get_rpc_url_for_network "$network")
  fi
  
  echo "$network $rpc_url"
}


