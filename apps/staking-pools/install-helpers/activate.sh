#!/usr/bin/env bash
set -euo pipefail

# Staking pool deployment and activation helper
# Run with --help for usage information

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib-common.sh"

# Load configuration if available
load_env "$SCRIPT_DIR"

OPERATOR_ADDR=""
SHARES_RECIPIENT=""

print_usage() {
  cat <<'USAGE'
activate.sh

Deploys or activates a staking pool for your validator.

Usage:
  activate.sh --sr 0x... --op 0x...
  
Required arguments:
  --sr 0x...                Shares recipient address  
  --op 0x...                Operator address

Note: Generates cast commands in temporary files for review before execution.
USAGE
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      --op) OPERATOR_ADDR="$2"; shift 2 ;;
      --sr) SHARES_RECIPIENT="$2"; shift 2 ;;
      -h|--help) print_usage; exit 0 ;;
      *) log_error "Unknown arg: $1"; print_usage; exit 1 ;;
    esac
  done
}

normalize_address() {
  local addr="$1"
  addr=$(echo "$addr" | sed -E "s~^[[:space:]]*https?://~~I; s~/*$~~; s/^[[:space:]]+//; s/[[:space:]]+$//; s/^[\"']|[\"']$//g")
  if [[ -z "$addr" ]]; then printf '%s' ""; return; fi
  if [[ "$addr" =~ ^[0-9]+$ ]]; then printf '127.0.0.1:%s' "$addr"; return; fi
  if [[ "$addr" != *:* ]]; then printf '%s:3500' "$addr"; return; fi
  printf '%s' "$addr"
}


# Extract [beacon-kit.node-api] enabled/address from app.toml
extract_node_api_from_app_toml() {
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
  local host="${addr%:*}"; local port="${addr##*:}"
  if [[ -z "$port" ]]; then return 1; fi
  local probe_host
  if [[ -z "$host" || "$host" == "0.0.0.0" || "$host" == "::" || "$host" == "[::]" ]]; then probe_host="127.0.0.1"; else probe_host="$host"; fi
  local base="http://$probe_host:$port"
  curl --silent --show-error --fail --max-time 4 "$base/eth/v1/node/syncing" >/dev/null 2>&1 || return 1
  return 0
}

predict_addresses() {
  local factory_addr="$1"; local rpc_url="$2"; local pubkey="$3"
  if ! have_cmd cast; then log_error "cast not found; install foundry (https://book.getfoundry.sh/)"; return 1; fi
  # Call and parse 4 addresses tuple
  local out
  out=$(cast call "$factory_addr" "predictStakingPoolContractsAddresses(bytes)(address,address,address,address)" "$pubkey" -r "$rpc_url") || return 1
  # Normalize output: handle tuple or newline-separated outputs -> a b c d
  out=$(echo "$out" | tr -d '()' | tr ',' ' ' | tr '\n' ' ' | tr -s ' ' ' ')
  local smart_operator staking_pool staking_rewards_vault incentive_collector
  read -r smart_operator staking_pool staking_rewards_vault incentive_collector <<< "$out"
  if [[ -z "$smart_operator" || -z "$staking_pool" || -z "$staking_rewards_vault" || -z "$incentive_collector" ]]; then return 1; fi
  
  log_info "Predicted contract addresses:"
  echo "  SmartOperator:          $smart_operator"
  echo "  StakingPool:            $staking_pool"
  echo "  StakingRewardsVault:    $staking_rewards_vault"
  echo "  IncentiveCollector:     $incentive_collector"
  return 0
}

