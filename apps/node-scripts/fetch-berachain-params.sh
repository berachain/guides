#!/bin/bash

set -e
. ./env.sh

mkdir -p "$SEED_DATA_DIR"

export SEED_DATA_URL=https://raw.githubusercontent.com/berachain/beacon-kit/refs/heads/main/testing/networks/$CHAIN_ID
curl -s -o "$SEED_DATA_DIR/kzg-trusted-setup.json" $SEED_DATA_URL/kzg-trusted-setup.json
curl -s -o "$SEED_DATA_DIR/genesis.json" $SEED_DATA_URL/genesis.json
curl -s -o "$SEED_DATA_DIR/eth-genesis.json" $SEED_DATA_URL/eth-genesis.json
curl -s -o "$SEED_DATA_DIR/eth-nether-genesis.json" $SEED_DATA_URL/eth-nether-genesis.json
curl -s -o "$SEED_DATA_DIR/el-peers.txt" $SEED_DATA_URL/el-peers.txt
curl -s -o "$SEED_DATA_DIR/el-bootnodes.txt" $SEED_DATA_URL/el-bootnodes.txt
curl -s -o "$SEED_DATA_DIR/app.toml" $SEED_DATA_URL/app.toml
curl -s -o "$SEED_DATA_DIR/config.toml" $SEED_DATA_URL/config.toml

md5sum "$SEED_DATA_DIR"/*
