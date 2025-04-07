#!/bin/bash

set -e
. ./env.sh

if [ ! -x "$GETH_BIN" ]; then
    echo "Error: $GETH_BIN does not exist or is not executable"
    exit 1
fi

mkdir -p $GETH_DATA

echo "GETH_DATA: $GETH_DATA "
echo "GETH_BIN: $GETH_BIN"
echo "  Version: $($GETH_BIN version | grep Version)"

cp "$SEED_DATA_DIR/eth-genesis.json" "$GETH_GENESIS_PATH"
ARCHIVE_OPTION=$([ "$EL_ARCHIVE_NODE" = true ] && echo "--state.scheme hash" || echo "--state.scheme hash")
$GETH_BIN init --datadir "$GETH_DATA" $ARCHIVE_OPTION "$GETH_GENESIS_PATH"

echo
echo "✓ Geth set up."

