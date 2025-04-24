# Load env from env.sh - Modify this as needed
set -e;
source env.sh;

echo "Starting Beacond...";

# Step 0 - Create Config Folders
# ===========================================================
echo "0 - Creating config folders...\n";
# Create config folders - ex `config0, config1, config2, config3`
for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
  mkdir -p $TMP_BEACOND_DIR/config-cl-val$i;
done

if [ $NUM_RPC_NODES -gt 0 ]; then
  for i in $(seq 0 $((NUM_RPC_NODES - 1))); do
    mkdir -p $TMP_BEACOND_DIR/config-cl-rpc$i;
  done
fi

# Step 1 - Create Node Configurations
# ===========================================================
echo "1 - Creating node configurations...\n";
# - Validator 0
BEACOND_MONIKER=$CL_MONIKER-0;
docker run --rm -v $TMP_BEACOND_DIR/config-cl-val0:/root/.beacond $DOCKER_IMAGE_BEACOND /bin/bash \
  -c "./beacond init $BEACOND_MONIKER --chain-id $BEACOND_CHAIN_ID; echo $JWT_TOKEN > /root/.beacond/config/jwt.hex; chmod 600 /root/.beacond/config/jwt.hex; ./beacond genesis add-premined-deposit $GENESIS_DEPOSIT_AMOUNT $WITHDRAW_ADDRESS;";
cp -r $TMP_BEACOND_DIR/config-cl-val0/ $TMP_BEACOND_DIR/config-genesis;

# - Validators 1 to NUM_VALIDATORS - 1
if [ $NUM_VALIDATORS -gt 1 ]; then
  for i in $(seq 1 $((NUM_VALIDATORS - 1))); do
    BEACOND_MONIKER=$CL_MONIKER-$i;
    docker run --rm -v $TMP_BEACOND_DIR/config-cl-val$i:/root/.beacond $DOCKER_IMAGE_BEACOND /bin/bash \
    -c "./beacond init $BEACOND_MONIKER --chain-id $BEACOND_CHAIN_ID; echo $JWT_TOKEN > /root/.beacond/config/jwt.hex; chmod 600 /root/.beacond/config/jwt.hex; ./beacond genesis add-premined-deposit $GENESIS_DEPOSIT_AMOUNT $WITHDRAW_ADDRESS;";
  done
fi

# - Copy premined json files from each validator config
if [ $NUM_VALIDATORS -gt 1 ]; then
  for i in $(seq 1 $((NUM_VALIDATORS - 1))); do
    cp $TMP_BEACOND_DIR/config-cl-val$i/config/premined-deposits/premined-deposit-*.json $TMP_BEACOND_DIR/config-genesis/config/premined-deposits/;
  done
fi

# - Collected premined deposits
docker run --rm -v $TMP_BEACOND_DIR/config-genesis:/root/.beacond $DOCKER_IMAGE_BEACOND /bin/bash \
  -c "./beacond genesis collect-premined-deposits;";

# Step 2 - Create Eth Genesis File
# ===========================================================
echo "2 - Creating eth genesis file...\n";
# - Copy eth genesis template to config-genesis
cp templates/eth/eth-genesis.json $TMP_BEACOND_DIR/config-genesis/;

# - Update chainId in genesis.json
jq --argjson chainid "$CHAIN_ID" '.config.chainId = $chainid' $TMP_BEACOND_DIR/config-genesis/eth-genesis.json > $TMP_BEACOND_DIR/config-genesis/eth-genesis.json.tmp && mv $TMP_BEACOND_DIR/config-genesis/eth-genesis.json.tmp $TMP_BEACOND_DIR/config-genesis/eth-genesis.json;
jq --arg genesisDepositCountHex "0x0000000000000000000000000000000000000000000000000000000000000000" '.alloc."0x4242424242424242424242424242424242424242".storage."0x0000000000000000000000000000000000000000000000000000000000000000" = $genesisDepositCountHex' $TMP_BEACOND_DIR/config-genesis/eth-genesis.json > $TMP_BEACOND_DIR/config-genesis/eth-genesis.json.tmp && mv $TMP_BEACOND_DIR/config-genesis/eth-genesis.json.tmp $TMP_BEACOND_DIR/config-genesis/eth-genesis.json;
jq --arg genesisDepositsRoot "0x0000000000000000000000000000000000000000000000000000000000000000" '.alloc."0x4242424242424242424242424242424242424242".storage."0x0000000000000000000000000000000000000000000000000000000000000001" = $genesisDepositsRoot' $TMP_BEACOND_DIR/config-genesis/eth-genesis.json > $TMP_BEACOND_DIR/config-genesis/eth-genesis.json.tmp && mv $TMP_BEACOND_DIR/config-genesis/eth-genesis.json.tmp $TMP_BEACOND_DIR/config-genesis/eth-genesis.json;