main() {
  parse_args "$@"
  if [[ -z "$BEACOND_HOME" ]]; then log_error "Missing BEACOND_HOME in env.sh"; exit 1; fi
  if [[ ! -d "$BEACOND_HOME" ]]; then log_error "beacond_home not found: $BEACOND_HOME"; exit 1; fi

  local BEACOND_BIN
  if ! BEACOND_BIN=$(resolve_beacond_bin); then log_error "beacond binary not found (set in config or --beacond-bin or PATH)"; exit 1; fi

  # Attempt auto-detect of node API address from app.toml
  local APP_TOML=""
  local DETECTED_NODE_API_URL=""
  if APP_TOML=$(find_app_toml "$BEACOND_HOME"); then
    DETECTED_NODE_API_URL=$(extract_node_api_from_app_toml "$APP_TOML")
  fi

  # Resolve node api address: prefer env -> app.toml
  local NODE_API_URL=""
  if [[ -n "${NODE_API_ADDRESS:-}" ]]; then
    NODE_API_URL=$(normalize_address "$NODE_API_ADDRESS")
  elif [[ -n "$DETECTED_NODE_API_URL" ]]; then
    NODE_API_URL=$(normalize_address "$DETECTED_NODE_API_URL")
  fi

  if [[ -z "$NODE_API_URL" ]]; then
    log_error "Node API address not configured."
    if [[ -n "$APP_TOML" ]]; then
      log_error "Set [beacon-kit.node-api] enabled = true and address = HOST:PORT in: $APP_TOML"
    else
      log_error "Set NODE_API_ADDRESS in env.sh or [beacon-kit.node-api] in app.toml"
    fi
    log_error "Example: NODE_API_ADDRESS=\"127.0.0.1:3500\""
    exit 1
  else
    if ! maybe_probe_node_api "$NODE_API_URL"; then
      log_error "Node API not reachable at $NODE_API_URL"
      if [[ -n "$APP_TOML" ]]; then
        log_error "Ensure [beacon-kit.node-api] enabled = true and address is correct in: $APP_TOML, then restart your node"
      else
        log_error "Set correct NODE_API_ADDRESS in env.sh"
      fi
      exit 1
    fi
  fi

  local NETWORK
  NETWORK=$(get_network_from_genesis "$BEACOND_BIN" "$BEACOND_HOME")

  local PUBKEY
  if ! PUBKEY=$(get_validator_pubkey "$BEACOND_BIN" "$BEACOND_HOME"); then
    exit 1
  fi

  # Resolve RPC URL early (needed for withdrawal vault lookup)
  local RPC_URL
  RPC_URL=$(get_rpc_url_for_network "$NETWORK")
  if [[ -z "$RPC_URL" ]]; then
    log_error "Unknown network: $NETWORK"
    exit 1
  fi

  # Resolve factory address
  local FACTORY_ADDR
  FACTORY_ADDR=$(get_factory_address_for_network "$NETWORK")
  if [[ -z "$FACTORY_ADDR" ]]; then
    log_error "Factory address not available for network: $NETWORK"
    exit 1
  fi

  # Auto-detect withdrawal vault from factory
  local WITHDRAWAL_VAULT
  WITHDRAWAL_VAULT=$(get_withdrawal_vault_for_network "$NETWORK")
  if [[ -z "$WITHDRAWAL_VAULT" || "$WITHDRAWAL_VAULT" == "0x0000000000000000000000000000000000000000" ]]; then
    log_error "WithdrawalVault not available for network: $NETWORK"
    exit 1
  fi

  # Validate and normalize required addresses
  if [[ -z "$SHARES_RECIPIENT" ]]; then
    log_error "--sr <0x...> is required and must be a valid EVM address"
    exit 8
  fi
  SHARES_RECIPIENT=$(normalize_evm_address "$SHARES_RECIPIENT")
  if [[ -z "$SHARES_RECIPIENT" ]]; then
    log_error "--sr must be a valid EVM address"
    exit 8
  fi

  if [[ -z "$OPERATOR_ADDR" ]]; then
    log_error "--op <0x...> is required and must be a valid EVM address"
    exit 9
  fi
  OPERATOR_ADDR=$(normalize_evm_address "$OPERATOR_ADDR")
  if [[ -z "$OPERATOR_ADDR" ]]; then
    log_error "--op must be a valid EVM address"
    exit 9
  fi

  local amount_gwei
  amount_gwei=10000000000000
  local dep_out rc1=0
  dep_out=$("$BEACOND_BIN" --home "$BEACOND_HOME" deposit create-validator \
    "$WITHDRAWAL_VAULT" \
    "$amount_gwei" \
    -g "$(${BEACOND_BIN} --home "$BEACOND_HOME" genesis validator-root "$BEACOND_HOME/config/genesis.json" 2>/dev/null)" 2>&1) || rc1=$?
  
  if [[ $rc1 -ne 0 || -z "$dep_out" ]]; then
    log_error "deposit create-validator failed: $dep_out"
    exit 1
  fi
  local cred sig amt_used pk_used
  cred=$(echo "$dep_out" | awk '/credentials:/{print $2; exit}')
  sig=$(echo "$dep_out" | awk '/signature:/{print $2; exit}')
  amt_used=$(echo "$dep_out" | awk '/amount:/{print $2; exit}')
  pk_used=$(echo "$dep_out" | awk '/pubkey:/{print $2; exit}')
  if [[ -z "$cred" || -z "$sig" || -z "$amt_used" || -z "$pk_used" ]]; then
    log_error "Could not parse deposit parameters from beacond output"
    exit 1
  fi
  local vout rc2=0
  vout=$("$BEACOND_BIN" --home "$BEACOND_HOME" deposit validate "$pk_used" "$cred" "$amount_gwei" "$sig" -g "$(${BEACOND_BIN} --home "$BEACOND_HOME" genesis validator-root "$BEACOND_HOME/config/genesis.json" 2>/dev/null)" 2>&1) || rc2=$?
  
  if [[ $rc2 -ne 0 ]]; then
    log_error "deposit validate failed: $vout"
    exit 1
  fi
  log_info "Network: $NETWORK"
  log_info "Validator pubkey: $PUBKEY"
  log_info "Node API: $NODE_API_URL"
  log_info "Withdrawal Vault: $WITHDRAWAL_VAULT"
  log_success "Deposit validation: OK"
  echo ""

  # Always predict addresses
  if ! predict_addresses "$FACTORY_ADDR" "$RPC_URL" "$PUBKEY"; then
    log_error "prediction call failed"
    exit 1
  fi

  # Check if validator exists and get validator index
  local validator_exists="false"
  local VALIDATOR_INDEX=""
  if VALIDATOR_INDEX=$(get_validator_index_from_api "http://$NODE_API_URL" "$PUBKEY"); then
    validator_exists="true"
    log_info "Validator index: $VALIDATOR_INDEX"
    log_success "Validator already registered on beacon chain"
  else
    log_info "Validator not yet registered on beacon chain"
  fi
  echo ""

  # Branch: deployment vs activation
  if [[ "$validator_exists" != "true" ]]; then
    # Deployment flow: output deploy cast command to file
    local WITHDRAWAL_CREDENTIALS="$cred"
    local DEP_SIG="$sig"
    local deploy_cmd_file="deployment-command.sh"
    local wallet_args
    wallet_args=$(get_cast_wallet_args)
    
    cat > "$deploy_cmd_file" <<EOF
#!/usr/bin/env bash
# Deployment command for staking pool
# Validator pubkey: $PUBKEY
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

cast send $FACTORY_ADDR 'deployStakingPoolContracts(bytes,bytes,bytes,address,address)' "$PUBKEY" "$WITHDRAWAL_CREDENTIALS" "$DEP_SIG" $OPERATOR_ADDR $SHARES_RECIPIENT --value '10000ether' -r $RPC_URL $wallet_args
EOF
    
    chmod +x "$deploy_cmd_file"
    echo ""
    log_success "Deployment command written to: $deploy_cmd_file"
    log_info "Next steps:"
    echo "  1. Run: ./$deploy_cmd_file"
    echo "  2. Wait for deployment transaction to confirm"
    echo "  3. Re-run this script with the same parameters to activate"
  else
    # Activation flow: fetch proofs and print activation cast command
    local TIMESTAMP_ID="head"
    
    if ! ensure_jq; then
      exit 1
    fi
    
    # Fetch proofs in a loop until all slots agree
    local pubkey_proof_json credentials_proof_json balance_proof_json
    local slot_pubkey slot_credentials slot_balance slot_dec
    
    while true; do
      # Fetch pubkey proof
      pubkey_proof_json=$(curl -sS "http://${NODE_API_URL}/bkit/v1/proof/validator_pubkey/${TIMESTAMP_ID}/${VALIDATOR_INDEX}" 2>/dev/null) || {
        log_error "Failed to fetch validator pubkey proof"
        exit 1
      }
      
      # Fetch credentials proof
      credentials_proof_json=$(curl -sS "http://${NODE_API_URL}/bkit/v1/proof/validator_credentials/${TIMESTAMP_ID}/${VALIDATOR_INDEX}" 2>/dev/null) || {
        log_error "Failed to fetch validator credentials proof"
        exit 1
      }
      
      # Fetch balance proof
      balance_proof_json=$(curl -sS "http://${NODE_API_URL}/bkit/v1/proof/validator_balance/${TIMESTAMP_ID}/${VALIDATOR_INDEX}" 2>/dev/null) || {
        log_error "Failed to fetch validator balance proof"
        exit 1
      }
      
      # Extract slot from each proof's beacon_block_header
      slot_pubkey=$(echo "$pubkey_proof_json" | jq -r '.beacon_block_header.slot // empty')
      slot_credentials=$(echo "$credentials_proof_json" | jq -r '.beacon_block_header.slot // empty')
      slot_balance=$(echo "$balance_proof_json" | jq -r '.beacon_block_header.slot // empty')
      
      # Check if all slots agree
      if [[ -n "$slot_pubkey" && "$slot_pubkey" == "$slot_credentials" && "$slot_pubkey" == "$slot_balance" ]]; then
        log_success "All proofs agree on slot: $slot_pubkey"
        break
      else
        log_warn "Slot mismatch (pubkey: $slot_pubkey, credentials: $slot_credentials, balance: $slot_balance), refetching..."
        sleep 1
      fi
    done
    
    # Convert slot from hex to decimal and add 1
    local consensus_slot_dec el_block_number
    consensus_slot_dec=$((slot_pubkey))
    el_block_number=$((consensus_slot_dec + 1))
    
    log_info "Waiting for EL block number: $el_block_number"
    
    # Poll for the EL block until it's available
    local block_json timestamp_hex
    while true; do
      block_json=$(cast block "$el_block_number" --json -r "$RPC_URL" 2>/dev/null) && break
      sleep 1
    done
    
    timestamp_hex=$(echo "$block_json" | jq -r '.timestamp // empty')
    if [[ -z "$timestamp_hex" ]]; then
      log_error "Failed to extract timestamp from EL block $el_block_number"
      exit 1
    fi
    
    # Convert timestamp to decimal (it's already in unix time)
    slot_dec=$((timestamp_hex))
    log_success "Using timestamp from EL block: $slot_dec"
    echo ""
    
    # Extract validator data fields
    local v_pubkey v_withdrawal_creds v_balance
    v_pubkey=$(echo "$pubkey_proof_json" | jq -r '.validator_pubkey')
    v_withdrawal_creds=$(echo "$credentials_proof_json" | jq -r '.validator_withdrawal_credentials')
    v_balance=$(echo "$balance_proof_json" | jq -r '.validator_balance')
    
    # Convert balance from hex to decimal (gwei)
    local v_balance_dec
    v_balance_dec=$((v_balance))
    
    # Extract proof arrays (as JSON arrays of hex strings)
    local pubkey_proof_arr withdrawal_creds_proof_arr balance_proof_arr balance_leaf
    pubkey_proof_arr=$(echo "$pubkey_proof_json" | jq -c '.validator_pubkey_proof')
    withdrawal_creds_proof_arr=$(echo "$credentials_proof_json" | jq -c '.withdrawal_credentials_proof')
    balance_proof_arr=$(echo "$balance_proof_json" | jq -c '.balance_proof')
    balance_leaf=$(echo "$balance_proof_json" | jq -r '.balance_leaf')
    
    # Format proof arrays for cast (convert JSON array to space-separated hex values in brackets)
    local pubkey_proof_cast withdrawal_creds_proof_cast balance_proof_cast
    pubkey_proof_cast=$(echo "$pubkey_proof_arr" | jq -r '.[]' | tr '\n' ',' | sed 's/,$//')
    withdrawal_creds_proof_cast=$(echo "$withdrawal_creds_proof_arr" | jq -r '.[]' | tr '\n' ',' | sed 's/,$//')
    balance_proof_cast=$(echo "$balance_proof_arr" | jq -r '.[]' | tr '\n' ',' | sed 's/,$//')
    
    # Generate activation command
    local cmd_file="activation-command.sh"
    local wallet_args
    wallet_args=$(get_cast_wallet_args)
    
    # Write cast command to file
    cat > "$cmd_file" <<EOF
#!/usr/bin/env bash
# Activation command for staking pool
# Validator pubkey: $v_pubkey
# Validator index: $VALIDATOR_INDEX
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

cast send $FACTORY_ADDR \\
  'activateStakingPool((bytes,bytes,uint64,uint64),(bytes32[],bytes32[],bytes32[],bytes32),uint64)' \\
  "($v_pubkey,$v_withdrawal_creds,$v_balance_dec,$VALIDATOR_INDEX)" \\
  "([$pubkey_proof_cast],[$withdrawal_creds_proof_cast],[$balance_proof_cast],$balance_leaf)" \\
  "$slot_dec" \\
  -r $RPC_URL $wallet_args
EOF
    
    chmod +x "$cmd_file"
    
    echo ""
    log_success "Activation command written to: $cmd_file"
    log_warn "Execute within 10 minutes (proof timestamp validation)"
    log_info "Next step: Run ./$cmd_file"
  fi
}

main "$@"
