# deployment shape
NUM_VALIDATORS=3;
NUM_RPC_NODES=1;
RPC_URL=http://127.0.0.1:8545;
JWT_TOKEN=0xc4d70beb372fc886335d5bef3aabd63b4324b621132f5d8de67a06ddd0405fce;


# deployment content
CHAIN_ID=87337;
CHAIN_SPEC=file;  # mainnet or testnet or file. if file, uses above chain_id: see templates/beacond/*.toml
BEACOND_CHAIN_ID=$CHAIN_SPEC-beacon-$CHAIN_ID;
CUSTOM_BIN_BEACOND=./beacond-bectra;  # set this if you don't want to use the latest beacond from github

# important quantities
GENESIS_DEPOSIT_AMOUNT=250000000000000;
STAKE_AMOUNT_ETH=10000;
REMAINING_STAKE_AMOUNT_ETH=240000;
WITHDRAW_AMOUNT_ETH=10000
WITHDRAW_EXIT_AMOUNT=0

# important EOA's
OPERATOR_ADDRESS=0x9BcaA41DC32627776b1A4D714Eef627E640b3EF5;
SUGGESTED_FEE_RECIPIENT=0x20f33ce90a13a4b5e7697e3544c3083b8f8a51d4;

# staking comes from and is withdrawn back to this address + PK
WITHDRAW_ADDRESS=0x20f33ce90a13a4b5e7697e3544c3083b8f8a51d4;
WALLET_PRIVATE_KEY=fffdbb37105441e14b0ee6330d855d8504ff39e705c3afa8f859ac9865f99306;

# important contracts
BEACONDEPOSIT_ADDRESS=0x4242424242424242424242424242424242424242;
WITHDRAW_CONTRACT_ADDRESS=0x00000961Ef480Eb55e80D19ad83579A64c007002



# generally less important constants
DOCKER_IMAGE_BEACOND=beacond-docker;
DOCKER_IMAGE_RETH=reth-docker;
DOCKER_IMAGE_CURL=curl-docker;
TMP_BEACOND_DIR=./tmp/beacond;
TMP_RETH_DIR=./tmp/reth;
CL_MONIKER=cl-node;
EL_MONIKER=el-node;
NETWORK_NAME=beradevnet;
RETH_DIR=$TMP_RETH_DIR/.reth;
RETH_LOG_DIR=$TMP_RETH_DIR/logs;



