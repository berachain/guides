#!/bin/bash
# Berabox Initialization Script - Fetches network parameters and initializes clients
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BERABOX_ROOT="$(dirname "$SCRIPT_DIR")"

# Source common functions and configuration
source "$SCRIPT_DIR/common.sh"

# Parse command line arguments
INSTALLATION_NAME=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --installation)
            INSTALLATION_NAME="$2"
            shift 2
            ;;
        -h|--help)
            echo "This script is called by the main bb command"
            exit 1
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate required arguments
if [[ -z "$INSTALLATION_NAME" ]]; then
    log_error "Installation name required"
    exit 1
fi

INSTALLATION_DIR="$BERABOX_ROOT/installations/$INSTALLATION_NAME"
INSTALLATION_TOML="$INSTALLATION_DIR/installation.toml"

# Check if installation exists
if [[ ! -f "$INSTALLATION_TOML" ]]; then
    log_error "Installation '$INSTALLATION_NAME' not found. Run 'create' first."
    exit 1
fi

# Load installation configuration
chain=$(bb_parse_toml_value "$INSTALLATION_TOML" "chain")
el_client=$(bb_parse_toml_value "$INSTALLATION_TOML" "el_client")

# Load beacon-kit version for network parameters
BEACON_KIT_VERSION=$(bb_parse_toml_value "$INSTALLATION_TOML" "beacon_kit")
if [[ -z "$BEACON_KIT_VERSION" ]]; then
    log_error "No beacon_kit version specified in installation.toml"
    exit 1
fi

log_info "Initializing installation: $INSTALLATION_NAME ($chain + $el_client)"

# Define network-specific parameters  
if [[ "$chain" == "mainnet" ]]; then
    CHAIN_ID="80094"
elif [[ "$chain" == "testnet" ]]; then
    CHAIN_ID="80069"
else
    log_error "Invalid chain: $chain"
    exit 1
fi

# Step 1: Load network parameters from local beacon-kit source
# Use per-installation beacon-kit source
BEACON_KIT_SRC="$INSTALLATION_DIR/src/beacon-kit"
NETWORK_FILES_DIR="$BEACON_KIT_SRC/testing/networks/$CHAIN_ID"

if [[ ! -d "$NETWORK_FILES_DIR" ]]; then
    log_error "Network files not found at $NETWORK_FILES_DIR"
    log_error "Run 'build' first or check beacon-kit version ($BEACON_KIT_VERSION)"
    exit 1
fi

# Verify essential files exist in source
ESSENTIAL_FILES=("genesis.json" "eth-genesis.json" "kzg-trusted-setup.json")
for file in "${ESSENTIAL_FILES[@]}"; do
    if [[ ! -f "$NETWORK_FILES_DIR/$file" ]]; then
        log_error "Essential file missing: $NETWORK_FILES_DIR/$file"
        exit 1
    fi
done

# Step 2: Initialize Consensus Client (beacond)

CL_CONFIG_DIR="$INSTALLATION_DIR/data/cl/config"
CL_DATA_DIR="$INSTALLATION_DIR/data/cl"

# Check if beacond binary exists
BEACOND_BIN="$INSTALLATION_DIR/src/beacon-kit/beacond-debug"
if [[ ! -f "$BEACOND_BIN" ]]; then
    log_error "beacond-debug binary not found. Run 'build' first."
    exit 1
fi

# Initialize beacond (overwrite existing files)
log_step "Initializing beacond..."
if ! BEACOND_OUTPUT=$("$BEACOND_BIN" init "$INSTALLATION_NAME-node" --beacon-kit.chain-spec "$chain" --home "$CL_DATA_DIR" --overwrite 2>&1); then
    log_error "❌ Beacond initialization failed:"
    echo "$BEACOND_OUTPUT"
    exit 1
fi

