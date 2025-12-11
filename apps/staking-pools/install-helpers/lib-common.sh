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
  # Handles both cast format "240000000000000000000000 [2.4e23]" and pure scientific notation "2.4e23"
  # Returns the full decimal number as a string
  local input="${1:-}"
  
  # If it contains scientific notation in brackets or as a separate field, extract the first field
  input=$(echo "$input" | awk '{print $1}')
  
  # If it's pure scientific notation (contains 'e' or 'E'), convert it
  if [[ "$input" =~ [eE] ]]; then
    # Use awk to convert scientific notation - more reliable than bc for this
    # awk can handle both e and E notation
    echo "$input" | awk '{
      if ($1 ~ /[eE]/) {
        # Parse scientific notation: split on e/E
        split(toupper($1), parts, "E")
        base = parts[1]
        exp = parts[2]
        # Calculate: base * 10^exp using awk
        printf "%.0f", $1
      } else {
        print $1
      }
    }' 2>/dev/null || echo "$input"
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
readonly STAKING_POOL_FACTORY_MAINNET="0xa4Fd7E7771e5a752e6e05d4905843519E1df0885"
readonly STAKING_POOL_FACTORY_BEPOLIA="0x176c081E95C82CA68DEa20CA419C7506Aa063C24"

# DelegationHandlerFactory addresses
readonly DELEGATION_HANDLER_FACTORY_MAINNET="0x0000000000000000000000000000000000000000"  # TBD
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
  
  log_info "Predicted contract addresses:"
  echo "  SmartOperator:          $smart_operator"
  echo "  StakingPool:            $staking_pool"
  echo "  StakingRewardsVault:    $staking_rewards_vault"
  echo "  IncentiveCollector:     $incentive_collector"
  
  echo "$staking_pool"
}


