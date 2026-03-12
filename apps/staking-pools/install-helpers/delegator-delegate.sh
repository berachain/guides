#!/usr/bin/env bash
set -euo pipefail

# Deploy DelegationHandler (if needed), generate delegation artifacts, then
# immediately simulate the full flow on an anvil fork to prove correctness.
#
# Detects whether the caller holds DEFAULT_ADMIN_ROLE on the handler:
#
#   Caller IS admin → generated/delegator-delegate-command.sh (all four steps)
#   Caller NOT admin (typical: Foundation Safe is admin) →
#     generated/operator-steps.sh           deploy handler + fund (run this yourself)
#     generated/safe-multisend-payload.json  delegate + grantRole calldata for Safe TX Builder
#     generated/foundation-request.txt       plain-text summary to send to Foundation
#
# After generating artifacts, runs run_delegation_simulation() from lib-common.sh.
# Simulation forks the chain, replays operator steps with your key, impersonates the
# Foundation Safe to execute the payload, then verifies delegatedAmount and role.
# Exits non-zero if simulation fails; artifacts are left for inspection.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib-common.sh"

CLI_PUBKEY=""
CLI_CHAIN=""
CLI_AMOUNT=""
CLI_VALIDATOR_ADMIN=""
CLI_FROM=""
CLI_NO_SIM=false

print_usage() {
  cat <<'USAGE'
delegator-delegate.sh

Generates delegation artifacts and simulates the full flow on a local anvil fork.

Usage:
  KEY_FILE=/path/to/key ./delegator-delegate.sh \
    --pubkey 0x... --chain mainnet|bepolia \
    --amount BERA --validator-admin 0x...

Required:
  --pubkey 0x...            Validator pubkey (96 hex chars)
  --chain mainnet|bepolia   Network
  --amount BERA             Amount to delegate (integer, e.g. 500000)
  --validator-admin 0x...   Address to receive VALIDATOR_ADMIN_ROLE

Optional:
  --from 0x...   Signing address for admin-role check (skips loading key for check;
                 if omitted, derived from KEY_FILE or PRIVATE_KEY in env.sh)
  --no-sim       Skip simulation (artifacts written but marked unvalidated)

Environment:
  KEY_FILE       Path to private key file for simulation (default: /tmp/tramp.key)
USAGE
}

validate_pubkey() {
  local pk="$1"
  pk=$(echo "$pk" | tr 'A-F' 'a-f')
  if [[ ! "$pk" =~ ^0x[0-9a-f]{96}$ ]]; then
    log_error "Invalid pubkey: must be 0x followed by 96 hex characters"
    exit 1
  fi
  echo "$pk"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      --pubkey)          CLI_PUBKEY="$2";          shift 2 ;;
      --chain)           CLI_CHAIN="$2";           shift 2 ;;
      --amount)          CLI_AMOUNT="$2";          shift 2 ;;
      --validator-admin) CLI_VALIDATOR_ADMIN="$2"; shift 2 ;;
      --from)            CLI_FROM="$2";            shift 2 ;;
      --no-sim)          CLI_NO_SIM=true;          shift   ;;
      -h|--help)         print_usage; exit 0 ;;
      *) log_error "Unknown arg: $1"; print_usage; exit 1 ;;
    esac
  done
}

# Caller address: --from > KEY_FILE > PRIVATE_KEY in env > empty
get_caller_address() {
  if [[ -n "$CLI_FROM" ]]; then
    normalize_evm_address "$CLI_FROM"; return
  fi
  local kf="${KEY_FILE:-}"
  if [[ -z "$kf" && -f "/tmp/tramp.key" ]]; then kf="/tmp/tramp.key"; fi
  if [[ -n "$kf" && -f "$kf" ]]; then
    cast wallet address --private-key "$(cat "$kf")" 2>/dev/null | xargs || echo ""; return
  fi
  if [[ -n "${PRIVATE_KEY:-}" ]]; then
    cast wallet address --private-key "$PRIVATE_KEY" 2>/dev/null | xargs || echo ""; return
  fi
  echo ""
}

