#!/usr/bin/env bash
set -euo pipefail

# Staking pool registration (deployment) helper
# Run with --help for usage information

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib-common.sh"

# Load configuration if available
load_env "$SCRIPT_DIR"

OPERATOR_ADDR=""
SHARES_RECIPIENT=""

print_usage() {
  cat <<'USAGE'
register.sh

Deploys (registers) a staking pool for your validator.

Usage:
  register.sh --sr 0x... --op 0x...
  
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

  # Check if staking pool contract already exists
  local pool_exists="false"
  local pool_is_paused=""
  if [[ -n "$predicted_staking_pool" && "$predicted_staking_pool" != "0x0000000000000000000000000000000000000000" ]]; then
    local pool_code
    pool_code=$(cast code "$predicted_staking_pool" -r "$rpc_url" 2>/dev/null || echo "0x")
    if [[ -n "$pool_code" && "$pool_code" != "0x" ]]; then
      pool_exists="true"

      local paused_result
      paused_result=$(cast_call_clean "$predicted_staking_pool" "paused()(bool)" -r "$rpc_url" 2>/dev/null)
      if [[ $? -eq 0 && -n "$paused_result" ]]; then
        pool_is_paused="$paused_result"
        if [[ "$pool_is_paused" == "true" ]]; then
          log_info "Pool is paused and needs activation"
        else
          log_success "Pool is already deployed and activated - no action needed"
          exit 0
        fi
      else
        log_warn "Could not determine pool pause status, assuming paused"
        pool_is_paused="true"
      fi
    fi
  fi

  # Check if validator exists
  local validator_exists="false"
  local validator_index=""
  validator_index=$(get_validator_index_from_api "http://$node_api_url" "$pubkey")
  if [[ -n "$validator_index" ]]; then
    validator_exists="true"
    log_info "Validator index: $validator_index"
    log_info "Validator already registered on beacon chain"
  else
    log_info "Validator not yet registered on beacon chain"
  fi
  echo ""

  # If pool already exists and is not paused, nothing to do
  if [[ "$pool_exists" == "true" && "$pool_is_paused" != "true" ]]; then
    log_success "Pool already exists and is activated - no action needed"
    exit 0
  fi

  # If pool exists but is paused, validator must be registered to activate
  if [[ "$pool_exists" == "true" && "$pool_is_paused" == "true" && "$validator_exists" != "true" ]]; then
    log_error "Pool exists but validator is not yet registered on beacon chain"
    log_error "Wait for validator registration, then use activate.sh to activate the pool"
    exit 1
  fi

  # Create deposit and validate it
  local amount_gwei
  amount_gwei=10000000000000
  local dep_out rc1=0
  dep_out=$("$beacond_bin" --home "$BEACOND_HOME" deposit create-validator \
    "$withdrawal_vault" \
    "$amount_gwei" \
    -g "$("${beacond_bin}" --home "$BEACOND_HOME" genesis validator-root "$BEACOND_HOME/config/genesis.json" 2>/dev/null)" 2>&1) || rc1=$?
  
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
  
  local genesis_root
  genesis_root=$("${beacond_bin}" --home "$BEACOND_HOME" genesis validator-root "$BEACOND_HOME/config/genesis.json" 2>/dev/null)
  local vout rc2=0
  vout=$("$beacond_bin" --home "$BEACOND_HOME" deposit validate "$pk_used" "$cred" "$amount_gwei" "$sig" -g "$genesis_root" 2>&1) || rc2=$?
  
  if [[ $rc2 -ne 0 ]]; then
    log_error "deposit validate failed: $vout"
    exit 1
  fi
  
  log_success "Deposit validation: OK"
  echo ""

  # Generate deployment command
  local deploy_cmd_file="deployment-command.sh"
  local wallet_args
  wallet_args=$(get_cast_wallet_args)
  
  cat > "$deploy_cmd_file" <<EOF
#!/usr/bin/env bash
# Deployment command for staking pool
# Validator pubkey: $pubkey
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

cast send $factory_addr 'deployStakingPoolContracts(bytes,bytes,bytes,address,address)' "$pubkey" "$cred" "$sig" $OPERATOR_ADDR $SHARES_RECIPIENT --value '10000ether' -r $rpc_url $wallet_args
EOF
  
  chmod +x "$deploy_cmd_file"
  echo ""
  log_success "Deployment command written to: $deploy_cmd_file"
  log_info "Next steps:"
  echo "  1. Run: ./$deploy_cmd_file"
  echo "  2. Wait for deployment transaction to confirm"
  if [[ "$validator_exists" != "true" ]]; then
    echo "  3. Wait for validator to be registered on beacon chain (check with: ./status.sh)"
  fi
  echo "  4. Run activate.sh with the same parameters to activate the pool"
}

main "$@"
