#!/usr/bin/env bash
# Common library functions for staking pool bash helpers
# Source this file in scripts: source "$SCRIPT_DIR/lib-common.sh"

# === LOGGING ===
log_error() { echo "[error] $*"; }
log_info() { echo "[info] $*"; }
log_success() { echo "[success] $*"; }
log_warn() { echo "[warn] $*"; }

# === CAST OUTPUT HANDLING ===
strip_scientific_notation() {
  # Normalizes numeric output from `cast call`. Handles both the bracketed
  # format `240000000000000000000000 [2.4e23]` (take the first field) and bare
  # scientific notation `2.4e23` (expand to full decimal).
  #
  # Non-numeric tokens (e.g. "true", "false", checksummed addresses) MUST pass
  # through unchanged so boolean / address getters aren't corrupted by awk's
  # implicit string-to-number coercion. The previous implementation relied on
  # an awk syntax error (the reserved word `exp`) to accidentally preserve
  # "false" via the `|| echo "$input"` fallback; do not reintroduce that.
  local input="${1:-}"

  input=$(echo "$input" | awk '{print $1}')

  if [[ "$input" =~ ^-?[0-9]+(\.[0-9]+)?[eE][+-]?[0-9]+$ ]]; then
    # Real scientific notation. awk natively coerces this to a number.
    echo "$input" | awk '{ printf "%.0f", $1 }'
  else
    echo "$input"
  fi
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
    echo ""
    return
  fi
  
  local pk
  pk=$(printf '%s\n' "$out" | awk 'BEGIN{IGNORECASE=1} /Eth\/Beacon Pubkey (Compressed 48-byte Hex):/{getline; print; exit}' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' | head -n1)
  if [[ -z "$pk" ]]; then
    pk=$(printf '%s\n' "$out" | grep -Eo '0x[0-9a-fA-F]{96}' | head -n1 || true)
  fi
  
  if [[ -z "$pk" ]]; then
    log_error "Could not parse validator pubkey"
    echo ""
    return
  fi
  
  echo "$pk"
}

resolve_beacond_bin() {
  # Resolves the beacond binary path, using BEACOND_BIN env var if set
  # Handles both absolute paths and PATH-based lookups
  # Returns the resolved path if found and executable, empty string otherwise
  local beacond_bin="${BEACOND_BIN:-beacond}"
  local resolved=""
  
  # If it's an absolute path, check if it's executable
  if [[ "$beacond_bin" == /* ]]; then
    if [[ -x "$beacond_bin" ]]; then
      resolved="$beacond_bin"
    fi
  else
    # Otherwise, look in PATH
    local path_resolved
    if path_resolved=$(command -v "$beacond_bin" 2>/dev/null); then
      # Ensure the resolved path is executable
      if [[ -x "$path_resolved" ]]; then
        resolved="$path_resolved"
      fi
    fi
  fi
  
  echo "$resolved"
}

find_app_toml() {
  # Discover app.toml under beacond home directory
  local home="$1"
  if [[ -f "$home/config/app.toml" ]]; then 
    printf '%s' "$home/config/app.toml"
    return
  fi
  if [[ -f "$home/app.toml" ]]; then 
    printf '%s' "$home/app.toml"
    return
  fi
  echo ""
}

get_network_from_genesis() {
  # Detect network (mainnet/bepolia) from beacond genesis validator root
  # Args: beacond_binary_path beacond_home_directory
  # Returns: "mainnet", "bepolia", or "unknown"
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

normalize_address() {
  # Normalize a network address string (removes protocol, adds default port if missing)
  # Args: address string (may include http://, port, etc.)
  # Returns: normalized address in HOST:PORT format
  local addr="$1"
  addr=$(echo "$addr" | sed -E "s~^[[:space:]]*https?://~~I; s~/*$~~; s/^[[:space:]]+//; s/[[:space:]]+$//; s/^[\"']|[\"']$//g")
  if [[ -z "$addr" ]]; then printf '%s' ""; return; fi
  if [[ "$addr" =~ ^[0-9]+$ ]]; then printf '127.0.0.1:%s' "$addr"; return; fi
  if [[ "$addr" != *:* ]]; then printf '%s:3500' "$addr"; return; fi
  printf '%s' "$addr"
}

# Extract [beacon-kit.node-api] enabled/address from app.toml
extract_node_api_from_app_toml() {
  # Extract node API address from beacond app.toml configuration file
  # Args: path to app.toml file
  # Returns: address string from config, or empty string if not found
  local app_toml="$1"
  local section
  section=$(awk '
    BEGIN{flag=0}
    /^[[:space:]]*\[beacon-kit\.node-api\][[:space:]]*$/ {flag=1; next}
    /^[[:space:]]*\[.*\][[:space:]]*$/ {if(flag==1){flag=0}}
    { if(flag==1) print }
  ' "$app_toml" | awk '{gsub(/\r/,"")}; /^[[:space:]]*[#;]/{next}; NF')
  if [[ -z "$section" ]]; then printf ''; return 0; fi
  local address_line
  address_line=$(printf '%s\n' "$section" | awk 'BEGIN{IGNORECASE=1} $0 ~ /^[[:space:]]*address[[:space:]]*=/ {print}' | tail -n1)
  if [[ -z "$address_line" ]]; then printf ''; return 0; fi
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
  # Get validator index from beacon chain API by pubkey
  # Args: api_base_url validator_pubkey_hex
  # Returns: validator index as string, or empty string if not found
  local api_url="$1"
  local pubkey="$2"
  
  ensure_jq
  
  local validators_json
  validators_json=$(curl -sS "${api_url}/eth/v1/beacon/states/head/validators" 2>/dev/null) || {
    echo ""
    return
  }
  
  if [[ -z "$validators_json" ]]; then
    echo ""
    return
  fi
  
  # Find the validator index by searching for the pubkey in the data array
  local index
  index=$(echo "$validators_json" | jq -r --arg pk "$pubkey" '
    .data[] |
    select(.validator.pubkey == $pk) |
    .index
  ' 2>/dev/null)
  
  if [[ -z "$index" || "$index" == "null" ]]; then
    echo ""
    return
  fi
  
  echo "$index"
}

# === CONTRACT QUERIES ===
get_delegation_handler() {
  # Get DelegationHandler address for a validator pubkey from factory
  # Args: factory_address validator_pubkey_hex rpc_url
  # Returns: handler address, or zero address if not found
  local factory="$1"
  local pubkey="$2"
  local rpc="$3"
  
  ensure_cast
  
  local handler
  handler=$(cast_call_clean "$factory" "delegationHandlers(bytes)(address)" "$pubkey" -r "$rpc" 2>/dev/null || echo "0x0000000000000000000000000000000000000000")
  echo "$handler"
}

# === AMOUNT VALIDATION ===
validate_gwei_multiple() {
  # Check if amount in wei is a multiple of 1 gwei (required by some contracts)
  # Args: amount_in_wei
  # Returns: 0 if valid multiple, 1 otherwise
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

# === CHAIN CONSTANTS ===

# Genesis validator roots for chain detection
readonly MAINNET_VALIDATOR_ROOT="0xdf609e3b062842c6425ff716aec2d2092c46455d9b2e1a2c9e32c6ba63ff0bda"
readonly BEPOLIA_VALIDATOR_ROOT="0x3cbcf75b02fe4750c592f1c1ff8b5500a74406f80f038e9ff250e2e294c5615e"

# StakingPoolContractsFactory addresses
readonly STAKING_POOL_FACTORY_MAINNET="0xb79b43dBA821Cb67751276Ce050fF4111445fB99"
readonly STAKING_POOL_FACTORY_BEPOLIA="0x176c081E95C82CA68DEa20CA419C7506Aa063C24"

# DelegationHandlerFactory addresses
readonly DELEGATION_HANDLER_FACTORY_MAINNET="0xAd17932a5B1aaeEa73D277a6AE670623F176E0D0"
readonly DELEGATION_HANDLER_FACTORY_BEPOLIA="0x8b472791aC2f9e9Bd85f8919401b8Ce3bdFd464c"

# Beacon deposit contract (same on both chains)
readonly BEACON_DEPOSIT_CONTRACT="0x4242424242424242424242424242424242424242"

# BGT (Berachain Governance Token) addresses (same on both chains)
readonly BGT_ADDRESS="0x656b95E550C07a9ffe548bd4085c72418Ceb1dba"

# === CHAIN DETECTION & DEFAULTS ===
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
  local factory_addr rpc_url
  factory_addr=$(get_factory_address_for_network "$network")
  rpc_url=$(get_rpc_url_for_network "$network")
  
  cast_call_clean "$factory_addr" "withdrawalVault()(address)" -r "$rpc_url" 2>/dev/null || echo ""
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

calculate_withdrawal_ready_time() {
  # Calculate when a withdrawal request will be ready for redemption
  # Args: request_block rpc_url
  # Returns: human-readable time estimate or "ready" if already ready
  local request_block="$1"; local rpc_url="$2"
  local cooldown_blocks=129600
  
  # Validate and normalize request_block (handle null, empty, or invalid values)
  if [[ -z "$request_block" || "$request_block" == "null" || "$request_block" == "0" ]]; then
    echo "unknown (invalid request block)"
    return 1
  fi
  
  # Get current block number
  local current_block
  current_block=$(cast block-number -r "$rpc_url" 2>/dev/null || echo "0")
  
  if [[ "$current_block" == "0" || -z "$current_block" ]]; then
    echo "unknown (could not get current block)"
    return 1
  fi
  
  # Ensure both are valid numbers before arithmetic
  if ! [[ "$request_block" =~ ^[0-9]+$ ]] || ! [[ "$current_block" =~ ^[0-9]+$ ]]; then
    echo "unknown (invalid block numbers)"
    return 1
  fi
  
  local ready_block
  ready_block=$((request_block + cooldown_blocks))
  
  if (( ready_block <= current_block )); then
    echo "ready"
    return 0
  fi
  
  local blocks_remaining
  blocks_remaining=$((ready_block - current_block))
  
  # Estimate time remaining (assuming ~2 seconds per block)
  local seconds_remaining
  seconds_remaining=$((blocks_remaining * 2))
  
  # Format as human-readable time
  local days hours minutes
  days=$((seconds_remaining / 86400))
  hours=$(((seconds_remaining % 86400) / 3600))
  minutes=$(((seconds_remaining % 3600) / 60))
  
  local time_str=""
  if [[ $days -gt 0 ]]; then
    time_str="${days}d "
  fi
  if [[ $hours -gt 0 ]]; then
    time_str="${time_str}${hours}h "
  fi
  if [[ $minutes -gt 0 ]]; then
    time_str="${time_str}${minutes}m"
  fi
  time_str=$(echo "$time_str" | sed 's/ $//')
  
  if [[ -z "$time_str" ]]; then
    time_str="< 1 minute"
  fi
  
  echo "in ~$time_str (block $ready_block, $blocks_remaining blocks remaining)"
  return 0
}

detect_network_and_rpc() {
  # Returns: chain rpc_url (space separated), or empty string on failure
  # Priority: CLI_CHAIN -> CHAIN env var -> beacond detection -> defaults
  
  local chain="${CLI_CHAIN:-${CHAIN:-}}"
  local rpc_url="${RPC_URL:-}"
  
  # If chain is set, use it (even if rpc_url not set, we'll derive it)
  if [[ -n "$chain" ]]; then
    if [[ -z "$rpc_url" ]]; then
      rpc_url=$(get_rpc_url_for_network "$chain")
    fi
    echo "$chain $rpc_url"
    return
  fi
  
  # Try to detect from beacond
  if [[ -n "${BEACOND_HOME:-}" ]]; then
    local beacond_bin
    beacond_bin=$(resolve_beacond_bin 2>/dev/null)
    if [[ -n "$beacond_bin" ]]; then
      chain=$(get_network_from_genesis "$beacond_bin" "$BEACOND_HOME" 2>/dev/null || echo "")
      
      if [[ -n "$chain" && "$chain" != "unknown" ]]; then
        if [[ -z "$rpc_url" ]]; then
          rpc_url=$(get_rpc_url_for_network "$chain")
        fi
        echo "$chain $rpc_url"
        return
      fi
    fi
  fi
  
  # Fail if chain cannot be detected
  if [[ -z "$chain" ]]; then
    log_error "Could not detect network chain. Set CLI_CHAIN or CHAIN environment variable, or configure BEACOND_HOME."
    echo ""
    return
  fi
  
  if [[ -z "$rpc_url" ]]; then
    rpc_url=$(get_rpc_url_for_network "$chain")
  fi
  
  echo "$chain $rpc_url"
}

# === STAKING POOL SETUP ===
setup_staking_pool_env() {
  # Common setup function for staking pool scripts
  # Validates environment, resolves beacond binary, network, pubkey, RPC, factory, withdrawal vault, and node API
  # Sets global variables: network, pubkey, rpc_url, factory_addr, withdrawal_vault, node_api_url, beacond_bin
  # Returns: 0 on success, 1 on failure
  
  if [[ -z "$BEACOND_HOME" ]]; then
    log_error "Missing BEACOND_HOME in env.sh"
    return 1
  fi
  
  if [[ ! -d "$BEACOND_HOME" ]]; then
    log_error "beacond_home not found: $BEACOND_HOME"
    return 1
  fi

  # Resolve beacond binary (respects BEACOND_BIN env var if set)
  if ! beacond_bin=$(resolve_beacond_bin) || [[ -z "$beacond_bin" ]]; then
    log_error "beacond binary not found (set BEACOND_BIN in env.sh or ensure beacond is in PATH)"
    return 1
  fi

  # Attempt auto-detect of node API address from app.toml
  local app_toml=""
  local detected_node_api_url=""
  if app_toml=$(find_app_toml "$BEACOND_HOME"); then
    detected_node_api_url=$(extract_node_api_from_app_toml "$app_toml")
  fi

  # Resolve node api address: prefer env -> app.toml
  node_api_url=""
  if [[ -n "${NODE_API_ADDRESS:-}" ]]; then
    node_api_url=$(normalize_address "$NODE_API_ADDRESS")
  elif [[ -n "$detected_node_api_url" ]]; then
    node_api_url=$(normalize_address "$detected_node_api_url")
  fi

  if [[ -z "$node_api_url" ]]; then
    log_error "Node API address not configured."
    if [[ -n "$app_toml" ]]; then
      log_error "Set [beacon-kit.node-api] enabled = true and address = HOST:PORT in: $app_toml"
    else
      log_error "Set NODE_API_ADDRESS in env.sh or [beacon-kit.node-api] in app.toml"
    fi
    log_error "Example: NODE_API_ADDRESS=\"127.0.0.1:3500\""
    return 1
  else
    if ! maybe_probe_node_api "$node_api_url"; then
      log_error "Node API not reachable at $node_api_url"
      if [[ -n "$app_toml" ]]; then
        log_error "Ensure [beacon-kit.node-api] enabled = true and address is correct in: $app_toml, then restart your node"
      else
        log_error "Set correct NODE_API_ADDRESS in env.sh"
      fi
      return 1
    fi
  fi

  network=$(get_network_from_genesis "$beacond_bin" "$BEACOND_HOME")
  pubkey=$(get_validator_pubkey "$beacond_bin" "$BEACOND_HOME")
  if [[ -z "$pubkey" ]]; then
    return 1
  fi

  # Resolve RPC URL early (needed for withdrawal vault lookup)
  rpc_url=$(get_rpc_url_for_network "$network")
  if [[ -z "$rpc_url" ]]; then
    log_error "Unknown network: $network"
    return 1
  fi

  # Resolve factory address
  factory_addr=$(get_factory_address_for_network "$network")
  if [[ -z "$factory_addr" ]]; then
    log_error "Factory address not available for network: $network"
    return 1
  fi

  # Auto-detect withdrawal vault from factory
  withdrawal_vault=$(get_withdrawal_vault_for_network "$network")
  if [[ -z "$withdrawal_vault" || "$withdrawal_vault" == "0x0000000000000000000000000000000000000000" ]]; then
    log_error "WithdrawalVault not available for network: $network"
    return 1
  fi

  return 0
}

predict_and_display_addresses() {
  # Predict staking pool contract addresses from factory using validator pubkey
  # Args: factory_address rpc_url validator_pubkey
  # Returns: staking_pool address, or empty string on failure
  local factory_addr="$1"
  local rpc_url="$2"
  local pubkey="$3"
  
  if ! have_cmd cast; then
    log_error "cast not found; install foundry (https://book.getfoundry.sh/)"
    echo ""
    return
  fi
  
  # Get predicted addresses once
  local predicted_addrs
  predicted_addrs=$(cast call "$factory_addr" "predictStakingPoolContractsAddresses(bytes)(address,address,address,address)" "$pubkey" -r "$rpc_url" 2>/dev/null)
  if [[ -z "$predicted_addrs" ]]; then
    log_error "prediction call failed"
    echo ""
    return
  fi
  
  # Parse tuple: (address,address,address,address) -> extract addresses
  local normalized_addrs
  normalized_addrs=$(echo "$predicted_addrs" | tr -d '()' | tr ',' ' ' | tr '\n' ' ' | tr -s ' ' ' ')
  local smart_operator staking_pool staking_rewards_vault incentive_collector
  read -r smart_operator staking_pool staking_rewards_vault incentive_collector <<< "$normalized_addrs"
  
  if [[ -z "$smart_operator" || -z "$staking_pool" || -z "$staking_rewards_vault" || -z "$incentive_collector" ]]; then
    log_error "prediction call failed"
    echo ""
    return
  fi
  
  log_info "Predicted contract addresses:" >&2
  echo "  SmartOperator:          $smart_operator" >&2
  echo "  StakingPool:            $staking_pool" >&2
  echo "  StakingRewardsVault:    $staking_rewards_vault" >&2
  echo "  IncentiveCollector:     $incentive_collector" >&2
  
  echo "$staking_pool"
}


# === DELEGATION SIMULATION ===

predict_handler_address() {
  # Spin up a throwaway anvil fork, call deployDelegationHandler, read back the
  # address from delegationHandlers(pubkey), then kill the fork.
  # Returns the checksummed handler address on stdout.
  #
  # Args:
  #   $1  pubkey   — validator pubkey (0x-prefixed 96 hex chars)
  #   $2  network  — "mainnet" or "bepolia"
  #   $3  key_file — path to private key file (used only for deploy tx on fork)
  local pubkey="$1"
  local network="$2"
  local key_file="$3"

  local rpc_upstream factory fork_port fork_url
  rpc_upstream=$(get_rpc_url_for_network "$network")
  factory=$(get_delegation_handler_factory_for_network "$network")
  fork_port=18544
  fork_url="http://127.0.0.1:$fork_port"

  local priv_key
  priv_key=$(cat "$key_file")

  anvil --fork-url "$rpc_upstream" --port "$fork_port" &>/tmp/anvil-predict.log &
  local anvil_pid=$!
  # shellcheck disable=SC2064
  trap "kill $anvil_pid 2>/dev/null; wait $anvil_pid 2>/dev/null; trap - RETURN" RETURN

  local ready=false
  for i in {1..30}; do
    if cast block-number -r "$fork_url" &>/dev/null; then ready=true; break; fi
    sleep 0.5
  done
  if [[ "$ready" == "false" ]]; then
    log_error "predict_handler_address: anvil fork did not become ready" >&2
    return 1
  fi

  if ! cast send "$factory" 'deployDelegationHandler(bytes)' "$pubkey" \
      -r "$fork_url" --private-key "$priv_key" >/dev/null; then
    log_error "predict_handler_address: deployDelegationHandler failed" >&2
    return 1
  fi

  local handler
  handler=$(cast call "$factory" 'delegationHandlers(bytes)(address)' "$pubkey" \
    -r "$fork_url" 2>/dev/null | xargs)

  if [[ -z "$handler" || "$handler" == "0x0000000000000000000000000000000000000000" ]]; then
    log_error "predict_handler_address: handler address is zero after deploy" >&2
    return 1
  fi

  echo "$handler"
}

run_delegation_simulation() {
  # Fork mainnet/bepolia via anvil, run operator steps (deploy+fund) with the signing key,
  # impersonate the DEFAULT_ADMIN_ROLE holder to execute the Safe payload, then verify state.
  #
  # Args:
  #   $1  pubkey       — validator pubkey (0x-prefixed 96 hex chars)
  #   $2  network      — "mainnet" or "bepolia"
  #   $3  key_file     — path to private key file (key read only inside this function)
  #   $4  payload_file — path to safe-multisend-payload.json
  #
  # Returns 0 on success, 1 on failure.
  # Writes generated/simulation-report.txt on success.
  local pubkey="$1"
  local network="$2"
  local key_file="$3"
  local payload_file="$4"

  local fork_port=18545
  local fork_url="http://127.0.0.1:$fork_port"
  local rpc_upstream
  rpc_upstream=$(get_rpc_url_for_network "$network")
  local factory
  factory=$(get_delegation_handler_factory_for_network "$network")

  if [[ ! -f "$key_file" ]]; then
    log_error "Key file not found: $key_file"
    return 1
  fi
  if [[ ! -f "$payload_file" ]]; then
    log_error "Payload file not found: $payload_file"
    return 1
  fi
  if ! have_cmd anvil; then
    log_error "anvil not found; install foundry (https://book.getfoundry.sh/)"
    return 1
  fi

  # Load key — not logged or echoed
  local SIM_PRIVATE_KEY
  SIM_PRIVATE_KEY=$(cat "$key_file")
  local SIM_EOA
  SIM_EOA=$(cast wallet address --private-key "$SIM_PRIVATE_KEY" 2>/dev/null | xargs)
  log_info "Simulation signing address: $SIM_EOA"

  # The handler uses plain AccessControl (not enumerable) — getRoleMember reverts.
  # DEFAULT_ADMIN_ROLE is granted to the factory owner() at deploy time.
  local admin
  admin=$(cast call "$factory" 'owner()(address)' -r "$rpc_upstream" 2>/dev/null | xargs || echo "")
  if [[ -z "$admin" || "$admin" == "0x0000000000000000000000000000000000000000" ]]; then
    log_error "Sim: could not read factory owner (DEFAULT_ADMIN_ROLE holder)"
    return 1
  fi
  log_info "DEFAULT_ADMIN_ROLE holder (factory owner): $admin"

  # Start anvil fork
  log_info "Starting anvil fork of $network ($rpc_upstream)..."
  anvil --fork-url "$rpc_upstream" --port "$fork_port" &>/tmp/anvil-sim.log &
  local anvil_pid=$!
  # RETURN trap fires when this function returns; EXIT would fire in the parent shell where
  # anvil_pid is not defined, so we use RETURN only and kill explicitly on each exit path.
  # shellcheck disable=SC2064
  trap "kill $anvil_pid 2>/dev/null; wait $anvil_pid 2>/dev/null; trap - RETURN" RETURN

  # Wait for fork
  local ready=false
  for i in {1..30}; do
    if cast block-number -r "$fork_url" &>/dev/null; then ready=true; break; fi
    sleep 0.5
  done
  if [[ "$ready" == "false" ]]; then
    log_error "Anvil fork did not become ready"
    return 1
  fi
  log_success "Fork ready at $fork_url"
  echo ""

  # Step 1: Deploy handler on fork
  log_info "Sim step 1: Deploy DelegationHandler..."
  if ! cast send "$factory" \
      'deployDelegationHandler(bytes)' "$pubkey" \
      -r "$fork_url" --private-key "$SIM_PRIVATE_KEY" >/dev/null; then
    log_error "Sim: deployDelegationHandler failed"
    return 1
  fi

  local handler
  handler=$(cast call "$factory" 'delegationHandlers(bytes)(address)' "$pubkey" -r "$fork_url" | xargs)
  if [[ -z "$handler" || "$handler" == "0x0000000000000000000000000000000000000000" ]]; then
    log_error "Sim: handler address is zero after deploy"
    return 1
  fi
  log_success "Sim: handler at $handler"
  echo ""

  # Step 2: Fund handler — parse amount_wei from the delegate() calldata in the payload
  local amount_wei_expected amount_bera
  amount_wei_expected=$(python3 -c "
import json, sys
d = json.load(open('$payload_file'))
txs = d.get('transactions', [])
delegate_data = next((t['data'] for t in txs if '9fa6dd35' in t.get('data','').lower()), '')
if not delegate_data:
    sys.exit(1)
print(int(delegate_data[10:], 16))
" 2>/dev/null || echo "")

  if [[ -z "$amount_wei_expected" || "$amount_wei_expected" == "0" ]]; then
    log_error "Sim: could not parse delegate amount from payload"
    return 1
  fi

  amount_bera=$(cast --to-unit "$amount_wei_expected" ether 2>/dev/null || echo "$amount_wei_expected wei")

  log_info "Sim step 2: Sending $amount_bera BERA ($amount_wei_expected wei) to handler..."
  if ! cast send "$handler" \
      --value "${amount_wei_expected}wei" \
      -r "$fork_url" --private-key "$SIM_PRIVATE_KEY" >/dev/null; then
    log_error "Sim: failed to fund handler"
    return 1
  fi
  log_success "Sim: handler funded"
  echo ""

  # Step 3: Impersonate DEFAULT_ADMIN_ROLE holder (factory owner), execute Safe payload txs
  log_info "Sim step 3: Impersonating admin ($admin) for Safe payload..."
  cast rpc anvil_impersonateAccount "$admin" -r "$fork_url" >/dev/null
  # 1 ETH in hex for gas — use printf for portable zero-padded hex
  cast rpc anvil_setBalance "$admin" "$(printf '0x%064x' $((10**18)))" -r "$fork_url" >/dev/null

  local tx_count
  tx_count=$(python3 -c "import json; d=json.load(open('$payload_file')); print(len(d.get('transactions',[])))" 2>/dev/null || echo "0")
  if [[ "$tx_count" -eq 0 ]]; then
    log_error "Sim: no transactions in payload file"
    return 1
  fi

  for i in $(seq 0 $((tx_count - 1))); do
    local to calldata comment
    to=$(python3 -c "import json; d=json.load(open('$payload_file')); print(d['transactions'][$i]['to'])" 2>/dev/null)
    calldata=$(python3 -c "import json; d=json.load(open('$payload_file')); print(d['transactions'][$i]['data'])" 2>/dev/null)
    comment=$(python3 -c "import json; d=json.load(open('$payload_file')); print(d['transactions'][$i].get('_comment',''))" 2>/dev/null || echo "")
    log_info "  Sim tx $((i+1))/$tx_count: $comment"
    # cast send does not accept --data; pass raw calldata as the SIG positional argument
    if ! cast send "$to" "$calldata" -r "$fork_url" --from "$admin" --unlocked >/dev/null; then
      log_error "  Sim tx $((i+1)) failed"
      return 1
    fi
    log_success "  Sim tx $((i+1)) ok"
  done

  cast rpc anvil_stopImpersonatingAccount "$admin" -r "$fork_url" >/dev/null
  echo ""

  # Step 4: Verify final state
  log_info "Sim: verifying final state..."
  local delegated_amount delegated_bera
  delegated_amount=$(cast call "$handler" 'delegatedAmount()(uint256)' -r "$fork_url" | awk '{print $1}')
  delegated_bera=$(cast --to-unit "$delegated_amount" ether 2>/dev/null || echo "$delegated_amount wei")
  if ! python3 -c "import sys; sys.exit(0 if int(sys.argv[1]) == int(sys.argv[2]) else 1)" \
      "$delegated_amount" "$amount_wei_expected" 2>/dev/null; then
    log_error "Sim: delegatedAmount mismatch: got $delegated_amount, expected $amount_wei_expected"
    return 1
  fi
  log_success "Sim: delegatedAmount = $delegated_bera BERA (exact match)"

  local operator
  operator=$(python3 -c "
import json, sys
d = json.load(open('$payload_file'))
txs = d.get('transactions', [])
grant_data = next((t['data'] for t in txs if '2f2ff15d' in t.get('data','').lower()), '')
if not grant_data or len(grant_data) < 138:
    sys.exit(1)
print('0x' + grant_data[-40:])
" 2>/dev/null || echo "")

  if [[ -z "$operator" || "$operator" == "0x" ]]; then
    log_error "Sim: grantRole tx not found in payload — cannot verify VALIDATOR_ADMIN_ROLE"
    return 1
  fi

  local validator_admin_role has_role
  validator_admin_role=$(cast keccak "VALIDATOR_ADMIN_ROLE" | xargs)
  has_role=$(cast call "$handler" 'hasRole(bytes32,address)(bool)' "$validator_admin_role" "$operator" -r "$fork_url" 2>/dev/null | xargs || echo "false")
  if [[ "$has_role" != "true" ]]; then
    log_error "Sim: VALIDATOR_ADMIN_ROLE NOT granted to $operator"
    return 1
  fi
  log_success "Sim: VALIDATOR_ADMIN_ROLE granted to $operator"

  # Write simulation report
  local report_file
  report_file="$(dirname "$payload_file")/simulation-report.txt"
  cat > "$report_file" <<EOF
Simulation passed
=================
Timestamp:          $(date -u +"%Y-%m-%d %H:%M:%S UTC")
Network:            $network
Validator pubkey:   $pubkey
Handler (fork):     $handler
Admin impersonated: $admin
Delegated amount:   $delegated_bera BERA ($amount_wei_expected wei)
Operator role:      VALIDATOR_ADMIN_ROLE granted to $operator
EOF

  echo ""
  log_success "Simulation passed. Artifacts are validated."
  return 0
}
