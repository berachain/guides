#!/bin/bash

set -e
. ./env.sh

mkdir -p $GETH_DATA

if [ ! -x "$GETH_BIN" ]; then
    echo "Error: $GETH_BIN does not exist or is not executable"
    exit 1
fi

echo "GETH_DATA: $GETH_DATA"
echo "GETH_BIN: $GETH_BIN"
echo "  Version: $($GETH_BIN version | grep Version)"

cp seed-data/eth-genesis.json $GETH_GENESIS_PATH
$GETH_BIN init --datadir $GETH_DATA $GETH_GENESIS_PATH

echo
echo "✓ Geth set up."

