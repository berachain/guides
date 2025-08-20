#!/bin/bash 

########
# CHANGE THESE VALUES
export CHAIN_SPEC=mainnet   # "mainnet" or "testnet"
export MONIKER_NAME=camembera
export WALLET_ADDRESS_FEE_RECIPIENT=0x9BcaA41DC32627776b1A4D714Eef627E640b3EF5
export EL_ARCHIVE_NODE=false # set to true if you want to run an archive node on CL and EL
export MY_IP=`curl -s ipv4.canhazip.com`

########
# VALUES YOU MIGHT WANT TO CHANGE
export LOG_DIR=$(pwd)/logs
export BEACOND_BIN=$(command -v bera-beacond || command -v beacond || echo $(pwd)/beacond)
export BEACOND_DATA=$(pwd)/var/beacond
export BEACOND_CONFIG=$BEACOND_DATA/config  # can't change this. sorry.
export JWT_PATH=$BEACOND_CONFIG/jwt.hex

# need at least one of these
export RETH_BIN=$(command -v bera-reth || echo $(pwd)/bera-reth)
export GETH_BIN=$(command -v bera-geth || echo $(pwd)/bera-geth)

# Leave this blank to use the default ports for the various services.
# Set this to a port number (for example, 30000) to 
# have the services listen on sequential ports (30000, 30001, 30002, etc)
export PORT_BASE=50000
if [[ -n "$PORT_BASE" ]]; then
    export CL_ETHRPC_PORT=$(($PORT_BASE+0))
    export CL_ETHP2P_PORT=$(($PORT_BASE+1))
    export CL_ETHPROXY_PORT=$(($PORT_BASE+2))
    export EL_ETHRPC_PORT=$(($PORT_BASE+3))
    export EL_AUTHRPC_PORT=$(($PORT_BASE+4))
    export EL_ETH_PORT=$(($PORT_BASE+5))
    export EL_PROMETHEUS_PORT=$(($PORT_BASE+6))
    export CL_PROMETHEUS_PORT=$(($PORT_BASE+7))
else
    export CL_ETHRPC_PORT=26657
    export CL_ETHP2P_PORT=26656
    export CL_ETHPROXY_PORT=26658
    export EL_ETHRPC_PORT=8545
    export EL_AUTHRPC_PORT=8551
    export EL_ETH_PORT=30303
    export EL_PROMETHEUS_PORT=9101
    export CL_PROMETHEUS_PORT=9102
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
export SEED_DATA_DIR=$(pwd)/seed-data-$CHAIN_ID

if [ -f "$SEED_DATA_DIR/el-bootnodes.txt" ]; then
    EL_BOOTNODES=$(grep '^enode://' "$SEED_DATA_DIR/el-bootnodes.txt"| tr '\n' ',' | sed 's/,$//')
fi

if [ -f "$SEED_DATA_DIR/el-peers.txt" ]; then
    EL_PEERS=$(grep '^enode://' "$SEED_DATA_DIR/el-peers.txt"| tr '\n' ',' | sed 's/,$//')
    EL_PEERS_DNS=$(grep '^enrtree://' "$SEED_DATA_DIR/el-peers.txt"| tr '\n' ',' | sed 's/,$//')
fi

if [[ "$OSTYPE" == "darwin"* ]]; then
    export SED_OPT="-i ''"
else
    export SED_OPT='-i'
fi

if command >/dev/null -v $RETH_BIN; then
    export RETH_DATA=$(pwd)/var/reth/data
    export RETH_GENESIS_PATH=$(pwd)/var/reth/genesis.json
fi  

if command >/dev/null -v $GETH_BIN; then
    export GETH_DATA=$(pwd)/var/geth
    export GETH_GENESIS_PATH=$GETH_DATA/genesis.json
fi  

  

if ! command >/dev/null -v $RETH_BIN && ! command >/dev/null -v $GETH_BIN; then
    echo "Error: No execution client found in PATH"
    echo "Please install either reth or geth and ensure it is available in your PATH"
    exit 1
fi
