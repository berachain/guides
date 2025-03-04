#!/bin/bash

set -e
. ./env.sh

mkdir -p $RETH_DATA

if [ ! -x "$RETH_BIN" ]; then
    echo "Error: $RETH_BIN does not exist or is not executable"
    exit 1
fi

echo "RETH_DATA: $RETH_DATA"
echo "RETH_BIN: $RETH_BIN"
echo "  Version: $($RETH_BIN --version | grep Version)"

cp "$SEED_DATA_DIR/eth-genesis.json" "$RETH_GENESIS_PATH"
$RETH_BIN init --datadir "$RETH_DATA" --chain "$RETH_GENESIS_PATH" 

echo
echo "✓ Reth set up."