get_handler_admin() {
  # DelegationHandler uses plain AccessControl (not enumerable), so getRoleMember reverts.
  # DEFAULT_ADMIN_ROLE is granted to DelegationHandlerFactory.owner() at deploy time.
  # Args: $1 factory address, $2 rpc url
  local factory="$1" rpc="$2"
  cast call "$factory" 'owner()(address)' -r "$rpc" 2>/dev/null | xargs || echo ""
}

generate_operator_steps() {
  local factory="$1" pubkey="$2" amount="$3" rpc_url="$4"
  local needs_deployment="$5" handler="$6"
  local cmd_file="generated/operator-steps.sh"

  cat > "$cmd_file" <<'EOF'
#!/usr/bin/env bash
# Operator steps: deploy DelegationHandler (if needed) + fund it with BERA.
# delegate() and grantRole() are executed by the Foundation Safe — see
# generated/safe-multisend-payload.json and generated/foundation-request.txt.
#
EOF
  cat >> "$cmd_file" <<EOF
# Pubkey:    $pubkey
# Amount:    $amount BERA
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
# Validated: pending
set -euo pipefail

EOF
  cat >> "$cmd_file" <<'SIGNING'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$SCRIPT_DIR/../env.sh" ]] && source "$SCRIPT_DIR/../env.sh"
if [[ -n "${KEY_FILE:-}" && -f "${KEY_FILE:-}" ]]; then
  wallet_args="--private-key $(cat "$KEY_FILE")"
elif [[ -n "${PRIVATE_KEY:-}" ]]; then
  wallet_args="--private-key $PRIVATE_KEY"
else
  wallet_args="--ledger"
fi

SIGNING

  if [[ "$needs_deployment" == "true" ]]; then
    cat >> "$cmd_file" <<EOF
echo "Step 1: Deploying DelegationHandler..."
cast send $factory \\
  'deployDelegationHandler(bytes)' \\
  "$pubkey" \\
  -r $rpc_url \$wallet_args
echo ""

HANDLER=\$(cast call $factory 'delegationHandlers(bytes)(address)' "$pubkey" -r $rpc_url | xargs)
if [[ -z "\$HANDLER" || "\$HANDLER" == "0x0000000000000000000000000000000000000000" ]]; then
  echo "Error: handler address is zero after deploy"; exit 1
fi
echo "DelegationHandler deployed at: \$HANDLER"
echo ""

EOF
  else
    cat >> "$cmd_file" <<EOF
HANDLER="$handler"
echo "Using existing DelegationHandler: \$HANDLER"
echo ""

EOF
  fi

  cat >> "$cmd_file" <<EOF
echo "Step 2: Sending $amount BERA to DelegationHandler..."
cast send \$HANDLER \\
  --value ${amount}ether \\
  -r $rpc_url \$wallet_args
echo ""
echo "Done. Handler funded."
echo ""
echo "NEXT: Share generated/safe-multisend-payload.json + generated/foundation-request.txt"
echo "with a Foundation Safe owner. They execute the Safe tx, then you run delegated-create-pool.sh."
EOF
  chmod +x "$cmd_file"
}

generate_safe_payload() {
  local handler="$1" amount_wei="$2" role_hash="$3" validator_admin="$4"

  local delegate_data grant_data
  delegate_data="0x9fa6dd35$(cast abi-encode 'f(uint256)' "$amount_wei" 2>/dev/null | cut -c3-)"
  grant_data="0x2f2ff15d$(cast abi-encode 'f(bytes32,address)' "$role_hash" "$validator_admin" 2>/dev/null | cut -c3-)"

  cat > "generated/safe-multisend-payload.json" <<EOF
{
  "_comment": "Safe Transaction Builder import — two calls to DelegationHandler in one batch.",
  "version": "1.0",
  "chainId": "$(if [[ "$CLI_CHAIN" == "mainnet" ]]; then echo "80094"; else echo "80069"; fi)",
  "createdAt": $(date +%s000),
  "meta": {
    "name": "Delegation setup: delegate + grantRole",
    "description": "Marks BERA as delegated and grants VALIDATOR_ADMIN_ROLE to the validator operator."
  },
  "transactions": [
    {
      "to": "$handler",
      "value": "0",
      "data": "$delegate_data",
      "_comment": "delegate(uint256 $amount_wei) — $(cast --to-unit "$amount_wei" ether 2>/dev/null) BERA"
    },
    {
      "to": "$handler",
      "value": "0",
      "data": "$grant_data",
      "_comment": "grantRole(VALIDATOR_ADMIN_ROLE, $validator_admin)"
    }
  ]
}
EOF
}

