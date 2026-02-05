#!/usr/bin/env bash
set -euo pipefail

# One-off generator for the staking pools frontend config (Vue `apps/staking-pools/frontend/`).
# - Detects network and validator pubkey from beacond
# - Queries factory for pool, withdrawal vault, and delegation handler addresses
# - Writes a draft config.json compatible with the frontend

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib-common.sh"

# Load configuration if available
load_env "$SCRIPT_DIR"

# Defaults
FRONTEND_DIR="../frontend"
OUT_FILE_DEFAULT="$FRONTEND_DIR/public/config.draft.json"

usage() {
  cat <<'USAGE'
generate-frontend-config.sh

Detects your validator and writes a frontend config draft.

Environment:
  BEACOND_HOME            Path to beacond home (required)
  BEACOND_BIN             Optional, defaults to "beacond" in PATH

Options:
  --out PATH              Output path (default: .../frontend/public/config.draft.json)
  -h, --help              Show this help

Note: RPC is selected automatically based on the detected network.
USAGE
}

OUT_FILE="$OUT_FILE_DEFAULT"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT_FILE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

# Use standardized logging functions from lib-common.sh

ensure_jq
ensure_cast

beacond_bin=""
beacond_bin=$(resolve_beacond_bin)
if [[ -z "$beacond_bin" ]]; then
  log_error "beacond binary not found (set BEACOND_BIN in env.sh or ensure beacond is in PATH)"
  exit 1
fi

if [[ -z "${BEACOND_HOME:-}" ]]; then
  log_error "BEACOND_HOME is required"
  exit 1
fi
if [[ ! -d "$BEACOND_HOME" ]]; then
  log_error "beacond home not found: $BEACOND_HOME"
  exit 1
fi

# Use constants from lib-common.sh
# RPC + Explorer per network (docs constants)
EXP_MAINNET="https://berascan.com"
EXP_BEPOLIA="https://testnet.berascan.com"
NAME_MAINNET="Berachain"
NAME_BEPOLIA="Bepolia"
CHAINID_MAINNET=80094
CHAINID_BEPOLIA=80069

# Detect network using lib-common.sh functions
NETWORK=$(get_network_from_genesis "$beacond_bin" "$BEACOND_HOME")
if [[ "$NETWORK" == "unknown" ]]; then
  log_error "Could not detect network from beacond genesis"
  exit 1
fi

RPC_URL=$(get_rpc_url_for_network "$NETWORK")
FACTORY=$(get_factory_address_for_network "$NETWORK")

# Set network-specific values
case "$NETWORK" in
  mainnet)
    EXPLORER_URL="$EXP_MAINNET"
    CHAIN_NAME="$NAME_MAINNET"
    CHAIN_ID=$CHAINID_MAINNET
    ;;
  bepolia)
    EXPLORER_URL="$EXP_BEPOLIA"
    CHAIN_NAME="$NAME_BEPOLIA"
    CHAIN_ID=$CHAINID_BEPOLIA
    ;;
  *)
    log_error "Unknown network: $NETWORK"
    exit 1
    ;;
esac

log_info "Network: $NETWORK"
log_info "RPC: $RPC_URL"
log_info "Factory: $FACTORY"

# Get validator pubkey using lib-common.sh function
PUBKEY=$(get_validator_pubkey "$beacond_bin" "$BEACOND_HOME")
if [[ -z "$PUBKEY" ]]; then
  exit 1
fi

log_info "Validator pubkey: $PUBKEY"

# Query factory for core contracts
CORE=$(
  cast call "$FACTORY" \
    "getCoreContracts(bytes)(address,address,address,address)" \
    "$PUBKEY" -r "$RPC_URL" 2>/dev/null || true
)
if [[ -z "$CORE" ]]; then
  log_error "Failed to query getCoreContracts; is the pool deployed?"
  exit 1
fi

CORE_CLEAN=$(echo "$CORE" | tr -d '()' | tr ',' ' ' | tr '\n' ' ' | tr -s ' ' ' ')
SMART_OPERATOR="0x0000000000000000000000000000000000000000"
STAKING_POOL="0x0000000000000000000000000000000000000000"
STAKING_REWARDS_VAULT="0x0000000000000000000000000000000000000000"
INCENTIVE_COLLECTOR="0x0000000000000000000000000000000000000000"
read -r SMART_OPERATOR STAKING_POOL STAKING_REWARDS_VAULT INCENTIVE_COLLECTOR <<< "$CORE_CLEAN"

if [[ "$STAKING_POOL" == "0x0000000000000000000000000000000000000000" ]]; then
  log_info "No staking pool found for this pubkey yet; writing a disabled draft."
fi

# Query withdrawal vault from factory
WITHDRAWAL_VAULT=$(cast call "$FACTORY" "withdrawalVault()(address)" -r "$RPC_URL" 2>/dev/null || echo "0x0000000000000000000000000000000000000000")

# Query delegation handler (may not exist)
DELEGATION_HANDLER=$(get_delegation_handler "$FACTORY" "$PUBKEY" "$RPC_URL")

POOL_KEY="default"
POOL_NAME="Staking Pool"

TMP_JSON=$(mktemp)

jq -n \
  --arg name "$CHAIN_NAME" \
  --argjson chainId "$CHAIN_ID" \
  --arg rpc "$RPC_URL" \
  --arg exp "$EXPLORER_URL" \
  --arg wv "$WITHDRAWAL_VAULT" \
  --arg dh "$DELEGATION_HANDLER" \
  --arg poolKey "$POOL_KEY" \
  --arg poolName "$POOL_NAME" \
  --arg pubkey "$PUBKEY" \
  --arg pool "$STAKING_POOL" \
  --argjson enabled $([[ "$STAKING_POOL" == "0x0000000000000000000000000000000000000000" ]] && echo false || echo true) \
  '{
    mode: "single",
    network: { name: $name, chainId: $chainId, rpcUrl: $rpc, explorerUrl: $exp },
    branding: {
      name: $poolName,
      logo: null,
      theme: null
    },
    contracts: {
      withdrawalVault: $wv,
      delegationHandler: $dh
    },
    pools: ({} | .[$poolKey] = {
      name: $poolName,
      validatorPubkey: $pubkey,
      stakingPool: $pool,
      enabled: $enabled
    })
  }' > "$TMP_JSON"

mkdir -p "$(dirname "$OUT_FILE")"
mv "$TMP_JSON" "$OUT_FILE"

log_success "Wrote draft config to: $OUT_FILE"
log_info "Rename to config.json after review."