# Step 3 - Modify Genesis With Deposits
# ===========================================================
echo "3 - Modifying genesis with deposits...\n";
docker run --rm -v $TMP_BEACOND_DIR/config-genesis:/root/.beacond $DOCKER_IMAGE_BEACOND /bin/bash \
  -c "./beacond genesis set-deposit-storage /root/.beacond/eth-genesis.json";

docker run --rm -v $TMP_BEACOND_DIR/config-genesis:/root/.beacond $DOCKER_IMAGE_BEACOND /bin/bash \
  -c "./beacond genesis execution-payload /root/.beacond/eth-genesis.json";

# Step 4 - Add Configurations Files
# ===========================================================
echo "4 - Adding configurations files...\n";
# - Add KZG File
cp templates/beacond/kzg-trusted-setup.json $TMP_BEACOND_DIR/config-genesis/config;
cp templates/beacond/kzg-trusted-setup.json $TMP_BEACOND_DIR/config-cl-val0/config;
if [ $NUM_VALIDATORS -gt 1 ]; then
  for i in $(seq 1 $((NUM_VALIDATORS - 1))); do
    cp templates/beacond/kzg-trusted-setup.json $TMP_BEACOND_DIR/config-cl-val$i/config;
  done
fi

# - jwt.hex
# - kzg-trusted-setup.json
# - suggested-fee-recipient
# - rpc-dial-url
# - [beacon-kit.node-api] enabled = true
# - address = "0.0.0.0:3500"
if [ $NUM_VALIDATORS -gt 0 ]; then
  for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
    sed -i '' 's|jwt-secret-path = ".*"|jwt-secret-path = "/root/.beacond/config/jwt.hex"|' $TMP_BEACOND_DIR/config-cl-val$i/config/app.toml;
    sed -i '' "s|suggested-fee-recipient = \".*\"|suggested-fee-recipient = \"$SUGGESTED_FEE_RECIPIENT\"|" $TMP_BEACOND_DIR/config-cl-val$i/config/app.toml;
    sed -i '' 's|trusted-setup-path = ".*"|trusted-setup-path = "/root/.beacond/config/kzg-trusted-setup.json"|' $TMP_BEACOND_DIR/config-cl-val$i/config/app.toml;
    sed -i '' "s|rpc-dial-url = \".*\"|rpc-dial-url = \"http://$EL_MONIKER-val-$i:8551\"|" $TMP_BEACOND_DIR/config-cl-val$i/config/app.toml;
    sed -i '' '179s/enabled = "false"/enabled = "true"/' $TMP_BEACOND_DIR/config-cl-val$i/config/app.toml;
    sed -i '' "s|address = \".*\"|address = \"0.0.0.0:3500\"|" $TMP_BEACOND_DIR/config-cl-val$i/config/app.toml;
  done
fi

# - node = "tcp://0.0.0.0:26657" 
# - cors_allowed_origins = ["*"]
# - unsafe = true
# - indexer = "kv"
if [ $NUM_VALIDATORS -gt 0 ]; then
  for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
    sed -i '' "s|laddr = \"tcp://127.0.0.1:26657\"|laddr = \"tcp://0.0.0.0:26657\"|" $TMP_BEACOND_DIR/config-cl-val$i/config/config.toml;
    sed -i '' "s|cors_allowed_origins = \[\]|cors_allowed_origins = \[\"*\"\]|" $TMP_BEACOND_DIR/config-cl-val$i/config/config.toml;
    sed -i '' '108s/unsafe = "false"/unsafe = "true"/' $TMP_BEACOND_DIR/config-cl-val$i/config/config.toml;
    sed -i '' 's|indexer = "null"|indexer = "kv"|' $TMP_BEACOND_DIR/config-cl-val$i/config/config.toml;
  done
fi

# - genesis.json - cp from config-genesis to config-cl-val$i
for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
  cp -f $TMP_BEACOND_DIR/config-genesis/config/genesis.json $TMP_BEACOND_DIR/config-cl-val$i/config/genesis.json;
done

