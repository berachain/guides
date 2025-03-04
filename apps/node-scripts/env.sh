#!/bin/bash 

########
# CHANGE THESE VALUES
export CHAIN_SPEC=testnet   # or "testnet"
export MONIKER_NAME=camembera
export WALLET_ADDRESS_FEE_RECIPIENT=0x9BcaA41DC32627776b1A4D714Eef627E640b3EF5
export EL_ARCHIVE_NODE=false # set to true if you want to run an archive node on CL and EL
export MY_IP=`curl -s canhazip.com`

########
# VALUES YOU MIGHT WANT TO CHANGE
export LOG_DIR=$(pwd)/logs
export BEACOND_BIN=$(command -v beacond || echo $(pwd)/beacond)
export BEACOND_DATA=$(pwd)/var/beacond
export BEACOND_CONFIG=$BEACOND_DATA/config  # can't change this. sorry.
export JWT_PATH=$BEACOND_CONFIG/jwt.hex

# need at least one of these
export RETH_BIN=$(command -v reth || echo $(pwd)/reth)
export GETH_BIN=$(command -v geth || echo $(pwd)/geth)
export NETHERMIND_BIN=$(command -v Nethermind.Runner || echo $(pwd)/Nethermind.Runner)
export ERIGON_BIN=$(command -v erigon || echo $(pwd)/erigon)

# Leave this blank to use the default ports for the various services.
# Set this to a port number (for example, 30000) to 
# have the services listen on sequential ports (30000, 30001, 30002, etc)
export PORT_BASE=32000
if [[ -n "$PORT_BASE" ]]; then
    export CL_ETHRPC_PORT=$(($PORT_BASE+0))
    export CL_ETHP2P_PORT=$(($PORT_BASE+1))
    export CL_ETHPROXY_PORT=$(($PORT_BASE+2))
    export EL_ETHRPC_PORT=$(($PORT_BASE+3))
    export EL_AUTHRPC_PORT=$(($PORT_BASE+4))
    export EL_ETH_PORT=$(($PORT_BASE+5))
    export PROMETHEUS_PORT=$(($PORT_BASE+6))
else
    export CL_ETHRPC_PORT=26657
    export CL_ETHP2P_PORT=26656
    export CL_ETHPROXY_PORT=26658
    export EL_ETHRPC_PORT=8545
    export EL_AUTHRPC_PORT=8551
    export EL_ETH_PORT=30303
    export PROMETHEUS_PORT=9101
fi

######
# LEAVE BELOW ALONE. CAN CHANGE (most) DATA DIRECTORIES

if [[ "$CHAIN_SPEC" == "testnet" ]]; then
    export CHAIN=testnet-beacon-80069
    export CHAIN_ID=80069
else
    export CHAIN=mainnet-beacon-80094
    export CHAIN_ID=80094
fi

if [ -f "seed-data/el-bootnodes.txt" ]; then
    EL_BOOTNODES=$(grep '^enode://' "seed-data/el-bootnodes.txt"| tr '\n' ',' | sed 's/,$//')
fi

if [ -f "seed-data/el-peers.txt" ]; then
    EL_PEERS=$(grep '^enode://' "seed-data/el-peers.txt"| tr '\n' ',' | sed 's/,$//')
fi

if [[ "$OSTYPE" == "darwin"* ]]; then
    export SED_OPT="-i ''"
else
    export SED_OPT='-i'
fi

if command >/dev/null -v $RETH_BIN; then
    export RETH_DATA=$(pwd)/var/reth
    export RETH_GENESIS_PATH=$RETH_DATA/genesis.json
fi  

if command -v $GETH_BIN; then
    export GETH_DATA=$(pwd)/var/geth
    export GETH_GENESIS_PATH=$GETH_DATA/genesis.json
fi  

if command -v $NETHERMIND_BIN; then
    export NETHERMIND_CONFIG_DIR=$(pwd)/var/nethermind/config/
    export NETHERMIND_DATA_DIR=$(pwd)/var/nethermind/data/
    export NETHERMIND_GENESIS_PATH="${NETHERMIND_CONFIG_DIR}/eth-nether-genesis.json"
fi  

if command -v $ERIGON_BIN; then
    export ERIGON_DATA=$(pwd)/var/erigon
    export ERIGON_GENESIS_PATH=$ERIGON_DATA/genesis.json
fi  

if ! command -v $RETH_BIN && ! command -v $GETH_BIN && ! command -v $NETHERMIND_BIN && ! command -v $ERIGON_BIN ; then
    echo "Error: No execution client found in PATH"
    echo "Please install either reth, geth, or Nethermind and ensure it is available in your PATH"
    exit 1
fi