# Deploy custom validator key if specified
INSTALLATION_TOML="$INSTALLATION_DIR/installation.toml"
if [[ -f "$INSTALLATION_TOML" ]]; then
    # Parse CL key name from installation.toml
    VALIDATOR_KEY_NAME=$(awk '/^\[identity\]/{flag=1;next}/^\[/{flag=0}flag && /^cl_key_name/{gsub(/.*= *"?|"?.*$/,"");print}' "$INSTALLATION_TOML" 2>/dev/null || true)
    
    if [[ -n "$VALIDATOR_KEY_NAME" && "$VALIDATOR_KEY_NAME" != "" ]]; then
        VALIDATOR_KEY_FILE="$BERABOX_ROOT/keep/cl-keys/${VALIDATOR_KEY_NAME}.json"
        
        if [[ -f "$VALIDATOR_KEY_FILE" ]]; then
            # Backup the generated key (just in case)
            cp "$CL_CONFIG_DIR/priv_validator_key.json" "$CL_CONFIG_DIR/priv_validator_key.json.generated"
            
            # Deploy the custom validator key
            cp "$VALIDATOR_KEY_FILE" "$CL_CONFIG_DIR/priv_validator_key.json"
            log_info "🔑 VALIDATOR KEY DEPLOYED: $VALIDATOR_KEY_NAME"
        else
            log_error "❌ Validator key file not found: $VALIDATOR_KEY_FILE"
            log_error "Available CL keys in keep/cl-keys/:"
            ls -1 "$BERABOX_ROOT/keep/cl-keys/"*.json 2>/dev/null | basename -a -s .json | sed 's/^/  - /' || echo "  (none found)"
            exit 1
        fi
    fi
fi

# Deploy custom EL node key if specified
EL_KEY_NAME=$(awk '/^\[identity\]/{flag=1;next}/^\[/{flag=0}flag && /^el_key_name/{gsub(/.*= *"?|"?.*$/,"");print}' "$INSTALLATION_TOML" 2>/dev/null || true)

if [[ -n "$EL_KEY_NAME" && "$EL_KEY_NAME" != "" ]]; then
    EL_KEY_FILE="$BERABOX_ROOT/keep/el-keys/${EL_KEY_NAME}.nodekey"
    
    if [[ -f "$EL_KEY_FILE" ]]; then
        # Determine target location based on EL client
        if [[ "$EL_CLIENT" == "geth" ]]; then
            EL_KEY_TARGET="$INSTALLATION_DIR/data/el/chain/bera-geth/nodekey"
            EL_KEY_DIR="$INSTALLATION_DIR/data/el/chain/bera-geth"
        elif [[ "$EL_CLIENT" == "reth" ]]; then
            EL_KEY_TARGET="$INSTALLATION_DIR/data/el/chain/discovery-secret"
            EL_KEY_DIR="$INSTALLATION_DIR/data/el/chain"
        else
            log_error "❌ Unknown EL client type: $EL_CLIENT"
            exit 1
        fi
        
        # Ensure target directory exists
        bb_ensure_directory "$EL_KEY_DIR"
        
        # Backup generated key if it exists and deploy custom key
        if [[ -f "$EL_KEY_TARGET" ]]; then
            cp "$EL_KEY_TARGET" "$EL_KEY_TARGET.generated"
        fi
        cp "$EL_KEY_FILE" "$EL_KEY_TARGET"
        log_info "🔗 EL NODE KEY DEPLOYED: $EL_KEY_NAME"
    else
        log_error "❌ EL node key file not found: $EL_KEY_FILE"
        log_error "Available EL keys in keep/el-keys/:"
        ls -1 "$BERABOX_ROOT/keep/el-keys/"*.nodekey 2>/dev/null | basename -a -s .nodekey | sed 's/^/  - /' || echo "  (none found)"
        exit 1
    fi
fi

# Generate JWT secret (if not already done) 
JWT_PATH="$CL_CONFIG_DIR/jwt.hex"
if [[ ! -f "$JWT_PATH" ]]; then
    "$BEACOND_BIN" jwt generate --output-path "$JWT_PATH"
    echo ""
    log_info "✓ JWT secret generated at $JWT_PATH"
fi