generate_foundation_request() {
  local handler="$1" amount_bera="$2" amount_wei="$3"
  local validator_admin="$4" pubkey="$5" network="$6" role_hash="$7"

  local safe_addr
  if [[ "$network" == "mainnet" ]]; then
    safe_addr="0xD13948F99525FB271809F45c268D72a3C00a568D"
  else
    safe_addr="(check DelegationHandlerFactory owner for $network)"
  fi

  cat > "generated/foundation-request.txt" <<EOF
Foundation Safe Delegation Request
===================================
Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
Network:   $network
Safe:      $safe_addr

What we need
------------
A single Safe transaction (two calls batched) to the DelegationHandler:

  DelegationHandler: $handler
  Validator pubkey:  $pubkey
  Operator address:  $validator_admin

Call 1 — delegate(uint256)
  Marks $amount_bera BERA ($amount_wei wei) as delegated.
  The handler must already hold this BERA before this tx executes.

Call 2 — grantRole(bytes32,address)
  Role:    VALIDATOR_ADMIN_ROLE ($role_hash)
  Account: $validator_admin

How to execute
--------------
1. Open the Foundation Safe in the Safe UI.
2. Transaction Builder → Import → upload safe-multisend-payload.json (attached).
3. Review and execute. Threshold is 1-of-N; any owner can sign and execute immediately.

After execution
---------------
The operator ($validator_admin) runs:
  ./delegated-create-pool.sh
EOF
}

