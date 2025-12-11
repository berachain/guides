#!/usr/bin/env bash
set -euo pipefail

# Staking pool deployment verification helper
# Run with --help for usage information

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib-common.sh"

# Load configuration if available
load_env "$SCRIPT_DIR"

print_usage() {
  cat <<'USAGE'
status.sh

Verifies staking pool deployment and checks activation status. 
Automatically detects chain, validator pubkey, and delegation handler.

Usage:
  status.sh

USAGE
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      -h|--help) print_usage; exit 0 ;;
      *) log_error "Unknown arg: $1"; print_usage; exit 1 ;;
    esac
  done
}

main() {
  parse_args "$@"
  
  if [[ -z "$BEACOND_HOME" ]]; then log_error "Missing BEACOND_HOME in env.sh"; exit 1; fi
  if [[ ! -d "$BEACOND_HOME" ]]; then log_error "beacond_home not found: $BEACOND_HOME"; exit 1; fi

  # Resolve beacond binary (respects BEACOND_BIN env var if set)
  local beacond_bin
  beacond_bin=$(resolve_beacond_bin)
  if [[ -z "$beacond_bin" ]]; then log_error "beacond binary not found (set BEACOND_BIN in env.sh or ensure beacond is in PATH)"; exit 1; fi

  if ! have_cmd cast; then log_error "cast not found; install foundry (https://book.getfoundry.sh/)"; exit 1; fi
  if ! ensure_jq; then
    exit 1
  fi

  local CHAIN
  CHAIN=$(get_network_from_genesis "$beacond_bin" "$BEACOND_HOME")

  local PUBKEY
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
  
  # Check if this is a delegated pool
  local DELEGATION_HANDLER=""
  local DELEGATION_HANDLER_FACTORY
  DELEGATION_HANDLER_FACTORY=$(get_delegation_handler_factory_for_network "$CHAIN")
  
  if [[ -n "$DELEGATION_HANDLER_FACTORY" && "$DELEGATION_HANDLER_FACTORY" != "0x0000000000000000000000000000000000000000" ]]; then
    DELEGATION_HANDLER=$(get_delegation_handler "$DELEGATION_HANDLER_FACTORY" "$PUBKEY" "$RPC_URL")
    
    if [[ -n "$DELEGATION_HANDLER" && "$DELEGATION_HANDLER" != "0x0000000000000000000000000000000000000000" ]]; then
      log_info "✓ Delegated pool detected"
      log_info "  DelegationHandler: $DELEGATION_HANDLER"
      
      # Get delegation handler state
      local delegated_amount delegated_amount_available staking_pool
      delegated_amount=$(cast_call_clean "$DELEGATION_HANDLER" "delegatedAmount()(uint256)" -r "$RPC_URL" 2>/dev/null || echo "")
      delegated_amount_available=$(cast_call_clean "$DELEGATION_HANDLER" "delegatedAmountAvailable()(uint256)" -r "$RPC_URL" 2>/dev/null || echo "")
      staking_pool=$(cast_call_clean "$DELEGATION_HANDLER" "stakingPool()(address)" -r "$RPC_URL" 2>/dev/null || echo "")
      
      if [[ -n "$delegated_amount" ]]; then
        local delegated_bera delegated_available_bera
        delegated_bera=$(cast from-wei "$delegated_amount" 2>/dev/null || echo "$delegated_amount wei")
        delegated_available_bera=$(cast from-wei "$delegated_amount_available" 2>/dev/null || echo "$delegated_amount_available wei")
        
        echo "  Total delegated:     $delegated_bera BERA"
        echo "  Available:           $delegated_available_bera BERA"
        
        # Derive state from variables
        if [[ "$delegated_amount" != "0" ]]; then
          echo "  State:               Delegated"
        elif [[ -n "$staking_pool" && "$staking_pool" != "0x0000000000000000000000000000000000000000" ]]; then
          echo "  State:               Undelegated"
        else
          echo "  State:               Uninitialized"
        fi
      fi
    fi
  fi
  echo ""

  # Resolve factory address
  local FACTORY_ADDR
  FACTORY_ADDR=$(get_factory_address_for_network "$CHAIN")
  if [[ -z "$FACTORY_ADDR" ]]; then
    log_error "Factory address not available for chain: $CHAIN"
    exit 1
  fi
  
  # Resolve beacon deposit address
  local BEACON_DEPOSIT_ADDR
  BEACON_DEPOSIT_ADDR=$(get_beacon_deposit_address)
  
  local contracts_json
  local rc=0
  contracts_json=$(cast call "$FACTORY_ADDR" "getCoreContracts(bytes)(address,address,address,address)" "$PUBKEY" -r "$RPC_URL" 2>&1) || rc=$?
  
  if [[ $rc -ne 0 ]]; then
    log_error "Failed to get core contracts from factory"
    log_error "This likely means the staking pool has not been deployed yet"
    exit 1
  fi
  
  # Parse the tuple response
  contracts_json=$(echo "$contracts_json" | tr -d '()' | tr ',' ' ' | tr '\n' ' ' | tr -s ' ' ' ')
  local smart_operator staking_pool staking_rewards_vault incentive_collector
  read -r smart_operator staking_pool staking_rewards_vault incentive_collector <<< "$contracts_json"
  
  # Check if addresses are zero (not deployed)
  if [[ "$smart_operator" == "0x0000000000000000000000000000000000000000" ]]; then
    log_error "Staking pool has not been deployed yet (all addresses are zero)"
    exit 1
  fi
  
  # Verify that code is actually deployed at each address and display addresses
  log_info "✓ Contract addresses and verification:"
  local has_errors=false
  
  # Define contract info array
  local contracts=(
    "SmartOperator:$smart_operator"
    "StakingPool:$staking_pool"
    "StakingRewardsVault:$staking_rewards_vault"
    "IncentiveCollector:$incentive_collector"
  )
  
  for contract_info in "${contracts[@]}"; do
    local contract_name="${contract_info%%:*}"
    local addr="${contract_info##*:}"
    
    local code
    local rc_code=0
    code=$(cast code "$addr" -r "$RPC_URL" 2>&1) || rc_code=$?
    
    if [[ $rc_code -ne 0 ]]; then
      log_error "  ✗ $contract_name: $addr (failed to check code)"
      has_errors=true
    elif [[ "$code" == "0x" || -z "$code" ]]; then
      log_error "  ✗ $contract_name: $addr (no code deployed)"
      has_errors=true
    else
      log_info "  ✓ $contract_name: $addr"
    fi
  done
  
  if [[ "$has_errors" == "true" ]]; then
    log_error ""
    log_error "Some contracts do not have code deployed. The deployment may be incomplete."
    exit 1
  fi
  echo ""

  # Step 2: Verify validator registration
  local registered_operator
  local rc2=0
  registered_operator=$(cast call "$BEACON_DEPOSIT_ADDR" "getOperator(bytes)(address)" "$PUBKEY" -r "$RPC_URL" 2>&1) || rc2=$?
  
  if [[ $rc2 -ne 0 ]]; then
    log_error "Failed to get operator from beacon deposit contract"
    log_error "Error: $registered_operator"
    exit 1
  fi
  
  # Normalize addresses for comparison
  registered_operator=$(echo "$registered_operator" | tr 'A-F' 'a-f')
  smart_operator_lower=$(echo "$smart_operator" | tr 'A-F' 'a-f')
  
  if [[ "$registered_operator" == "$smart_operator_lower" ]]; then
    log_info "✓ Validator operator correctly registered: $registered_operator"
  else
    log_error "✗ Operator mismatch!"
    log_error "  Expected (SmartOperator): $smart_operator_lower"
    log_error "  Registered:               $registered_operator"
    exit 1
  fi
  echo ""

  # Step 3: Check staking pool status

  local is_active threshold_reached is_fully_exited
  local rc3=0 rc_threshold=0 rc_exited=0
  is_active=$(cast call "$staking_pool" "isActive()(bool)" -r "$RPC_URL" 2>&1) || rc3=$?
  threshold_reached=$(cast call "$staking_pool" "activeThresholdReached()(bool)" -r "$RPC_URL" 2>&1) || rc_threshold=$?
  is_fully_exited=$(cast call "$staking_pool" "isFullyExited()(bool)" -r "$RPC_URL" 2>&1) || rc_exited=$?
  
  if [[ $rc3 -ne 0 ]]; then
    log_error "Failed to check if staking pool is active"
    log_error "Error: $is_active"
    exit 1
  fi

  # Status precedence: Fully Exited > Active > Not Active
  if [[ $rc_exited -eq 0 && "$is_fully_exited" == "true" ]]; then
    log_info "✓ Staking pool is FULLY EXITED"
  elif [[ "$is_active" == "true" ]]; then
    log_info "✓ Staking pool is ACTIVE"
  else
    log_info "⚠ Staking pool is NOT ACTIVE yet"
    log_info "  Run activate.sh to activate the pool with validator proofs"
    exit 0
  fi
  
  # Get additional pool information
  local total_assets total_supply
  local rc_assets=0 rc_supply=0
  total_assets=$(cast call "$staking_pool" "totalAssets()(uint256)" -r "$RPC_URL" 2>&1) || rc_assets=$?
  total_supply=$(cast call "$staking_pool" "totalSupply()(uint256)" -r "$RPC_URL" 2>&1) || rc_supply=$?
  
  if [[ $rc_assets -eq 0 && $rc_supply -eq 0 && -n "$total_assets" && -n "$total_supply" ]]; then
    # Strip scientific notation suffix if present (e.g., "10000 [1e4]" -> "10000")
    total_assets=$(echo "$total_assets" | awk '{print $1}')
    total_supply=$(echo "$total_supply" | awk '{print $1}')
    
    # Use cast to convert from wei to ether
    local total_assets_eth total_supply_eth
    total_assets_eth=$(cast_from_wei_safe "$total_assets")
    total_supply_eth=$(cast_from_wei_safe "$total_supply")
    
    echo "  Total assets (BERA):    $total_assets_eth"
    echo "  Total supply (stBERA):  $total_supply_eth"
  fi
  echo ""

  # Step 4: Check withdrawal availability and pool telemetry

  # Check withdrawal availability (use previously fetched values)
  log_info "=== Checking Withdrawal Availability ==="
  if [[ $rc_threshold -eq 0 ]]; then
    log_info "Threshold Reached: $threshold_reached"
  else
    log_warn "Could not check threshold status: $threshold_reached"
  fi
  if [[ $rc_exited -eq 0 ]]; then
    log_info "Fully Exited: $is_fully_exited"
  else
    log_warn "Could not check exit status: $is_fully_exited"
  fi
  
  
  echo ""
  
  # Additional pool telemetry
  log_info "=== Pool Telemetry ==="
  
  # Check buffered assets
  local buffered_assets
  local rc_buffered=0
  buffered_assets=$(cast call "$staking_pool" "bufferedAssets()(uint256)" -r "$RPC_URL" 2>&1) || rc_buffered=$?
  
  if [[ $rc_buffered -eq 0 && -n "$buffered_assets" ]]; then
    buffered_assets=$(echo "$buffered_assets" | awk '{print $1}')
    local buffered_assets_eth
    buffered_assets_eth=$(cast_from_wei_safe "$buffered_assets")
    log_info "Buffered Assets: $buffered_assets_eth BERA"
  else
    log_warn "Could not get buffered assets: $buffered_assets"
  fi
  
  # Check minimum effective balance
  local min_effective_balance
  local rc_min_balance=0
  min_effective_balance=$(cast call "$staking_pool" "minEffectiveBalance()(uint256)" -r "$RPC_URL" 2>&1) || rc_min_balance=$?
  
  if [[ $rc_min_balance -eq 0 && -n "$min_effective_balance" ]]; then
    min_effective_balance=$(echo "$min_effective_balance" | awk '{print $1}')
    local min_effective_balance_eth
    min_effective_balance_eth=$(cast_from_wei_safe "$min_effective_balance")
    log_info "Min Effective Balance: $min_effective_balance_eth BERA"
  else
    log_warn "Could not get min effective balance: $min_effective_balance"
  fi
  
  # Check BGT disposition from StakingPool via SmartOperator
  log_info "=== BGT Disposition ==="
  
  # Get BGT information from the smart operator (which the staking pool uses)
  local rebaseable_bgt unboosted_bgt bgt_fee_state
  local rc_rebaseable=0 rc_unboosted=0 rc_fee_state=0
  rebaseable_bgt=$(cast call "$smart_operator" "rebaseableBgtAmount()(uint256)" -r "$RPC_URL" 2>&1) || rc_rebaseable=$?
  unboosted_bgt=$(cast call "$smart_operator" "unboostedBalance()(uint256)" -r "$RPC_URL" 2>&1) || rc_unboosted=$?
  bgt_fee_state=$(cast call "$smart_operator" "getEarnedBGTFeeState()(uint256,uint256,uint256,uint96)" -r "$RPC_URL" 2>&1) || rc_fee_state=$?
  
  if [[ $rc_rebaseable -eq 0 && -n "$rebaseable_bgt" && ! "$rebaseable_bgt" =~ (error|revert|panic|Error) ]]; then
    rebaseable_bgt=$(echo "$rebaseable_bgt" | awk '{print $1}')
    local rebaseable_bgt_eth
    rebaseable_bgt_eth=$(cast_from_wei_safe "$rebaseable_bgt")
    log_info "Rebaseable BGT (in pool assets): $rebaseable_bgt_eth BGT"
  else
    # Check if it's an arithmetic underflow/overflow (common when BGT balance is zero or very small)
    if [[ "$rebaseable_bgt" =~ (arithmetic|underflow|overflow|panic) ]]; then
      log_info "Rebaseable BGT (in pool assets): 0.000000000000000000 BGT (calculation underflow - likely no rebaseable BGT)"
    else
      log_warn "Could not get rebaseable BGT (this may be normal if there's no rebaseable BGT)"
    fi
  fi
  
  if [[ $rc_unboosted -eq 0 && -n "$unboosted_bgt" ]]; then
    unboosted_bgt=$(echo "$unboosted_bgt" | awk '{print $1}')
    local unboosted_bgt_eth
    unboosted_bgt_eth=$(cast_from_wei_safe "$unboosted_bgt")
    log_info "Unboosted BGT: $unboosted_bgt_eth BGT"
  else
    log_warn "Could not get unboosted BGT: $unboosted_bgt"
  fi
  
  if [[ $rc_fee_state -eq 0 && -n "$bgt_fee_state" ]]; then
    # Parse the tuple: (currentBalance, bgtBalanceAlreadyCharged, chargeableBalance, protocolFeePercentage)
    # The output format is: (value1, value2, value3, value4)
    local current_balance charged_balance chargeable_balance fee_percentage
    
    # Normalize tuple to single line, whitespace-separated tokens
    local tuple_clean
    tuple_clean=$(echo "$bgt_fee_state" | tr -d '()' | tr ',\n\r\t' ' ' | tr -s ' ')
    read -r current_balance charged_balance chargeable_balance fee_bps <<< "$tuple_clean"
    
    # Convert to ether for display
    local current_balance_eth charged_balance_eth chargeable_balance_eth
    current_balance_eth=$(cast_from_wei_safe "$current_balance")
    charged_balance_eth=$(cast_from_wei_safe "$charged_balance")
    chargeable_balance_eth=$(cast_from_wei_safe "$chargeable_balance")
    
    log_info "Total BGT Balance: $current_balance_eth BGT"
    log_info "BGT Already Charged Fees: $charged_balance_eth BGT"
    log_info "BGT Chargeable (new earnings): $chargeable_balance_eth BGT"
    # fee_bps is basis points (e.g., 1569 -> 15.69%)
    local fee_pct_display
    fee_pct_display=$(awk -v bps="$fee_bps" 'BEGIN{ if (bps ~ /^[0-9]+$/) printf "%.2f", bps/100; else printf "0.00" }')
    log_info "Protocol Fee: $fee_pct_display%"
  else
    log_warn "Could not get BGT fee state: $bgt_fee_state"
  fi
  
  # (reduced) omit direct BGT and boosted balance duplicates for concise output

  # Step 5: If PRIVATE_KEY is set, reveal wallet holdings
  if [[ -n "${PRIVATE_KEY:-}" ]]; then
    echo ""
    log_info "=== Wallet Holdings (PRIVATE_KEY) ==="
    local wallet_addr
    local rc_wallet=0
    wallet_addr=$(cast wallet address --private-key "$PRIVATE_KEY" 2>/dev/null) || rc_wallet=$?
    if [[ $rc_wallet -ne 0 || -z "$wallet_addr" ]]; then
      log_warn "Could not derive wallet address from PRIVATE_KEY"
    else
      log_info "Address: $wallet_addr"

      # stBERA shares held in staking pool
      local shares_raw
      shares_raw=$(cast_call_clean "$staking_pool" "balanceOf(address)(uint256)" "$wallet_addr" -r "$RPC_URL" 2>/dev/null || echo "")
      if [[ -z "$shares_raw" ]]; then shares_raw="0"; fi
      local shares_pretty
      shares_pretty=$(cast_from_wei_safe "$shares_raw")
      log_info "stBERA Shares: $shares_pretty"

      # Withdrawal Vault NFTs owned by wallet
      local withdrawal_vault
      withdrawal_vault=$(get_withdrawal_vault_for_network "$CHAIN")
      if [[ -z "$withdrawal_vault" ]]; then
        log_warn "Withdrawal vault not found for chain: $CHAIN"
      else
        local nft_count
        nft_count=$(cast_call_clean "$withdrawal_vault" "balanceOf(address)(uint256)" "$wallet_addr" -r "$RPC_URL" 2>/dev/null || echo "")
        if [[ -z "$nft_count" ]]; then nft_count="0"; fi
        log_info "Withdrawal NFTs: $nft_count"
        if [[ "$nft_count" != "0" ]]; then
          for (( i=0; i<${nft_count}; i++ )); do
            local token_id
            token_id=$(cast_call_clean "$withdrawal_vault" "tokenOfOwnerByIndex(address,uint256)(uint256)" "$wallet_addr" "$i" -r "$RPC_URL" 2>/dev/null || echo "")
            if [[ -z "$token_id" ]]; then continue; fi

            # Fetch request details using JSON format for proper parsing
            local req_json
            req_json=$(cast call "$withdrawal_vault" "getWithdrawalRequest(uint256)((bytes,uint256,uint256,address,uint256))" "$token_id" -r "$RPC_URL" --json 2>/dev/null || echo "")
            if [[ -n "$req_json" && "$req_json" != "null" && "$req_json" != "[]" ]]; then
              # Cast returns tuple as JSON array: ["(field1, field2, field3, field4, field5)"]
              # Extract the tuple string from the array, then parse it
              local tuple_str
              tuple_str=$(echo "$req_json" | jq -r '.[0] // empty' 2>/dev/null || echo "")
              
              if [[ -n "$tuple_str" && "$tuple_str" != "null" ]]; then
                # Parse the tuple string: (pubkey, assetsRequested, sharesBurnt, user, requestBlock)
                # Remove parentheses and split by comma+space pattern
                local cleaned
                cleaned=$(echo "$tuple_str" | sed 's/^(//; s/)$//' | tr -d '\n\r')
                
                if [[ -n "$cleaned" ]]; then
                  # Extract fields: index 1=assets, 2=shares, 4=requestBlock (0-indexed from comma-separated)
                  # Use explicit error handling to ensure variables are set
                  local assets_raw shares_raw req_block_raw
                  assets_raw=$(echo "$cleaned" | awk -F', ' '{print $2}' || echo "")
                  shares_raw=$(echo "$cleaned" | awk -F', ' '{print $3}' || echo "")
                  req_block_raw=$(echo "$cleaned" | awk -F', ' '{print $5}' || echo "")
                  
                  # Strip scientific notation and validate
                  local assets shares req_block
                  if [[ -n "$assets_raw" ]]; then
                    assets=$(strip_scientific_notation "$assets_raw")
                  else
                    assets="0"
                  fi
                  if [[ -n "$shares_raw" ]]; then
                    shares=$(strip_scientific_notation "$shares_raw")
                  else
                    shares="0"
                  fi
                  if [[ -n "$req_block_raw" ]]; then
                    req_block=$(strip_scientific_notation "$req_block_raw")
                  else
                    req_block="0"
                  fi
                  
                  # Final validation
                  if [[ -z "$assets" || "$assets" == "null" ]]; then assets="0"; fi
                  if [[ -z "$shares" || "$shares" == "null" ]]; then shares="0"; fi
                  if [[ -z "$req_block" || "$req_block" == "null" ]]; then req_block="0"; fi
                else
                  assets="0"
                  shares="0"
                  req_block="0"
                fi
              else
                assets="0"
                shares="0"
                req_block="0"
              fi
              
              # Strip scientific notation if present (fallback protection)
              # Ensure variables are non-empty before processing
              if [[ -n "$assets" && "$assets" != "null" ]]; then
                assets=$(strip_scientific_notation "$assets")
              else
                assets="0"
              fi
              if [[ -n "$shares" && "$shares" != "null" ]]; then
                shares=$(strip_scientific_notation "$shares")
              else
                shares="0"
              fi
              if [[ -n "$req_block" && "$req_block" != "null" ]]; then
                req_block=$(strip_scientific_notation "$req_block")
              else
                req_block="0"
              fi
              
              local assets_bera shares_stbera
              assets_bera=$(cast_from_wei_safe "$assets")
              shares_stbera=$(cast_from_wei_safe "$shares")
              
              # Check if ready for redemption
              local ready_status
              if cast call "$withdrawal_vault" 'finalizeWithdrawalRequest(uint256)' "$token_id" -r "$RPC_URL" >/dev/null 2>&1; then
                ready_status="✅ Ready"
              else
                local ready_time
                ready_time=$(calculate_withdrawal_ready_time "$req_block" "$RPC_URL" || echo "unknown")
                ready_status="⏳ Redeemable $ready_time"
              fi
              
              log_info "  NFT #$token_id: assets=$assets_bera BERA, sharesBurnt=$shares_stbera stBERA, requestBlock=$req_block"
              log_info "    Status: $ready_status"
            else
              log_info "  NFT #$token_id"
            fi
          done
        fi
      fi
    fi
  fi
}

main "$@"

