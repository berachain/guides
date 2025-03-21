#!/bin/bash

set -e
. ./env.sh
mkdir -p $BEACOND_DATA
mkdir -p $BEACOND_CONFIG
mkdir -p "$LOG_DIR"

# Check executables exist and are executable
if [ ! -x "$BEACOND_BIN" ]; then
    echo "Error: beacond executable $BEACOND_BIN does not exist or is not executable"
    exit 1
fi

if [ -f "$BEACOND_CONFIG/priv_validator_key.json" ]; then
    echo "Error: $BEACOND_CONFIG/priv_validator_key.json already exists"
    exit 1
fi

echo "BEACOND_DATA: $BEACOND_DATA"
echo "BEACOND_BIN: $BEACOND_BIN"
echo "  Version: $($BEACOND_BIN version)"

$BEACOND_BIN >/dev/null 2>&1 init $MONIKER_NAME --chain-id $CHAIN --home $BEACOND_DATA 
CHECK_FILE=$BEACOND_CONFIG/priv_validator_key.json
if [ ! -f "$CHECK_FILE" ]; then
    echo "Error: Private validator key was not created at $CHECK_FILE"
    exit 1
fi
echo "✓ Private validator key generated in $CHECK_FILE"

$BEACOND_BIN >/dev/null 2>&1 jwt generate -o $JWT_PATH
if [ ! -f "$JWT_PATH" ]; then
    echo "Error: JWT file was not created at $JWT_PATH"
    exit 1
fi
echo "✓ JWT secret generated at $JWT_PATH"

cp "$SEED_DATA_DIR/genesis.json" "$BEACOND_CONFIG/genesis.json"
cp "$SEED_DATA_DIR/kzg-trusted-setup.json" "$BEACOND_CONFIG/kzg-trusted-setup.json"

cp "$SEED_DATA_DIR/app.toml" "$BEACOND_CONFIG/app.toml"
sed $SED_OPT 's|^moniker = ".*"|moniker = "'$MONIKER_NAME'"|' "$BEACOND_CONFIG/config.toml"

cp "$SEED_DATA_DIR/config.toml" "$BEACOND_CONFIG/config.toml"
sed $SED_OPT 's|^rpc-dial-url = ".*"|rpc-dial-url = "'http://localhost:$EL_AUTHRPC_PORT'"|' "$BEACOND_CONFIG/app.toml"
sed $SED_OPT 's|^laddr = ".*26657"|laddr = "tcp://127.0.0.1:'$CL_ETHRPC_PORT'"|' "$BEACOND_CONFIG/config.toml"
sed $SED_OPT 's|^laddr = ".*26656"|laddr = "tcp://127.0.0.1:'$CL_ETHP2P_PORT'"|' "$BEACOND_CONFIG/config.toml"
sed $SED_OPT 's|^external_address = ".*"|external_address = "'$MY_IP:$CL_ETHP2P_PORT'"|' "$BEACOND_CONFIG/config.toml"
sed $SED_OPT 's|^proxy_app = ".*26658"|proxy_app = "tcp://127.0.0.1:'$CL_ETHPROXY_PORT'"|' "$BEACOND_CONFIG/config.toml"

sed $SED_OPT 's|^jwt-secret-path = ".*"|jwt-secret-path = "'$JWT_PATH'"|' "$BEACOND_CONFIG/app.toml"
sed $SED_OPT 's|^trusted-setup-path = ".*"|trusted-setup-path = "'$BEACOND_CONFIG/kzg-trusted-setup.json'"|' "$BEACOND_CONFIG/app.toml"
sed $SED_OPT 's|^suggested-fee-recipient = ".*"|suggested-fee-recipient = "'$WALLET_ADDRESS_FEE_RECIPIENT'"|' "$BEACOND_CONFIG/app.toml"
sed $SED_OPT 's|^prometheus_listen_addr = ".*"|prometheus_listen_addr = "':$CL_PROMETHEUS_PORT'"|' "$BEACOND_CONFIG/config.toml"

echo "✓ Config files in $BEACOND_CONFIG updated"

echo -n "Genesis validator root: "
$BEACOND_BIN genesis validator-root $BEACOND_CONFIG/genesis.json 
echo "✓ Beacon-Kit set up. Confirm genesis root is correct."
