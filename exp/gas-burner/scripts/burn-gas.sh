#!/bin/bash

# Usage: ./burn-gas.sh [GAS_AMOUNT]

set -e

CONTRACT_ADDRESS="0xb7eE90D4977567778245772A5cbCD61CCc0dd891"
PRIVATE_KEY="0x1ef5909e3da2aad77f3b6040bd6eec1b5f4a70acf4cd9090eba6901a5a0a5023"
# Use EL_ETHRPC_URL if set, otherwise default
RPC_URL="${EL_ETHRPC_URL:-https://bepolia.rpc.berachain.com}"

GAS_AMOUNT=${1:-8000000}

echo "Burning $GAS_AMOUNT gas..."

cast send "$CONTRACT_ADDRESS" "burnGas(uint256)" "$GAS_AMOUNT" \
  --private-key "$PRIVATE_KEY" \
  --rpc-url "$RPC_URL" \
  --json 