# Place network parameters and configuration files
cp "$NETWORK_FILES_DIR/genesis.json" "$CL_CONFIG_DIR/"
cp "$NETWORK_FILES_DIR/kzg-trusted-setup.json" "$CL_CONFIG_DIR/"
if [[ -f "$NETWORK_FILES_DIR/config.toml" ]]; then
    cp "$NETWORK_FILES_DIR/config.toml" "$CL_CONFIG_DIR/"
fi
if [[ -f "$NETWORK_FILES_DIR/app.toml" ]]; then
    cp "$NETWORK_FILES_DIR/app.toml" "$CL_CONFIG_DIR/"
fi

# Copy bootnode and peer files for EL connectivity
if [[ -f "$NETWORK_FILES_DIR/el-bootnodes.txt" ]]; then
    cp "$NETWORK_FILES_DIR/el-bootnodes.txt" "$CL_CONFIG_DIR/"
fi
if [[ -f "$NETWORK_FILES_DIR/el-peers.txt" ]]; then
    cp "$NETWORK_FILES_DIR/el-peers.txt" "$CL_CONFIG_DIR/"
fi

# Update configuration files with correct ports and paths
source "$BERABOX_ROOT/scripts/port-utils.sh"
load_ports "$INSTALLATION_NAME"

# Update app.toml if it exists
if [[ -f "$CL_CONFIG_DIR/app.toml" ]]; then
    sed -i "s|^rpc-dial-url = \".*\"|rpc-dial-url = \"http://localhost:$EL_AUTHRPC_PORT\"|" "$CL_CONFIG_DIR/app.toml"
    sed -i "s|^jwt-secret-path = \".*\"|jwt-secret-path = \"$JWT_PATH\"|" "$CL_CONFIG_DIR/app.toml"
    sed -i "s|^trusted-setup-path = \".*\"|trusted-setup-path = \"$CL_CONFIG_DIR/kzg-trusted-setup.json\"|" "$CL_CONFIG_DIR/app.toml"
    # Ensure pruning is disabled for full archive
    if grep -q '^pruning\s*=\s*"' "$CL_CONFIG_DIR/app.toml"; then
        sed -i "s|^pruning\s*=\s*\".*\"|pruning = \"nothing\"|" "$CL_CONFIG_DIR/app.toml"
    else
        echo "pruning = \"nothing\"" >> "$CL_CONFIG_DIR/app.toml"
    fi
    # Ensure suggested-fee-recipient is set (align with guides setup-beacond)
    FEE_RECIPIENT_DEFAULT="0x9BcaA41DC32627776b1A4D714Eef627E640b3EF5"
    FEE_RECIPIENT_VALUE="${WALLET_ADDRESS_FEE_RECIPIENT:-$FEE_RECIPIENT_DEFAULT}"
    sed -i "s|^suggested-fee-recipient = \".*\"|suggested-fee-recipient = \"${FEE_RECIPIENT_VALUE}\"|" "$CL_CONFIG_DIR/app.toml"
fi

# Update config.toml if it exists  
if [[ -f "$CL_CONFIG_DIR/config.toml" ]]; then
    sed -i "s|^moniker = \".*\"|moniker = \"$INSTALLATION_NAME-node\"|" "$CL_CONFIG_DIR/config.toml"
    sed -i "s|^laddr = \".*26657\"|laddr = \"tcp://0.0.0.0:$CL_RPC_PORT\"|" "$CL_CONFIG_DIR/config.toml"
    sed -i "s|^laddr = \".*26656\"|laddr = \"tcp://0.0.0.0:$CL_P2P_PORT\"|" "$CL_CONFIG_DIR/config.toml"
    # Ensure external_address advertises the correct address (align with guides setup-beacond)
    EXTERNAL_IP=${MY_IP:-${EXTERNAL_IP:-$(bb_get_external_ip || echo "127.0.0.1")}}
    sed -i "s|^external_address = \".*\"|external_address = \"${EXTERNAL_IP}:$CL_P2P_PORT\"|" "$CL_CONFIG_DIR/config.toml"
    sed -i "s|^prometheus_listen_addr = \".*\"|prometheus_listen_addr = \"127.0.0.1:$CL_PROMETHEUS_PORT\"|" "$CL_CONFIG_DIR/config.toml"
    # Add PProf configuration if not present
    if ! grep -q "^pprof_laddr" "$CL_CONFIG_DIR/config.toml"; then
        echo "" >> "$CL_CONFIG_DIR/config.toml"
        echo "# Address to listen for PProf profiling connections" >> "$CL_CONFIG_DIR/config.toml"
        echo "pprof_laddr = \"127.0.0.1:$CL_PPROF_PORT\"" >> "$CL_CONFIG_DIR/config.toml"
    else
        sed -i "s|^pprof_laddr = \".*\"|pprof_laddr = \"127.0.0.1:$CL_PPROF_PORT\"|" "$CL_CONFIG_DIR/config.toml"
    fi
