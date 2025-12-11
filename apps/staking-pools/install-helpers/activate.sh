#!/usr/bin/env bash
set -euo pipefail

# Staking pool activation helper
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

Activates a deployed staking pool for your validator.

Usage:
  activate.sh --sr 0x... --op 0x...
  
Required arguments:
  --sr 0x...                Shares recipient address  
  --op 0x...                Operator address

Note: Generates cast commands in temporary files for review before execution.
The pool must already be deployed (use register.sh first).
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

main() {
  parse_args "$@"
  
  # Use shared setup function
  if ! setup_staking_pool_env; then
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

  log_info "Network: $network"
  log_info "Validator pubkey: $pubkey"
  log_info "Node API: $node_api_url"
  echo ""

  # Predict addresses
  local predicted_staking_pool
  predicted_staking_pool=$(predict_and_display_addresses "$factory_addr" "$rpc_url" "$pubkey")
  if [[ -z "$predicted_staking_pool" ]]; then
    exit 1
  fi
  # Trim whitespace from captured address
  predicted_staking_pool=$(echo "$predicted_staking_pool" | tr -d '[:space:]')
  echo ""

  # Check if staking pool contract exists
  local pool_exists="false"
  local pool_is_paused=""
  if [[ -n "$predicted_staking_pool" && "$predicted_staking_pool" != "0x0000000000000000000000000000000000000000" ]]; then
    local pool_code
    pool_code=$(cast code "$predicted_staking_pool" -r "$rpc_url" 2>/dev/null || echo "0x")
    if [[ -n "$pool_code" && "$pool_code" != "0x" ]]; then
      pool_exists="true"

      # Check if pool is paused (needs activation)
      local paused_result
      paused_result=$(cast_call_clean "$predicted_staking_pool" "paused()(bool)" -r "$rpc_url" 2>/dev/null)
      if [[ $? -eq 0 && -n "$paused_result" ]]; then
        pool_is_paused="$paused_result"
        if [[ "$pool_is_paused" == "true" ]]; then
          log_info "Pool is paused and needs activation"
        else
          log_success "Pool is already activated - no action needed"
          exit 0
        fi
      else
        log_warn "Could not determine pool pause status, assuming paused"
        pool_is_paused="true"
      fi
    fi
  fi

  if [[ "$pool_exists" != "true" ]]; then
    log_error "Staking pool contract not found at predicted address: $predicted_staking_pool"
    log_error "Deploy the pool first using register.sh"
    exit 1
  fi

  # Check if validator exists and get validator index
  local validator_exists="false"
  local validator_index=""
  validator_index=$(get_validator_index_from_api "http://$node_api_url" "$pubkey")
  if [[ -n "$validator_index" ]]; then
    validator_exists="true"
    log_info "Validator index: $validator_index"
    log_success "Validator registered on beacon chain"
  else
    log_error "Validator not yet registered on beacon chain"
    log_error "Wait for validator registration before activating the pool"
    exit 1
  fi
  echo ""

  # If pool is already activated, exit
  if [[ "$pool_is_paused" != "true" ]]; then
    log_success "Pool already exists and is activated - no action needed"
    exit 0
  fi

  # Activation flow: fetch proofs and print activation cast command
  if ! ensure_jq; then
    exit 1
  fi

  local timestamp_id="head"
  
  # Fetch proofs in a loop until all slots agree
  local pubkey_proof_json credentials_proof_json balance_proof_json
  local slot_pubkey slot_credentials slot_balance slot_dec
  
  while true; do
    # Fetch pubkey proof
    pubkey_proof_json=$(curl -sS "http://${node_api_url}/bkit/v1/proof/validator_pubkey/${timestamp_id}/${validator_index}" 2>/dev/null) || {
      log_error "Failed to fetch validator pubkey proof"
      exit 1
    }
    
    # Fetch credentials proof
    credentials_proof_json=$(curl -sS "http://${node_api_url}/bkit/v1/proof/validator_credentials/${timestamp_id}/${validator_index}" 2>/dev/null) || {
      log_error "Failed to fetch validator credentials proof"
      exit 1
    }
    
    # Fetch balance proof
    balance_proof_json=$(curl -sS "http://${node_api_url}/bkit/v1/proof/validator_balance/${timestamp_id}/${validator_index}" 2>/dev/null) || {
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
    block_json=$(cast block "$el_block_number" --json -r "$rpc_url" 2>/dev/null) && break
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
# Validator index: $validator_index
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

cast send $factory_addr \\
  'activateStakingPool((bytes,bytes,uint64,uint64),(bytes32[],bytes32[],bytes32[],bytes32),uint64)' \\
  "($v_pubkey,$v_withdrawal_creds,$v_balance_dec,$validator_index)" \\
  "([$pubkey_proof_cast],[$withdrawal_creds_proof_cast],[$balance_proof_cast],$balance_leaf)" \\
  "$slot_dec" \\
  -r $rpc_url $wallet_args
EOF
  
  chmod +x "$cmd_file"
  
  echo ""
  log_success "Activation command written to: $cmd_file"
  log_warn "Execute within 10 minutes (proof timestamp validation)"
  log_info "Next step: Run ./$cmd_file"
}

main "$@"