# - seeds - only one node is a seed
SEEDS="";
if [ $NUM_VALIDATORS -gt 1 ]; then
  NODE_ID=$(docker run --rm -v $TMP_BEACOND_DIR/config-cl-val0:/root/.beacond --name $CL_MONIKER-val-0 $DOCKER_IMAGE_BEACOND /bin/bash \
      -c "CHAIN_SPEC=$CHAIN_SPEC ./beacond tendermint show-node-id");
  SEEDS="$NODE_ID@$CL_MONIKER-val-0:26656";

  for i in $(seq 1 $((NUM_VALIDATORS - 1))); do
    sed -i '' "s|seeds = \".*\"|seeds = \"$SEEDS\"|" $TMP_BEACOND_DIR/config-cl-val$i/config/config.toml;
  done
fi

# - persistent_peers - only seed node has persistent peers
ALL_PERSISTENT_PEERS="";
if [ $NUM_VALIDATORS -gt 1 ]; then
  for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
    # First collect all node IDs and addresses
    NODE_ID=$(docker run --rm -v $TMP_BEACOND_DIR/config-cl-val$i:/root/.beacond --name $CL_MONIKER-$i $DOCKER_IMAGE_BEACOND /bin/bash \
        -c "CHAIN_SPEC=$CHAIN_SPEC ./beacond tendermint show-node-id");
    PEERS[$i]="$NODE_ID@$CL_MONIKER-val-$i:26656";
    ALL_PERSISTENT_PEERS+="${PEERS[$i]},";
  done

  # Then create persistent peers list excluding self for each node
  for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
    if [ $i -eq 0 ]; then
      continue;
    fi
    PERSISTENT_PEERS="";
    for j in $(seq 0 $((NUM_VALIDATORS - 1))); do
      if [ $i -ne $j ]; then
        PERSISTENT_PEERS+="${PEERS[$j]},";
      fi
    done
    PERSISTENT_PEERS=${PERSISTENT_PEERS%,};
    sed -i '' "s|persistent_peers = \".*\"|persistent_peers = \"$PERSISTENT_PEERS\"|" $TMP_BEACOND_DIR/config-cl-val$i/config/config.toml;
  done
fi

# Step 5 - Create RPC CL Nodes
# ===========================================================
echo "5 - Creating rpc cl nodes...\n";
if [ $NUM_RPC_NODES -gt 0 ]; then
  for i in $(seq 0 $((NUM_RPC_NODES - 1))); do
    docker run --rm -v $TMP_BEACOND_DIR/config-cl-rpc$i:/root/.beacond $DOCKER_IMAGE_BEACOND /bin/bash \
    -c "./beacond init $CL_MONIKER-rpc$i --chain-id $BEACOND_CHAIN_ID; echo $JWT_TOKEN > /root/.beacond/config/jwt.hex; chmod 600 /root/.beacond/config/jwt.hex; ./beacond genesis add-premined-deposit $GENESIS_DEPOSIT_AMOUNT $WITHDRAW_ADDRESS;";
    cp templates/beacond/kzg-trusted-setup.json $TMP_BEACOND_DIR/config-cl-rpc$i/config;
    cp -f $TMP_BEACOND_DIR/config-cl-val0/config/app.toml $TMP_BEACOND_DIR/config-cl-rpc$i/config/app.toml;
    cp -f $TMP_BEACOND_DIR/config-cl-val0/config/config.toml $TMP_BEACOND_DIR/config-cl-rpc$i/config/config.toml;
    cp -f $TMP_BEACOND_DIR/config-genesis/config/genesis.json $TMP_BEACOND_DIR/config-cl-rpc$i/config/genesis.json;
    sed -i '' "s|persistent_peers = \".*\"|persistent_peers = \"$ALL_PERSISTENT_PEERS\"|" $TMP_BEACOND_DIR/config-cl-rpc$i/config/config.toml;
    sed -i '' "s|seeds = \".*\"|seeds = \"$SEEDS\"|" $TMP_BEACOND_DIR/config-cl-rpc$i/config/config.toml;
    sed -i '' "s|rpc-dial-url = \".*\"|rpc-dial-url = \"http://$EL_MONIKER-rpc-$i:8551\"|" $TMP_BEACOND_DIR/config-cl-rpc$i/config/app.toml;
        sed -i '' "s|laddr = \"tcp://127.0.0.1:26657\"|laddr = \"tcp://0.0.0.0:26657\"|" $TMP_BEACOND_DIR/config-cl-val$i/config/config.toml;
    sed -i '' "s|cors_allowed_origins = \[\]|cors_allowed_origins = \[\"*\"\]|" $TMP_BEACOND_DIR/config-cl-rpc$i/config/config.toml;
    sed -i '' '108s/unsafe = "false"/unsafe = "true"/' $TMP_BEACOND_DIR/config-cl-rpc$i/config/config.toml;
  done