fi

# Optional: display genesis validator root for operator confirmation (as in guides)
if [[ -f "$CL_CONFIG_DIR/genesis.json" ]]; then
    echo -n "Genesis validator root: "
    "$BEACOND_BIN" genesis validator-root "$CL_CONFIG_DIR/genesis.json" || true
fi

# Step 3: Initialize Execution Client
log_step "Initializing execution client ($el_client)..."

EL_DATA_DIR="$INSTALLATION_DIR/data/el"
source "$BERABOX_ROOT/scripts/arg-builder.sh"
EL_CLIENT_BIN="$(get_el_binary_path "$el_client" "$INSTALLATION_DIR")"

# Check if EL binary exists
if [[ ! -f "$EL_CLIENT_BIN" ]]; then
    log_error "${el_client} binary not found at $EL_CLIENT_BIN. Run 'build' first."
    exit 1
fi

# Copy genesis file to EL config
cp "$NETWORK_FILES_DIR/eth-genesis.json" "$EL_DATA_DIR/config/genesis.json"

# Initialize execution client with genesis
case "$el_client" in
    "reth")
        if [[ ! -f "$EL_DATA_DIR/chain/db/mdbx.dat" ]]; then
            cd "$EL_DATA_DIR"
            temp_file=$(mktemp)
            if "$EL_CLIENT_BIN" init --datadir ./chain/ --chain ./config/genesis.json >"$temp_file" 2>&1; then
                log_info "✓ Reth initialized, database at $EL_DATA_DIR/chain/db/"
                if [[ "${BB_DEBUG:-false}" == "true" ]]; then
                    cat "$temp_file"
                fi
            else
                log_error "Failed to initialize Reth:"
                cat "$temp_file" >&2
            fi
            rm -f "$temp_file"
            cd - > /dev/null
        fi
        ;;
    "geth")
        if [[ ! -d "$EL_DATA_DIR/chain/bera-geth" ]]; then
            temp_file=$(mktemp)
            if "$EL_CLIENT_BIN" init --datadir "$EL_DATA_DIR/chain" "$EL_DATA_DIR/config/genesis.json" >"$temp_file" 2>&1; then
                log_info "✓ Geth initialized, database at $EL_DATA_DIR/chain/bera-geth/"
                if [[ "${BB_DEBUG:-false}" == "true" ]]; then
                    cat "$temp_file"
                fi
            else
                log_error "Failed to initialize Geth:"
                cat "$temp_file" >&2
            fi
            rm -f "$temp_file"
        fi
        ;;
esac

# Step 4: Setup network connectivity files
PEER_COUNT=0
if [[ -f "$NETWORK_FILES_DIR/el-bootnodes.txt" ]]; then
    PEER_COUNT=$((PEER_COUNT + $(wc -l < "$NETWORK_FILES_DIR/el-bootnodes.txt")))
fi
if [[ -f "$NETWORK_FILES_DIR/el-peers.txt" ]]; then
    PEER_COUNT=$((PEER_COUNT + $(wc -l < "$NETWORK_FILES_DIR/el-peers.txt")))
fi
if [[ $PEER_COUNT -gt 0 ]]; then
    log_info "✓ $PEER_COUNT network peers configured from $NETWORK_FILES_DIR/"
fi

        log_info "✓ Installation '$INSTALLATION_NAME' initialized"
