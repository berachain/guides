#!/bin/bash

set -e
. ./env.sh

mkdir -p $ERIGON_DATA

if [ ! -x "$ERIGON_BIN" ]; then
    echo "Error: $ERIGON_BIN does not exist or is not executable"
    exit 1
fi

echo "ERIGON_DATA: $ERIGON_DATA"
echo "ERIGON_BIN: $ERIGON_BIN"
echo "  Version: $($ERIGON_BIN --version)"

cp "$SEED_DATA_DIR/eth-genesis.json" "$ERIGON_GENESIS_PATH"
$ERIGON_BIN init --datadir "$ERIGON_DATA" "$ERIGON_GENESIS_PATH"

echo
echo "✓ Erigon set up."