main() {
  parse_args "$@"

  if ! ensure_cast; then exit 1; fi
  if ! ensure_bc;   then exit 1; fi
  load_env "$SCRIPT_DIR"

  [[ -z "$CLI_PUBKEY" ]]         && { log_error "Missing --pubkey";          print_usage; exit 1; }
  [[ -z "$CLI_CHAIN" ]]          && { log_error "Missing --chain";            print_usage; exit 2; }
  [[ "$CLI_CHAIN" != "bepolia" && "$CLI_CHAIN" != "mainnet" ]] && {
    log_error "Invalid chain: $CLI_CHAIN (must be 'bepolia' or 'mainnet')"; exit 1; }
  [[ -z "$CLI_AMOUNT" ]]         && { log_error "Missing --amount";           print_usage; exit 2; }
  [[ ! "$CLI_AMOUNT" =~ ^[0-9]+$ ]] && { log_error "--amount must be a positive integer (BERA)"; exit 2; }

  local PUBKEY network rpc_url factory
  PUBKEY=$(validate_pubkey "$CLI_PUBKEY")
  network="$CLI_CHAIN"
  rpc_url=$(get_rpc_url_for_network "$network")
  [[ -z "$rpc_url" ]] && { log_error "Unknown chain: $network"; exit 1; }
  factory=$(get_delegation_handler_factory_for_network "$network")
  [[ -z "$factory" || "$factory" == "0x0000000000000000000000000000000000000000" ]] && {
    log_error "DelegationHandlerFactory not available for network: $network"; exit 1; }

  local VALIDATOR_ADMIN
  VALIDATOR_ADMIN=$(normalize_evm_address "$CLI_VALIDATOR_ADMIN")
  [[ -z "$VALIDATOR_ADMIN" ]] && { log_error "--validator-admin must be a valid EVM address"; exit 3; }

  local HANDLER needs_deployment=false
  HANDLER=$(get_delegation_handler "$factory" "$PUBKEY" "$rpc_url" | xargs)
  if [[ -z "$HANDLER" || "$HANDLER" == "0x0000000000000000000000000000000000000000" || \
        ! "$HANDLER" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    needs_deployment=true
    # Address is CREATE2-deterministic from the pubkey — predict it now via a throwaway fork
    # so all artifacts can use the real address immediately.
    local key_file_for_predict="${KEY_FILE:-}"
    if [[ -z "$key_file_for_predict" && -f "/tmp/tramp.key" ]]; then
      key_file_for_predict="/tmp/tramp.key"
    fi
    if [[ -n "$key_file_for_predict" && -f "$key_file_for_predict" ]]; then
      log_info "Predicting handler address via fork (CREATE2)..."
      HANDLER=$(predict_handler_address "$PUBKEY" "$network" "$key_file_for_predict")
      if [[ -z "$HANDLER" || "$HANDLER" == "0x0000000000000000000000000000000000000000" ]]; then
        log_error "Could not predict handler address. Aborting."
        exit 1
      fi
      log_info "Handler address (pre-deploy): $HANDLER"
    else
      log_error "No key file available to predict handler address (set KEY_FILE=/path/to/key)."
      exit 1
    fi
  else
    log_success "DelegationHandler already deployed at: $HANDLER"
  fi

  local amount_wei
  amount_wei=$(cast to-wei "$CLI_AMOUNT" 2>/dev/null)
  if ! validate_gwei_multiple "$amount_wei"; then
    log_warn "Amount not a gwei multiple — rounding down..."
    amount_wei=$(round_down_to_gwei "$amount_wei")
    CLI_AMOUNT=$(cast from-wei "$amount_wei")
  fi

  local role_hash
  role_hash=$(cast keccak "VALIDATOR_ADMIN_ROLE")

  log_info "Network:          $network"
  log_info "Validator pubkey: $PUBKEY"
  log_info "Factory:          $factory"
  log_info "Amount:           $CLI_AMOUNT BERA"
  log_info "Validator admin:  $VALIDATOR_ADMIN"
  echo ""

  # --- Admin detection ---
  local caller_is_admin=false

  if [[ "$needs_deployment" == "false" ]]; then
    log_info "Checking DEFAULT_ADMIN_ROLE on handler..."
    local handler_admin caller_address
    handler_admin=$(get_handler_admin "$factory" "$rpc_url" | xargs | tr 'A-F' 'a-f')
    caller_address=$(get_caller_address | tr 'A-F' 'a-f')
    if [[ -n "$caller_address" && -n "$handler_admin" && "$caller_address" == "$handler_admin" ]]; then
      caller_is_admin=true
      log_success "Caller holds DEFAULT_ADMIN_ROLE — combined script."
    elif [[ -n "$handler_admin" ]]; then
      log_info "DEFAULT_ADMIN_ROLE held by: $handler_admin (not caller) — split output."
    else
      log_warn "Could not determine DEFAULT_ADMIN_ROLE holder — defaulting to split output."
    fi
  else
    local factory_owner caller_address
    factory_owner=$(cast call "$factory" 'owner()(address)' -r "$rpc_url" 2>/dev/null | xargs | tr 'A-F' 'a-f' || echo "")
    caller_address=$(get_caller_address | tr 'A-F' 'a-f')
    if [[ -n "$caller_address" && -n "$factory_owner" && "$caller_address" == "$factory_owner" ]]; then
      caller_is_admin=true
      log_success "Caller is factory owner — combined script."
    else
      log_info "Factory owner (future admin): ${factory_owner:-unknown} — split output."
    fi
  fi

  echo ""
  mkdir -p generated

  # --- Generate artifacts ---
  if [[ "$caller_is_admin" == "true" ]]; then
    local cmd_file
    cmd_file="generated/delegator-delegate-command.sh"
    cat > "$cmd_file" <<EOF
#!/usr/bin/env bash
# Combined delegation command (caller holds DEFAULT_ADMIN_ROLE)
# Pubkey: $PUBKEY  Amount: $CLI_AMOUNT BERA  Admin: $VALIDATOR_ADMIN
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
# Validated: pending
set -euo pipefail

EOF
    cat >> "$cmd_file" <<'SIGNING'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$SCRIPT_DIR/../env.sh" ]] && source "$SCRIPT_DIR/../env.sh"
if [[ -n "${KEY_FILE:-}" && -f "${KEY_FILE:-}" ]]; then
  wallet_args="--private-key $(cat "$KEY_FILE")"
elif [[ -n "${PRIVATE_KEY:-}" ]]; then
  wallet_args="--private-key $PRIVATE_KEY"
else
  wallet_args="--ledger"
fi

SIGNING
    if [[ "$needs_deployment" == "true" ]]; then
      cat >> "$cmd_file" <<EOF
echo "Step 1: Deploying DelegationHandler..."
cast send $factory 'deployDelegationHandler(bytes)' "$PUBKEY" -r $rpc_url \$wallet_args
echo ""
HANDLER=\$(cast call $factory 'delegationHandlers(bytes)(address)' "$PUBKEY" -r $rpc_url | xargs)
[[ -z "\$HANDLER" || "\$HANDLER" == "0x0000000000000000000000000000000000000000" ]] && { echo "Error: handler zero"; exit 1; }
echo "Handler: \$HANDLER"
echo ""

EOF
    else
      cat >> "$cmd_file" <<EOF
HANDLER="$HANDLER"
echo "Using existing handler: \$HANDLER"
echo ""

EOF
    fi
    cat >> "$cmd_file" <<EOF
echo "Step 2: Funding handler..."
cast send \$HANDLER --value ${CLI_AMOUNT}ether -r $rpc_url \$wallet_args
echo ""
echo "Step 3: delegate()..."
cast send \$HANDLER 'delegate(uint256)' "$amount_wei" -r $rpc_url \$wallet_args
echo ""
echo "Step 4: grantRole(VALIDATOR_ADMIN_ROLE, $VALIDATOR_ADMIN)..."
cast send \$HANDLER 'grantRole(bytes32,address)' "$role_hash" "$VALIDATOR_ADMIN" -r $rpc_url \$wallet_args
echo ""
echo "Done. Operator can run: ./delegated-create-pool.sh"
EOF
    chmod +x "$cmd_file"
    log_success "Generated: $cmd_file"

  else
    generate_operator_steps "$factory" "$PUBKEY" "$CLI_AMOUNT" "$rpc_url" "$needs_deployment" "$HANDLER"
    generate_safe_payload "$HANDLER" "$amount_wei" "$role_hash" "$VALIDATOR_ADMIN"
    generate_foundation_request "$HANDLER" "$CLI_AMOUNT" "$amount_wei" "$VALIDATOR_ADMIN" "$PUBKEY" "$network" "$role_hash"
    log_success "Generated: generated/operator-steps.sh"
    log_success "Generated: generated/safe-multisend-payload.json"
    log_success "Generated: generated/foundation-request.txt"
  fi

  # --- Simulation ---
  echo ""
  local key_file="${KEY_FILE:-}"
  if [[ -z "$key_file" && -f "/tmp/tramp.key" ]]; then key_file="/tmp/tramp.key"; fi

  if [[ "$CLI_NO_SIM" == "true" ]]; then
    log_warn "Simulation skipped (--no-sim). Artifacts are UNVALIDATED."
    log_warn "Re-run with KEY_FILE=/path/to/key (without --no-sim) to validate."
  elif [[ -z "$key_file" || ! -f "$key_file" ]]; then
    log_warn "No key file found for simulation (set KEY_FILE=/path/to/key)."
    log_warn "Artifacts generated but UNVALIDATED. Re-run with KEY_FILE to simulate."
  else
    log_info "Running simulation on $network fork..."
    echo ""
    local payload_file="$SCRIPT_DIR/generated/safe-multisend-payload.json"
    if run_delegation_simulation "$PUBKEY" "$network" "$key_file" "$payload_file"; then
      echo ""
      for gf in generated/operator-steps.sh generated/delegator-delegate-command.sh; do
        if [[ -f "$gf" ]]; then
          sed 's/# Validated: pending/# Validated: simulation passed (see generated\/simulation-report.txt)/' "$gf" > "${gf}.tmp" && mv "${gf}.tmp" "$gf"
        fi
      done
      log_success "Artifacts validated. Proceed with the next steps below."
    else
      echo ""
      log_error "Simulation failed. Do not proceed until the issue is resolved."
      log_error "Artifacts are in generated/ for inspection."
      exit 1
    fi
  fi

  # --- Next steps ---
  echo ""
  if [[ "$caller_is_admin" == "true" ]]; then
    log_info "Next steps:"
    echo "  1. Review: cat generated/delegator-delegate-command.sh"
    echo "  2. Execute: ./generated/delegator-delegate-command.sh"
  else
    log_info "Next steps:"
    echo "  1. Run your steps:  ./generated/operator-steps.sh"
    echo "  2. Send to Foundation: generated/safe-multisend-payload.json + generated/foundation-request.txt"
    echo "  3. After Foundation Safe tx confirms: ./delegated-create-pool.sh"
  fi
}

main "$@"
