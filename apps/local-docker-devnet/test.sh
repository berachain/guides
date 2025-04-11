# Load env from env.sh - Modify this as needed
source env.sh;

TEST_SCRIPT_EL="";
for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
  TEST_SCRIPT_EL+="echo $'\nTESTING \"$EL_MONIKER-val-$i\":';";
  TEST_SCRIPT_EL+="curl -s --location 'http://$EL_MONIKER-val-$i:8545' \
    --header 'Content-Type: application/json' \
    --data '{ \
      \"jsonrpc\": \"2.0\", \
      \"method\": \"eth_blockNumber\", \
      \"params\": [], \
      \"id\": 1 \
    }' | jq;";
done

if [ $NUM_RPC_NODES -gt 0 ]; then
  for i in $(seq 0 $((NUM_RPC_NODES - 1))); do
    TEST_SCRIPT_EL+="echo $'\nTESTING \"$EL_MONIKER-rpc-$i\":';";
    TEST_SCRIPT_EL+="curl -s --location 'http://$EL_MONIKER-rpc-$i:8545' \
      --header 'Content-Type: application/json' \
      --data '{ \
        \"jsonrpc\": \"2.0\", \
        \"method\": \"eth_blockNumber\", \
        \"params\": [], \
        \"id\": 1 \
      }' | jq;";
  done
fi

for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
  echo "\nNETWORK: $NETWORK_NAME-val-$i\n==============================================";
  docker run --rm --network $NETWORK_NAME-val-$i $DOCKER_IMAGE_CURL /bin/bash -c "$TEST_SCRIPT_EL";
done

for i in $(seq 0 $((NUM_RPC_NODES - 1))); do
  echo "\nNETWORK: $NETWORK_NAME-rpc-$i\n==============================================";
  docker run --rm --network $NETWORK_NAME-rpc-$i $DOCKER_IMAGE_CURL /bin/bash -c "$TEST_SCRIPT_EL";
done