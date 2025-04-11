# Load env from env.sh - Modify this as needed
source env.sh;

# Remove all config folders
rm -rf $TMP_BEACOND_DIR/config-genesis;
for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
  rm -rf $TMP_BEACOND_DIR/config-cl-val$i;
  rm -rf $TMP_BEACOND_DIR/config-cl-rpc$i;
  rm -rf $TMP_RETH_DIR/config-el-val$i;
  rm -rf $TMP_RETH_DIR/config-el-rpc$i;
done

rm -rf ./tmp/;

# Remove all docker containers
echo "Shutting down docker containers:";
if [ $NUM_VALIDATORS -gt 0 ]; then
  for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
  docker rm -f $EL_MONIKER-val-$i;
    docker rm -f $CL_MONIKER-val-$i;
  done
fi

if [ $NUM_RPC_NODES -gt 0 ]; then
  for i in $(seq 0 $((NUM_RPC_NODES - 1))); do
    docker rm -f $CL_MONIKER-rpc-$i;
    docker rm -f $EL_MONIKER-rpc-$i;
  done
fi

# Remove all networks
for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
  docker network rm $NETWORK_NAME-val-$i;
done
for i in $(seq 0 $((NUM_RPC_NODES - 1))); do
  docker network rm $NETWORK_NAME-rpc-$i;
done