fi

# Step 6 - Reth Configurations
# ===========================================================
echo "6 - Creating reth configurations...\n";
for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
   # Validator Configurations
  mkdir -p $TMP_RETH_DIR/config-el-val$i;
  mkdir -p $TMP_RETH_DIR/config-el-val$i/.reth;
  mkdir -p $TMP_RETH_DIR/config-el-val$i/logs;
  cp $TMP_BEACOND_DIR/config-genesis/eth-genesis.json $TMP_RETH_DIR/config-el-val$i/.reth;
  cp $TMP_BEACOND_DIR/config-genesis/config/jwt.hex $TMP_RETH_DIR/config-el-val$i/.reth;
done

if [ $NUM_RPC_NODES -gt 0 ]; then
  for i in $(seq 0 $((NUM_RPC_NODES - 1))); do
    # RPC Configurations
    mkdir -p $TMP_RETH_DIR/config-el-rpc$i;
    mkdir -p $TMP_RETH_DIR/config-el-rpc$i/.reth;
    mkdir -p $TMP_RETH_DIR/config-el-rpc$i/logs;
    cp $TMP_BEACOND_DIR/config-genesis/eth-genesis.json $TMP_RETH_DIR/config-el-rpc$i/.reth;
    cp $TMP_BEACOND_DIR/config-genesis/config/jwt.hex $TMP_RETH_DIR/config-el-rpc$i/.reth;
  done
fi

# - Initialize Reth
# -- Validator Configurations
for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
  docker run --rm -v $TMP_RETH_DIR/config-el-val$i/.reth:/root/.reth $DOCKER_IMAGE_RETH /bin/bash \
    -c "./reth init --chain \
      /root/.reth/eth-genesis.json \
      --datadir /root/.reth;";
done

# -- RPC Configurations
if [ $NUM_RPC_NODES -gt 0 ]; then
  for i in $(seq 0 $((NUM_RPC_NODES - 1))); do
    docker run --rm -v $TMP_RETH_DIR/config-el-rpc$i/.reth:/root/.reth $DOCKER_IMAGE_RETH /bin/bash \
      -c "./reth init --chain \
        /root/.reth/eth-genesis.json \
        --datadir /root/.reth;";
  done
fi

# Step 7 - Start Docker Containers
# ===========================================================
echo "7 - Starting docker containers...\n";
# - Create Networks
for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
  if ! docker network inspect $NETWORK_NAME-val-$i >/dev/null 2>&1; then
    docker network create $NETWORK_NAME-val-$i;
  fi
done

if [ $NUM_RPC_NODES -gt 0 ]; then
  for i in $(seq 0 $((NUM_RPC_NODES - 1))); do
    if ! docker network inspect $NETWORK_NAME-rpc-$i >/dev/null 2>&1; then
      docker network create $NETWORK_NAME-rpc-$i;
    fi
  done
fi

# - Run Beacond
echo "\n- Running Beacond...\n";
for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
  docker run -d -v $TMP_BEACOND_DIR/config-cl-val$i:/root/.beacond --name $CL_MONIKER-val-$i --network $NETWORK_NAME-val-$i $DOCKER_IMAGE_BEACOND /bin/bash \
    -c "CHAIN_SPEC=$CHAIN_SPEC ./beacond start";
done

if [ $NUM_RPC_NODES -gt 0 ]; then
  # Make first RPC has exposed ports
  docker run -d -p 26657:26657 -p 3500:3500 -v $TMP_BEACOND_DIR/config-cl-rpc0:/root/.beacond --name $CL_MONIKER-rpc-0 --network $NETWORK_NAME-rpc-0 $DOCKER_IMAGE_BEACOND /bin/bash \
    -c "CHAIN_SPEC=$CHAIN_SPEC ./beacond start";

  if [ $NUM_RPC_NODES -gt 1 ]; then
    for i in $(seq 1 $((NUM_RPC_NODES - 1))); do
      docker run -d -v $TMP_BEACOND_DIR/config-cl-rpc$i:/root/.beacond --name $CL_MONIKER-rpc-$i --network $NETWORK_NAME-rpc-$i $DOCKER_IMAGE_BEACOND /bin/bash \
        -c "CHAIN_SPEC=$CHAIN_SPEC ./beacond start";
    done
  fi
