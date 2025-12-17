#!/usr/bin/env bash
set -euo pipefail

# Unstaking helper - generates commands to request withdrawal from your pool
# Run with --help for usage information

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib-common.sh"

# Load configuration if available
load_env "$SCRIPT_DIR"

CLI_AMOUNT=""
CLI_SHARES=""
CLI_CHAIN=""
CLI_RECEIVER=""
CLI_STAKING_POOL="${STAKING_POOL:-}"
CLI_AUTO_REDEEM=""

print_usage() {
  cat <<'USAGE'
unstake.sh

Generates a cast command to request withdrawal from a staking pool.

Usage:
  # External users requesting withdrawal from any pool:
  unstake.sh --amount 100 --receiver 0x... --staking-pool 0x...
  unstake.sh --shares 2500.5 --receiver 0x... --staking-pool 0x...
  
  # Validator operators (with BEACOND_HOME in env.sh):
  unstake.sh --amount 100 --receiver 0x...
  unstake.sh --shares 2500.5 --receiver 0x...
  
Required arguments:
  --amount BERA             Amount of BERA to withdraw (e.g., 100)
  OR
  --shares stBERA           Amount of stBERA shares to redeem (e.g., 2500.5)
  --receiver 0x...          Address to receive withdrawn BERA

Pool identification:
  --staking-pool 0x...      StakingPool address (required if BEACOND_HOME not configured)
  --chain mainnet|bepolia   Chain override (default: detected from BEACOND_HOME; direct mode defaults to mainnet)

Optional arguments:
  --auto-redeem             Redeem any ready withdrawal request NFTs (default: do not redeem)

Configuration (via env.sh):
  BEACOND_HOME              For auto-detecting pool from validator pubkey (optional)
  STAKING_POOL              Alternative to --staking-pool (optional)

Output:
  generated/unstake-command.sh

Note: Withdrawal requests create an NFT that must be used to complete the withdrawal.
The actual BERA will be available after the withdrawal cooldown period.
By default, the script will automatically redeem any ready withdrawal request NFTs.
USAGE
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      --amount) CLI_AMOUNT="$2"; shift 2 ;;
      --shares) CLI_SHARES="$2"; shift 2 ;;
      --receiver) CLI_RECEIVER="$2"; shift 2 ;;
      --staking-pool) CLI_STAKING_POOL="$2"; shift 2 ;;
      --chain) CLI_CHAIN="$2"; shift 2 ;;
      --auto-redeem) CLI_AUTO_REDEEM="true"; shift 1 ;;
      -h|--help) print_usage; exit 0 ;;
      *) log_error "Unknown arg: $1"; print_usage; exit 1 ;;
    esac
  done
}

get_withdrawal_vault_address() {
  local factory_addr="$1"; local rpc_url="$2"
  if ! have_cmd cast; then log_error "cast not found; install foundry (https://book.getfoundry.sh/)"; return 1; fi
  
  local out
  out=$(cast call "$factory_addr" "withdrawalVault()(address)" -r "$rpc_url" 2>&1) || return 1
  
  if [[ -z "$out" || "$out" == "0x0000000000000000000000000000000000000000" ]]; then
    return 1
  fi
  
  printf '%s' "$out"
  return 0
}

get_staking_pool_address() {
  local factory_addr="$1"; local rpc_url="$2"; local pubkey="$3"
  if ! have_cmd cast; then log_error "cast not found; install foundry (https://book.getfoundry.sh/)"; return 1; fi
  
  local out
  out=$(cast call "$factory_addr" "getCoreContracts(bytes)(address,address,address,address)" "$pubkey" -r "$rpc_url" 2>&1) || return 1
  
  # Parse the tuple response - second address is the staking pool
  out=$(echo "$out" | tr -d '()' | tr ',' ' ' | tr '\n' ' ' | tr -s ' ' ' ')
  local smart_operator staking_pool staking_rewards_vault incentive_collector
  read -r smart_operator staking_pool staking_rewards_vault incentive_collector <<< "$out"
  
  if [[ -z "$staking_pool" || "$staking_pool" == "0x0000000000000000000000000000000000000000" ]]; then
    return 1
  fi
  
  printf '%s' "$staking_pool"
  return 0
}

