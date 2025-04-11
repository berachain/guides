#!/bin/bash

source env.sh;

echo "Starting Beacon Deposit Txn...";

set -e;

if [ -z "$NUM_RPC_NODES" ] || [ $NUM_RPC_NODES -eq 0 ]; then
  echo "No RPC nodes set. Exiting...";
  exit 1;
fi

# Step 0 - Retrieve Validator Pubkey & Verify Not A Validator
# ===========================================================
echo -e "0 - Retrieving Validator Pubkey & Verifying Not A Validator...\n";

COMETBFT_PUB_KEY=$(docker exec $CL_MONIKER-rpc-0 ./beacond deposit validator-keys|tail -1);
GENESIS_ROOT=$(docker exec $CL_MONIKER-rpc-0 ./beacond genesis validator-root /root/.beacond/config/genesis.json);

docker exec $CL_MONIKER-rpc-0 ./beacond genesis validator-root /root/.beacond/config/genesis.json;
docker exec $CL_MONIKER-val-1 ./beacond genesis validator-root /root/.beacond/config/genesis.json;

if curl -s http://localhost:3500/eth/v1/beacon/states/head/validators | jq .data | grep -q "$COMETBFT_PUB_KEY"; then
  echo "Validator already found in current validators. Exiting...";
  exit 1;
fi

# Step 1 - Generate Deposit Signature
# ===========================================================
echo -e "\n1 - Generating Signature for Parameters: \n\tpubkey = $COMETBFT_PUB_KEY \n\tamount = $STAKE_AMOUNT_GWEI \n\tgenesis_root = $GENESIS_ROOT \n\twithdraw_address = $WITHDRAW_ADDRESS";

WITHDRAW_CREDENTIAL=$(docker exec $CL_MONIKER-rpc-0 ./beacond deposit create-validator $WITHDRAW_ADDRESS $STAKE_AMOUNT_GWEI -g $GENESIS_ROOT | sed -n 's/credentials: //p');
DEPOSIT_SIGNATURE=$(docker exec $CL_MONIKER-rpc-0 ./beacond deposit create-validator $WITHDRAW_ADDRESS $STAKE_AMOUNT_GWEI -g $GENESIS_ROOT | sed -n 's/signature: //p');
DEPOSIT_TX_VALID=$(docker exec $CL_MONIKER-rpc-0 ./beacond deposit validate $COMETBFT_PUB_KEY $WITHDRAW_CREDENTIAL $STAKE_AMOUNT_GWEI $DEPOSIT_SIGNATURE -g $GENESIS_ROOT);

if [ "✅ Deposit message is valid!" != "$DEPOSIT_TX_VALID" ]; then
  echo -e "Deposit signature is invalid! Exiting...";
  exit 1;
fi

echo -e "\n\nSend this command to view validators:";
echo -e "curl -s http://localhost:3500/eth/v1/beacon/states/head/validators | jq .data";

# Step 2 - Preparing Registration Deposit Transaction
# ===========================================================
echo "2 - Preparing Registration Deposit Transaction...";

echo -e "\n\nSend this command to register the validator: \n\t";
echo cast send $BEACONDEPOSIT_ADDRESS \'deposit\(bytes,bytes,bytes,address\)\' \
  $COMETBFT_PUB_KEY $WITHDRAW_CREDENTIAL $DEPOSIT_SIGNATURE $OPERATOR_ADDRESS \
  --value "${STAKE_AMOUNT_ETH}ether" \
  --private-key $WALLET_PRIVATE_KEY \
  --rpc-url $RPC_URL;

# Step 3 - Preparing Activation Deposit Transaction
# ===========================================================
echo "3 - Preparing Activation Deposit Transaction...";

echo -e "\n\nSend this command to activate the validator: \n\t";
echo cast send $BEACONDEPOSIT_ADDRESS \'deposit\(bytes,bytes,bytes,address\)\' \
  "$COMETBFT_PUB_KEY" \
  "0x0000000000000000000000000000000000000000000000000000000000000000" \
  "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" \
  "0x0000000000000000000000000000000000000000" \
  --private-key $WALLET_PRIVATE_KEY \
  --value "${REMAINING_STAKE_AMOUNT_ETH}ether" \
  --rpc-url $RPC_URL;