fi

# - Run Reth
echo "\n- Running Reth...\n";

# Get Bootnodes
for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
  docker run \
  -d \
  -v $TMP_RETH_DIR/config-el-val$i/.reth:/root/.reth \
  -v $TMP_RETH_DIR/config-el-val$i/logs:/root/logs \
  --name $EL_MONIKER-val-$i \
  --network $NETWORK_NAME-val-$i $DOCKER_IMAGE_RETH /bin/bash \
    -c "./reth node \
    --authrpc.jwtsecret=/root/.reth/jwt.hex \
    --chain=/root/.reth/eth-genesis.json \
    --datadir=/root/.reth \
    --port=30303 \
    --engine.persistence-threshold=0 \
    --engine.memory-block-buffer-target=0 \
    --http \
    --http.api="admin,debug,eth,net,trace,txpool,web3,rpc,reth,ots,flashbots,miner,mev" \
    --http.addr=0.0.0.0 \
    --http.port=8545 \
    --http.corsdomain=\"*\" \
    --ws \
    --ws.addr=0.0.0.0 \
    --ws.port=8546 \
    --ws.origins=\"*\" \
    --authrpc.addr=0.0.0.0 \
    --authrpc.port=8551 \
    --log.file.directory=/root/logs;";
done

if [ $NUM_RPC_NODES -gt 0 ]; then
  # Make first RPC has exposed ports
  docker run \
  -d -v $TMP_RETH_DIR/config-el-rpc0/.reth:/root/.reth \
  -p 8545:8545 \
  -p 8546:8546 \
  -v $TMP_RETH_DIR/config-el-rpc0/logs:/root/logs \
  --name $EL_MONIKER-rpc-0 \
    --network $NETWORK_NAME-rpc-0 $DOCKER_IMAGE_RETH /bin/bash \
    -c "./reth node \
      --authrpc.jwtsecret=/root/.reth/jwt.hex \
      --chain=/root/.reth/eth-genesis.json \
      --datadir=/root/.reth \
      --port=30303 \
      --http \
      --http.api="admin,debug,eth,net,trace,txpool,web3,rpc,reth,ots,flashbots,miner,mev" \
      --http.addr=0.0.0.0 \
      --http.port=8545 \
      --http.corsdomain=\"*\" \
      --ws \
      --ws.addr=0.0.0.0 \
      --ws.port=8546 \
      --ws.origins=\"*\" \
      --authrpc.addr=0.0.0.0 \
      --authrpc.port=8551 \
      --log.file.directory=/root/logs";

  if [ $NUM_RPC_NODES -gt 1 ]; then
    for i in $(seq 1 $((NUM_RPC_NODES - 1))); do
      docker run \
      -d -v $TMP_RETH_DIR/config-el-rpc$i/.reth:/root/.reth \
      -v $TMP_RETH_DIR/config-el-rpc$i/logs:/root/logs \
      --name $EL_MONIKER-rpc-$i \
      --network $NETWORK_NAME-rpc-$i $DOCKER_IMAGE_RETH /bin/bash \
        -c "./reth node \
        --authrpc.jwtsecret=/root/.reth/jwt.hex \
        --chain=/root/.reth/eth-genesis.json \
        --datadir=/root/.reth \
        --port=30303 \
        --http \
        --http.addr=0.0.0.0 \
        --http.port=8545 \
        --http.corsdomain=\"*\" \
        --ws \
        --ws.addr=0.0.0.0 \
        --ws.port=8546 \
        --ws.origins=\"*\" \
        --authrpc.addr=0.0.0.0 \
        --authrpc.port=8551 \
        --log.file.directory=/root/logs";
    done
  fi 
fi

# Step 8 - Connect Containers to Networks
# ===========================================================
echo "8 - Connecting containers to networks...\n";
# - Connect all containers to all networks
for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
  for j in $(seq 0 $((NUM_VALIDATORS - 1))); do
    if [ $i != $j ]; then
      docker network connect $NETWORK_NAME-val-$j $CL_MONIKER-val-$i;
      docker network connect $NETWORK_NAME-val-$j $EL_MONIKER-val-$i;
    fi
  done
done