get_withdrawal_request_nfts() {
  local withdrawal_vault="$1"; local rpc_url="$2"; local user_address="$3"
  
  # Get the user's NFT balance
  local balance
  balance=$(cast call "$withdrawal_vault" "balanceOf(address)(uint256)" "$user_address" -r "$rpc_url" 2>/dev/null || echo "0")
  
  if [[ "$balance" == "0" ]]; then
    echo ""
    return 0
  fi
  
  # Get all token IDs owned by the user
  local token_ids=""
  for ((i=0; i<balance; i++)); do
    local token_id
    token_id=$(cast call "$withdrawal_vault" "tokenOfOwnerByIndex(address,uint256)(uint256)" "$user_address" "$i" -r "$rpc_url" 2>/dev/null || echo "")
    if [[ -n "$token_id" && "$token_id" != "0" ]]; then
      if [[ -z "$token_ids" ]]; then
        token_ids="$token_id"
      else
        token_ids="$token_ids $token_id"
      fi
    fi
  done
  
  echo "$token_ids"
  return 0
}

check_withdrawal_request_ready() {
  local withdrawal_vault="$1"; local rpc_url="$2"; local request_id="$3"
  
  # Get withdrawal request details
  local request_data
  request_data=$(cast call "$withdrawal_vault" "getWithdrawalRequest(uint256)(bytes,uint256,uint256,address,uint256)" "$request_id" -r "$rpc_url" 2>/dev/null || echo "")
  
  if [[ -z "$request_data" ]]; then
    return 1
  fi
  
  # Parse the response: pubkey, assetsRequested, sharesBurnt, user, requestBlock
  local pubkey assets_requested shares_burnt user request_block
  read -r pubkey assets_requested shares_burnt user request_block <<< "$(echo "$request_data" | tr -d '()' | tr ',' ' ')"

  # Determine readiness by simulating finalize; if it succeeds, it's ready
  if cast call "$withdrawal_vault" 'finalizeWithdrawalRequest(uint256)' "$request_id" -r "$rpc_url" >/dev/null 2>&1; then
    echo "$assets_requested"
    return 0
  else
    echo "0"
    return 1
  fi
}

redeem_withdrawal_requests() {
  local withdrawal_vault="$1"; local rpc_url="$2"; local user_address="$3"; local wallet_args="$4"
  
  local token_ids
  token_ids=$(get_withdrawal_request_nfts "$withdrawal_vault" "$rpc_url" "$user_address")
  
  if [[ -z "$token_ids" ]]; then
    log_info "No withdrawal request NFTs found for $user_address"
    return 0
  fi
  
  log_info "Found withdrawal request NFTs: $token_ids"
  
  local ready_requests=""
  local total_amount=0
  
  # Check which requests are ready for redemption
  for token_id in $token_ids; do
    local amount
    if amount=$(check_withdrawal_request_ready "$withdrawal_vault" "$rpc_url" "$token_id"); then
      if [[ -z "$ready_requests" ]]; then
        ready_requests="$token_id"
      else
        ready_requests="$ready_requests $token_id"
      fi
      total_amount=$((total_amount + amount))
      log_info "Request $token_id is ready for redemption (${amount} wei)"
    else
      log_info "Request $token_id is not yet ready for redemption"
    fi
  done
  
  if [[ -z "$ready_requests" ]]; then
    log_info "No withdrawal requests are ready for redemption yet"
    return 0
  fi
  
  log_info "Ready to redeem requests: $ready_requests"
  log_info "Total amount to redeem: $(echo "$total_amount" | xargs cast from-wei) BERA"
  
  # Generate redemption commands
  mkdir -p generated
  local cmd_file="generated/redeem-command.sh"
  cat > "$cmd_file" <<EOF
#!/usr/bin/env bash
# Redeem withdrawal request NFTs
# Withdrawal vault: $withdrawal_vault
# Ready requests: $ready_requests
# Total amount: $(echo "$total_amount" | xargs cast from-wei) BERA
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

echo "Redeeming withdrawal request NFTs..."

# Redeem each ready request
EOF
  
  for token_id in $ready_requests; do
    cat >> "$cmd_file" <<EOF
echo "Redeeming request $token_id..."
cast send $withdrawal_vault \\
  'finalizeWithdrawalRequest(uint256)' \\
  $token_id \\
  -r $rpc_url $wallet_args
EOF
  done
  
  cat >> "$cmd_file" <<EOF

echo "All withdrawal requests redeemed successfully!"
echo "Check your BERA balance:"
echo "  cast balance $user_address -r $rpc_url | xargs cast from-wei"
EOF
  
  chmod +x "$cmd_file"
  
  log_success "Redemption command written to: $cmd_file"
  log_info "Next step: Run ./$cmd_file"
  
  return 0
}

