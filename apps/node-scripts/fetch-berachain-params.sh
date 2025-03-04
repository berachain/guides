#!/bin/bash

set -e
. ./env.sh

mkdir -p seed-data

export SEED_DATA_URL=https://raw.githubusercontent.com/berachain/beacon-kit/refs/heads/main/testing/networks/$CHAIN_ID
curl -s -o seed-data/kzg-trusted-setup.json $SEED_DATA_URL/kzg-trusted-setup.json
curl -s -o seed-data/genesis.json $SEED_DATA_URL/genesis.json
curl -s -o seed-data/eth-genesis.json $SEED_DATA_URL/eth-genesis.json
curl -s -o seed-data/eth-nether-genesis.json $SEED_DATA_URL/eth-nether-genesis.json
curl -s -o seed-data/el-peers.txt $SEED_DATA_URL/el-peers.txt
curl -s -o seed-data/el-bootnodes.txt $SEED_DATA_URL/el-bootnodes.txt
curl -s -o seed-data/app.toml $SEED_DATA_URL/app.toml
curl -s -o seed-data/config.toml $SEED_DATA_URL/config.toml

md5sum seed-data/*