if [ $NUM_RPC_NODES -gt 1 ]; then
  # Connect RPC Nodes to each other
  for i in $(seq 0 $((NUM_RPC_NODES - 1))); do
    for j in $(seq 0 $((NUM_RPC_NODES - 1))); do
      if [ $i != $j ]; then
        docker network connect $NETWORK_NAME-rpc-$i $CL_MONIKER-rpc-$j;
        docker network connect $NETWORK_NAME-rpc-$i $EL_MONIKER-rpc-$j;
      fi
    done
  done
fi

if [ $NUM_RPC_NODES -gt 0 ]; then
  # Connect Validator Nodes to RPC Nodes
  for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
    for j in $(seq 0 $((NUM_RPC_NODES - 1))); do
      docker network connect $NETWORK_NAME-val-$i $CL_MONIKER-rpc-$j;
      docker network connect $NETWORK_NAME-val-$i $EL_MONIKER-rpc-$j;
    done
  done

  # Connect RPC Nodes to Validator Nodes
  for i in $(seq 0 $((NUM_RPC_NODES - 1))); do
    for j in $(seq 0 $((NUM_VALIDATORS - 1))); do
      docker network connect $NETWORK_NAME-rpc-$i $CL_MONIKER-val-$j;
      docker network connect $NETWORK_NAME-rpc-$i $EL_MONIKER-val-$j;
    done
  done
fi

# Step 9 - Connect EL Peers
# ===========================================================
echo "9 - Connecting EL Peers...\n";
RETH_BOOTNODES=();
# - Validator Nodes
for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
  ENODE=$(docker exec $EL_MONIKER-val-$i /bin/bash -c "curl -s --location 'http://localhost:8545' \
  --header 'Content-Type: application/json' \
  --data '{ \
    \"jsonrpc\": \"2.0\", \
    \"method\": \"admin_nodeInfo\", \
    \"params\": [], \
    \"id\": 1 \
  }'" | jq .result.enode | tr -d '"');
  ENODE_ID=$(echo $ENODE | sed -E 's/enode:\/\/([^@]+)@.*/\1/');
  RPC_IP=$(docker exec $EL_MONIKER-val-$i hostname -I | awk '{print $1}');
  RPC_ENODE=$(echo $ENODE | sed "s/@[^:]*:30303/@$RPC_IP:30303/");
  RETH_BOOTNODES+=("$RPC_ENODE");
done

# - RPC Nodes
for i in $(seq 0 $((NUM_RPC_NODES - 1))); do
  ENODE=$(docker exec $EL_MONIKER-rpc-$i /bin/bash -c "curl -s --location 'http://localhost:8545' \
  --header 'Content-Type: application/json' \
  --data '{ \
    \"jsonrpc\": \"2.0\", \
    \"method\": \"admin_nodeInfo\", \
    \"params\": [], \
    \"id\": 1 \
  }'" | jq .result.enode | tr -d '"');
  ENODE_ID=$(echo $ENODE | sed -E 's/enode:\/\/([^@]+)@.*/\1/');
  RPC_IP=$(docker exec $EL_MONIKER-rpc-$i hostname -I | awk '{print $1}');
  RPC_ENODE=$(echo $ENODE | sed "s/@[^:]*:30303/@$RPC_IP:30303/");
  RETH_BOOTNODES+=("$RPC_ENODE");
done

# - Add Peers
# -- RPC Nodes
for i in $(seq 0 $((NUM_RPC_NODES - 1))); do
  for bootnode in "${RETH_BOOTNODES[@]}"; do
    docker exec $EL_MONIKER-rpc-$i /bin/bash -c "curl -s -H 'Content-Type: application/json' -X POST --data '{\"jsonrpc\":\"2.0\",\"method\":\"admin_addPeer\",\"params\":[\"$bootnode\"],\"id\":1}' http://localhost:8545;";
    echo "\nAdded peer $bootnode to $EL_MONIKER-rpc-$i\n";
  done
done

# -- Validator Nodes
for i in $(seq 0 $((NUM_VALIDATORS - 1))); do
  for bootnode in "${RETH_BOOTNODES[@]}"; do
    docker exec $EL_MONIKER-val-$i /bin/bash -c "curl -s -H 'Content-Type: application/json' -X POST --data '{\"jsonrpc\":\"2.0\",\"method\":\"admin_addPeer\",\"params\":[\"$bootnode\"],\"id\":1}' http://localhost:8545;";
    echo "\nAdded peer $bootnode to $EL_MONIKER-val-$i\n";
  done
done

echo "\033[32mStarted!\033[0m";