check_pool_active() {
  local staking_pool="$1"; local rpc_url="$2"
  
  log_info "=== Checking Pool Status ==="
  
  # Check if pool is active
  local is_active
  is_active=$(cast call "$staking_pool" "isActive()(bool)" -r "$rpc_url" 2>/dev/null || echo "false")
  log_info "Pool Active: $is_active"
  
  if [[ "$is_active" != "true" ]]; then
    log_error "Pool is not active. Cannot request withdrawal."
    return 1
  fi
  
  log_success "Pool is active. Proceeding with withdrawal request."
  return 0
}

main() {
  parse_args "$@"

  # AUDIT-ONLY MODE: no parameters provided -> list existing withdrawal requests for current user
  local AUDIT_ONLY=""
  if [[ $# -eq 0 || ( -z "${CLI_AMOUNT:-}" && -z "${CLI_SHARES:-}" && -z "${CLI_RECEIVER:-}" ) ]]; then
    AUDIT_ONLY="true"
  fi

  # Common prechecks

  if ! have_cmd cast; then log_error "cast not found; install foundry (https://book.getfoundry.sh/)"; exit 1; fi
  if ! ensure_bc; then exit 1; fi

  # In generation mode, validate inputs; in audit mode, skip
  local RECEIVER="${CLI_RECEIVER:-}"
  if [[ -z "$AUDIT_ONLY" ]]; then
    # Validate amount
    if [[ -z "${CLI_AMOUNT:-}" && -z "${CLI_SHARES:-}" ]]; then
      log_error "Provide either --amount (BERA) or --shares (stBERA)"
      exit 1
    fi
    if [[ -n "${CLI_AMOUNT:-}" ]]; then
      if ! validate_amount "${CLI_AMOUNT:-}" "amount"; then
        exit 1
      fi
    fi
    if [[ -n "${CLI_SHARES:-}" ]]; then
      if ! validate_amount "${CLI_SHARES:-}" "shares"; then
        exit 1
      fi
    fi
    # Validate receiver address
    RECEIVER=$(normalize_evm_address "$RECEIVER")
    if [[ -z "$RECEIVER" ]]; then
      log_error "--receiver must be a valid EVM address"
      exit 1
    fi
    # No manual fee override; fee will be probed automatically
  fi

  local STAKING_POOL=""
  local WITHDRAWAL_VAULT=""
  local CHAIN="${CLI_CHAIN:-}"
  local PUBKEY=""
  
  # Check if staking pool provided directly
  if [[ -n "$CLI_STAKING_POOL" ]]; then
    STAKING_POOL=$(normalize_evm_address "$CLI_STAKING_POOL")
    if [[ -z "$STAKING_POOL" ]]; then
      log_error "--staking-pool must be a valid EVM address"
      exit 8
    fi
    log_info "Using provided staking pool: $STAKING_POOL"
    
    # For direct staking pool mode, we need to get the withdrawal vault from the factory
    # Default to mainnet unless --chain provided
    local RPC_URL
    if [[ -n "$CHAIN" ]]; then
      RPC_URL=$(get_rpc_url_for_network "$CHAIN")
    fi
    if [[ -z "$RPC_URL" ]]; then
      RPC_URL="https://rpc.berachain.com"
      CHAIN="mainnet"
    fi
    local FACTORY_ADDR
    FACTORY_ADDR=$(get_factory_address_for_network "$CHAIN")
    
    if ! WITHDRAWAL_VAULT=$(get_withdrawal_vault_address "$FACTORY_ADDR" "$RPC_URL"); then
      log_error "Failed to get withdrawal vault address"
      exit 1
    fi
  else
    # Need to auto-detect from beacond (via env.sh)
    local BEACOND_HOME="${BEACOND_HOME:-}"
    if [[ -z "$BEACOND_HOME" ]]; then
      log_error "Missing --staking-pool or BEACOND_HOME in env.sh"
      log_error "Provide either the staking pool address or configure BEACOND_HOME in env.sh"
      exit 1
    fi
    if [[ ! -d "$BEACOND_HOME" ]]; then log_error "beacond_home not found: $BEACOND_HOME"; exit 1; fi

    local beacond_bin
    beacond_bin=$(resolve_beacond_bin)
    if [[ -z "$beacond_bin" ]]; then log_error "beacond binary not found"; exit 1; fi

    if ! ensure_jq; then
      exit 1
    fi

    if [[ -z "$CHAIN" ]]; then
      CHAIN=$(get_network_from_genesis "$beacond_bin" "$BEACOND_HOME")
    fi
    PUBKEY=$(get_validator_pubkey "$beacond_bin" "$BEACOND_HOME")
    if [[ -z "$PUBKEY" ]]; then
      exit 1
    fi

    log_info "Chain: $CHAIN"
    log_info "Validator pubkey: $PUBKEY"

    # Resolve RPC URL
    local RPC_URL
    RPC_URL=$(get_rpc_url_for_network "$CHAIN")
    if [[ -z "$RPC_URL" ]]; then
      log_error "Unknown chain: $CHAIN"
      exit 1
    fi

    # Resolve factory address
    local FACTORY_ADDR
    FACTORY_ADDR=$(get_factory_address_for_network "$CHAIN")
    if [[ -z "$FACTORY_ADDR" ]]; then
      log_error "Factory address not available for chain: $CHAIN"
      exit 1
    fi

    # Get staking pool address
    if ! STAKING_POOL=$(get_staking_pool_address "$FACTORY_ADDR" "$RPC_URL" "$PUBKEY"); then
      log_error "Failed to get staking pool address"
      log_error "Ensure your staking pool has been deployed"
      exit 1
    fi

    # Get withdrawal vault address
    if ! WITHDRAWAL_VAULT=$(get_withdrawal_vault_address "$FACTORY_ADDR" "$RPC_URL"); then
      log_error "Failed to get withdrawal vault address"
      exit 1
    fi
  fi
  
  # Resolve RPC URL if not already set (for staking-pool-only mode)
  if [[ -z "${RPC_URL:-}" ]]; then
    # Get network from RPC (we don't have beacond in this mode, so use mainnet default)
    RPC_URL="https://rpc.berachain.com"
  fi

  log_info "Staking pool: $STAKING_POOL"
  log_info "Withdrawal vault: $WITHDRAWAL_VAULT"
  if [[ -z "$AUDIT_ONLY" ]]; then
    if [[ -n "${CLI_AMOUNT:-}" ]]; then
      log_info "Amount to withdraw: ${CLI_AMOUNT} BERA"
    fi
    if [[ -n "${CLI_SHARES:-}" ]]; then
      log_info "Shares to redeem: ${CLI_SHARES} stBERA"
    fi
    log_info "Receiver: $RECEIVER"
    echo ""
  fi

  # Check if pool is active
  check_pool_active "$STAKING_POOL" "$RPC_URL"

  # Check for existing withdrawal request NFTs
  log_info "Checking for existing withdrawal request NFTs..."
  # Determine user address: in generation mode, use RECEIVER; in audit mode, derive from PRIVATE_KEY if available
  local USER_ADDR="$RECEIVER"
  if [[ -n "$AUDIT_ONLY" ]]; then
    if [[ -n "${PRIVATE_KEY:-}" ]]; then
      USER_ADDR=$(cast wallet address --private-key "$PRIVATE_KEY" 2>/dev/null || echo "")
    fi
    if [[ -z "$USER_ADDR" ]]; then
      log_error "Cannot determine user address. Set PRIVATE_KEY or provide --receiver."
      exit 1
    fi
  fi
  # List NFTs and readiness without generating commands in audit mode
  local token_ids
  token_ids=$(get_withdrawal_request_nfts "$WITHDRAWAL_VAULT" "$RPC_URL" "$USER_ADDR")
  if [[ -z "$token_ids" ]]; then
    log_info "No withdrawal request NFTs found for $USER_ADDR"
  else
    log_info "Found withdrawal request NFTs: $token_ids"
    local total_ready=0
    local total_ready_amt=0
    for token_id in $token_ids; do
      local amt
      if amt=$(check_withdrawal_request_ready "$WITHDRAWAL_VAULT" "$RPC_URL" "$token_id"); then
        total_ready=$((total_ready + 1))
        total_ready_amt=$((total_ready_amt + amt))
        log_info "Request $token_id is ready for redemption ($(cast_from_wei_safe "$amt") BERA)"
      else
        log_info "Request $token_id is not yet ready for redemption"
      fi
    done
    log_info "Ready to redeem: $total_ready"
    log_info "Total ready amount: $(cast_from_wei_safe "$total_ready_amt") BERA"
  fi
  if [[ -n "$AUDIT_ONLY" ]]; then
    # Audit-only ends here
    exit 0
  fi

  # Convert amount/shares for contract calls
  local AMOUNT_IN_GWEI=""
  local SHARES_IN_WEI=""
  if [[ -n "${CLI_AMOUNT:-}" ]]; then
    AMOUNT_IN_GWEI=$(echo "$CLI_AMOUNT * 1000000000" | bc)
    AMOUNT_IN_GWEI=${AMOUNT_IN_GWEI%.*}
  fi
  if [[ -n "${CLI_SHARES:-}" ]]; then
    SHARES_IN_WEI=$(cast to-wei "$CLI_SHARES")
  fi

  # Probe required fee if not provided
  probe_fee() {
    local vault="$1" pubkey="$2" mode="$3" amount_or_shares="$4" rpc="$5" from_addr="$6"
    local candidates=(0 100000000000000 300000000000000 500000000000000 1000000000000000 2000000000000000 5000000000000000 10000000000000000)
    local c
    for c in "${candidates[@]}"; do
      if [[ "$mode" == "assets" ]]; then
        if cast call "$vault" 'requestWithdrawal(bytes,uint64,uint256)(uint256)' "$pubkey" "$amount_or_shares" "$c" --from "$from_addr" --value "$c" -r "$rpc" >/dev/null 2>&1; then
          echo "$c"; return 0; fi
      else
        if cast call "$vault" 'requestRedeem(bytes,uint256,uint256)(uint256)' "$pubkey" "$amount_or_shares" "$c" --from "$from_addr" --value "$c" -r "$rpc" >/dev/null 2>&1; then
          echo "$c"; return 0; fi
      fi
    done
    # fallback to 0.01 ether
    echo 10000000000000000
    return 0
  }

  # Always probe required fee (no manual override)
  local REQUIRED_FEE_WEI=""
  # Need user address to simulate
  local SIM_FROM="$RECEIVER"
  if [[ -z "$SIM_FROM" && -n "${PRIVATE_KEY:-}" ]]; then
    SIM_FROM=$(cast wallet address --private-key "$PRIVATE_KEY" 2>/dev/null || echo "")
  fi
  if [[ -z "$SIM_FROM" ]]; then
    log_warn "Could not determine user address to probe fee; defaulting to 0.01 BERA"
    REQUIRED_FEE_WEI=10000000000000000
  else
    if [[ -n "${AMOUNT_IN_GWEI:-}" ]]; then
      REQUIRED_FEE_WEI=$(probe_fee "$WITHDRAWAL_VAULT" "$PUBKEY" assets "$AMOUNT_IN_GWEI" "$RPC_URL" "$SIM_FROM")
    else
      REQUIRED_FEE_WEI=$(probe_fee "$WITHDRAWAL_VAULT" "$PUBKEY" shares "$SHARES_IN_WEI" "$RPC_URL" "$SIM_FROM")
    fi
  fi
  local MAX_FEE
  MAX_FEE=$(cast from-wei "$REQUIRED_FEE_WEI")
  log_info "Fee (auto): ${MAX_FEE} BERA"

  # Auto-redeem only if explicitly requested
  if [[ -n "$CLI_AUTO_REDEEM" ]]; then
    redeem_withdrawal_requests "$WITHDRAWAL_VAULT" "$RPC_URL" "$RECEIVER" "$(get_cast_wallet_args)"
    echo ""
  else
    log_info "Auto-redeem not requested (use --auto-redeem to redeem ready NFTs)"
    echo ""
  fi

  # Generate unstake command
  local cmd_file="generated/unstake-command.sh"
  local wallet_args
  wallet_args=$(get_cast_wallet_args)
  
  if [[ -n "${PUBKEY:-}" ]]; then
    # We have the pubkey, can generate the full command
    if [[ -n "${AMOUNT_IN_GWEI:-}" ]]; then
      cat > "$cmd_file" <<EOF
#!/usr/bin/env bash
# Unstake command for staking pool
# Staking pool: $STAKING_POOL
# Withdrawal vault: $WITHDRAWAL_VAULT
# Amount: ${CLI_AMOUNT} BERA (${AMOUNT_IN_GWEI} GWei)
# Receiver: $RECEIVER
# Fee: ${MAX_FEE} BERA
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

# Request withdrawal (creates NFT)
REQUEST_ID=\$(cast send $WITHDRAWAL_VAULT \\
  'requestWithdrawal(bytes,uint64,uint256)(uint256)' \\
  '$PUBKEY' \\
  $AMOUNT_IN_GWEI \\
  ${MAX_FEE}ether \\
  --value ${MAX_FEE}ether \\
  -r $RPC_URL $wallet_args | grep -o '0x[0-9a-fA-F]*' | tail -1)

echo "Withdrawal request ID: \$REQUEST_ID"
echo "Check your NFT balance to see the withdrawal request:"
echo "  cast call $WITHDRAWAL_VAULT 'balanceOf(address)(uint256)' $RECEIVER -r $RPC_URL"
echo ""
echo "After the withdrawal cooldown period, complete the withdrawal:"
echo "  cast send $WITHDRAWAL_VAULT 'finalizeWithdrawalRequest(uint256)' \$REQUEST_ID -r $RPC_URL $wallet_args"
EOF
    else
      cat > "$cmd_file" <<EOF
#!/usr/bin/env bash
# Unstake command for staking pool
# Staking pool: $STAKING_POOL
# Withdrawal vault: $WITHDRAWAL_VAULT
# Shares: ${CLI_SHARES} stBERA (${SHARES_IN_WEI} wei)
# Receiver: $RECEIVER
# Fee: ${MAX_FEE} BERA
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

# Request redeem (creates NFT)
REQUEST_ID=\$(cast send $WITHDRAWAL_VAULT \\
  'requestRedeem(bytes,uint256,uint256)(uint256)' \\
  '$PUBKEY' \\
  $SHARES_IN_WEI \\
  ${MAX_FEE}ether \\
  --value ${MAX_FEE}ether \\
  -r $RPC_URL $wallet_args | grep -o '0x[0-9a-fA-F]*' | tail -1)

echo "Redeem request ID: \$REQUEST_ID"
echo "Check your NFT balance to see the withdrawal request:"
echo "  cast call $WITHDRAWAL_VAULT 'balanceOf(address)(uint256)' $RECEIVER -r $RPC_URL"
echo ""
echo "After the withdrawal cooldown period, complete the withdrawal:"
echo "  cast send $WITHDRAWAL_VAULT 'finalizeWithdrawalRequest(uint256)' \$REQUEST_ID -r $RPC_URL $wallet_args"
EOF
    fi
  else
    # No pubkey available, provide instructions
    cat > "$cmd_file" <<EOF
#!/usr/bin/env bash
# Unstake command for staking pool (requires validator pubkey)
# Staking pool: $STAKING_POOL
# Withdrawal vault: $WITHDRAWAL_VAULT
# Amount: ${CLI_AMOUNT} BERA (${AMOUNT_IN_GWEI} GWei)
# Receiver: $RECEIVER
# Fee: ${MAX_FEE} BERA
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

echo "Error: Validator pubkey required for withdrawal request"
echo "Please provide the validator pubkey and run:"
echo "  cast send $WITHDRAWAL_VAULT \\\\" 
echo "    'requestWithdrawal(bytes,uint64,uint256)(uint256)' \\\\" 
echo "    'VALIDATOR_PUBKEY_HERE' \\\\" 
echo "    ${AMOUNT_IN_GWEI:-<AMOUNT_IN_GWEI>} \\\\" 
echo "    ${MAX_FEE}ether \\\\" 
echo "    --value ${MAX_FEE}ether \\\\" 
echo "    -r $RPC_URL $wallet_args"
echo "OR redeem by shares:"
echo "  cast send $WITHDRAWAL_VAULT \\\\" 
echo "    'requestRedeem(bytes,uint256,uint256)(uint256)' \\\\" 
echo "    'VALIDATOR_PUBKEY_HERE' \\\\" 
echo "    <SHARES_IN_WEI> \\\\" 
echo "    ${MAX_FEE}ether \\\\" 
echo "    --value ${MAX_FEE}ether \\\\" 
echo "    -r $RPC_URL $wallet_args"
echo ""
echo "After the withdrawal cooldown period, complete the withdrawal:"
echo "  cast send $WITHDRAWAL_VAULT 'finalizeWithdrawalRequest(uint256)' REQUEST_ID -r $RPC_URL $wallet_args"
EOF
  fi
  
  chmod +x "$cmd_file"
  
  log_success "Unstake command written to: $cmd_file"
  log_info "Next step: Run ./$cmd_file"
  echo ""
  log_info "Note: This creates a withdrawal request NFT. The actual BERA will be available"
  log_info "after the withdrawal cooldown period and must be completed with the NFT."
  echo ""
  log_info "Check your stBERA balance before withdrawal:"
  echo "  cast call $STAKING_POOL 'balanceOf(address)(uint256)' $RECEIVER -r $RPC_URL | xargs cast from-wei"
}

main "$@"
