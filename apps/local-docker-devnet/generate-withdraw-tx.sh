#!/bin/bash

source env.sh;
set -e;


COMETBFT_PUB_KEY=$(docker exec $CL_MONIKER-rpc-0 ./beacond deposit validator-keys|tail -1);
echo "RPC validator pubkey is $COMETBFT_PUB_KEY"

WITHDRAW_FEE_HEX=$(cast call -r $RPC_URL $WITHDRAW_CONTRACT_ADDRESS)
WITHDRAW_FEE=$(cast to-dec $WITHDRAW_FEE_HEX)
echo "Determined withdrawal fee: $WITHDRAW_FEE"

WITHDRAW_AMOUNT_GWEI=${WITHDRAW_AMOUNT_ETH}000000000
WITHDRAW_REQUEST=$(cast abi-encode --packed '(bytes,uint64)' $COMETBFT_PUB_KEY $WITHDRAW_AMOUNT_GWEI)

echo -e "\nTo send withdrawal request for $WITHDRAW_AMOUNT_ETH BERA:\n"
echo -e "cast send $WITHDRAW_CONTRACT_ADDRESS $WITHDRAW_REQUEST --rpc-url $RPC_URL --private-key $WALLET_PRIVATE_KEY --value ${WITHDRAW_FEE}wei"

EXIT_REQUEST=$(cast abi-encode --packed '(bytes,uint64)' $COMETBFT_PUB_KEY $WITHDRAW_EXIT_AMOUNT)

echo -e "\nTo exit the validator and return BERA stake:\n"
echo -e "cast send $WITHDRAW_CONTRACT_ADDRESS $EXIT_REQUEST --rpc-url $RPC_URL --private-key $WALLET_PRIVATE_KEY --value ${WITHDRAW_FEE}wei"


