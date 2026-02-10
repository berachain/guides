#!/bin/bash
# Berabox Installation Script - Creates a new installation with isolated environment
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BERABOX_ROOT="$(dirname "$SCRIPT_DIR")"

# Source common functions and configuration
source "$SCRIPT_DIR/common.sh"

# Function to clone source repositories for this installation
clone_source_repositories() {
    local installation_dir="$1"
    local el_client="$2"
    local src_dir="$installation_dir/src"
    
    # Clone beacon-kit
    if [[ ! -d "$src_dir/beacon-kit" ]]; then
        log_info "Cloning beacon-kit..."
        git clone --depth 1 https://github.com/berachain/beacon-kit.git "$src_dir/beacon-kit"
    else
        log_info "beacon-kit already exists, skipping clone"
    fi
    
    # Clone execution client based on EL_CLIENT
    local el_repo=""
    case "$el_client" in
        "reth")
            el_repo="bera-reth"
            ;;
        "geth")
            el_repo="bera-geth"
            ;;
        *)
            log_error "Unknown EL client: $el_client"
            exit 1
            ;;
    esac
    
    if [[ ! -d "$src_dir/$el_repo" ]]; then
        log_info "Cloning $el_repo..."
        git clone --depth 1 "https://github.com/berachain/$el_repo.git" "$src_dir/$el_repo"
    else
        log_info "$el_repo already exists, skipping clone"
    fi
    
    log_info "✓ Source repositories cloned to $src_dir/"
}

# Source port utilities for conflict checking
source "$SCRIPT_DIR/port-utils.sh"

# Parse command line arguments
INSTALLATION_NAME=""
CHAIN=""
EL_CLIENT=""
PORT_BASE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --name)
            INSTALLATION_NAME="$2"
            shift 2
            ;;
        --chain)
            CHAIN="$2"
            shift 2
            ;;
        --el-client)
            EL_CLIENT="$2"
            shift 2
            ;;
        --port-base)
            PORT_BASE="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            ;;
    esac
done

# Validate required arguments
if [[ -z "$CHAIN" || -z "$EL_CLIENT" ]]; then
    log_error "Missing required arguments"
    usage
fi

# Validate chain
if [[ "$CHAIN" != "mainnet" && "$CHAIN" != "testnet" ]]; then
    log_error "Invalid chain: $CHAIN. Must be 'mainnet' or 'testnet'"
    exit 1
fi

# Validate EL client
if [[ "$EL_CLIENT" != "reth" && "$EL_CLIENT" != "geth" ]]; then
    log_error "Invalid EL client: $EL_CLIENT. Must be 'reth' or 'geth'"
    exit 1
fi

# Set installation name if not provided (always user-prefixed)
if [[ -z "$INSTALLATION_NAME" ]]; then
    INSTALLATION_NAME="$USER-$CHAIN-$EL_CLIENT"
else
    # Always prefix with username for isolation
    INSTALLATION_NAME="$USER-$INSTALLATION_NAME"
fi

INSTALLATION_DIR="$BERABOX_ROOT/installations/$INSTALLATION_NAME"

# Check if installation already exists
if [[ -d "$INSTALLATION_DIR" ]]; then
    log_error "Installation '$INSTALLATION_NAME' already exists at $INSTALLATION_DIR"
    exit 1
fi

# Load simple port utilities
source "$SCRIPT_DIR/port-utils.sh"

log_info "Creating installation: $INSTALLATION_NAME ($CHAIN + $EL_CLIENT)"
log_info "Directory: $INSTALLATION_DIR"

# Set default port base if not specified
if [[ -z "$PORT_BASE" ]]; then
    PORT_BASE=30000
    log_info "Using default port base: $PORT_BASE (specify --port to override)"
fi

# Find available port base with automatic conflict avoidance
AVAILABLE_PORT_BASE=$(find_available_port_base "$PORT_BASE")
if [[ $? -ne 0 ]]; then
    log_error "Failed to find available port range starting from $PORT_BASE"
    log_error "Try a different --port-base value or stop conflicting services"
    exit 1
fi

# Use the available port base
PORT_BASE="$AVAILABLE_PORT_BASE"
calculate_ports_from_base "$PORT_BASE"

log_info "Using port base: $PORT_BASE (range: $PORT_BASE-$((PORT_BASE + 19)))"

log_step "Creating directory structure at $INSTALLATION_DIR..."
# Create main directories
bb_ensure_directory "$INSTALLATION_DIR/src"
bb_ensure_directory "$INSTALLATION_DIR/systemd"

# Create data directories
bb_ensure_directory "$INSTALLATION_DIR/data/cl/config"
bb_ensure_directory "$INSTALLATION_DIR/data/cl/chain"
bb_ensure_directory "$INSTALLATION_DIR/data/el/config"
bb_ensure_directory "$INSTALLATION_DIR/data/el/chain"

# Create log directories
bb_ensure_directory "$INSTALLATION_DIR/logs/cl"
bb_ensure_directory "$INSTALLATION_DIR/logs/el"

# Create runtime directory for IPC sockets
bb_ensure_directory "$INSTALLATION_DIR/runtime"

chown -R $(id -u):$(id -g) "$INSTALLATION_DIR"

log_step "Setting up CL data at $INSTALLATION_DIR/data/cl and EL data at $INSTALLATION_DIR/data/el..."
# CL and EL directories already created above

# Configuration files will be generated during 'bb init' from local network sources

log_step "Cloning source repositories for $INSTALLATION_NAME..."
clone_source_repositories "$INSTALLATION_DIR" "$EL_CLIENT"

log_step "Creating installation metadata file at $INSTALLATION_DIR/installation.toml..."
cat > "$INSTALLATION_DIR/installation.toml" << EOF
[installation]
name = "$INSTALLATION_NAME"
chain = "$CHAIN"
el_client = "$EL_CLIENT"
created = "$(date -Iseconds)"

[ports]
base_port = $PORT_BASE
# Consensus Layer ports
cl_rpc_port = $CL_RPC_PORT
cl_p2p_port = $CL_P2P_PORT
cl_prometheus_port = $CL_PROMETHEUS_PORT
cl_pprof_port = $CL_PPROF_PORT
node_api_port = $NODE_API_PORT
# Execution Layer ports
el_rpc_port = $EL_RPC_PORT
el_ws_port = $EL_WS_PORT
el_authrpc_port = $EL_AUTHRPC_PORT
el_p2p_port = $EL_P2P_PORT
el_prometheus_port = $EL_PROMETHEUS_PORT

[paths]
installation_dir = "$INSTALLATION_DIR"
src_dir = "$INSTALLATION_DIR/src"
cl_data_dir = "$INSTALLATION_DIR/data/cl"
el_data_dir = "$INSTALLATION_DIR/data/el"
cl_config_dir = "$INSTALLATION_DIR/data/cl/config"
el_config_dir = "$INSTALLATION_DIR/data/el/config"
cl_logs_dir = "$INSTALLATION_DIR/logs/cl"
el_logs_dir = "$INSTALLATION_DIR/logs/el"

[versions]
beacon_kit = "main"
bera_$EL_CLIENT = "main"

[repositories]
cl_repo = "https://github.com/berachain/beacon-kit.git"
el_repo = "https://github.com/berachain/bera-$EL_CLIENT.git"

[options]
# Archive mode: true = keep all historical data, false = prune old data
archive_mode = false

[validator]
# Optional: Specify a pre-generated validator key to use for this installation
# Available keys: testnet-validator1, testnet-validator2 (see validator-keys/ directory)
# Leave blank to use the randomly generated key from 'beacond init'
key_name = ""

[upnp]
# UPnP automatic port forwarding for P2P ports (improves network connectivity)
# Only opens P2P ports (cl_p2p_port, el_p2p_port), never RPC or admin ports
# Requires router/gateway with UPnP support
enabled = false
# Lease time in seconds (86400 = 24 hours, 0 = permanent)
lease_time = 86400
EOF

log_step "Creating helper script at $INSTALLATION_DIR/manage.sh..."
# Create a convenience script for this installation
cat > "$INSTALLATION_DIR/manage.sh" << EOF
#!/bin/bash
# Convenience script for managing $INSTALLATION_NAME installation
INSTALLATION_NAME="$INSTALLATION_NAME"
BERABOX_ROOT="$BERABOX_ROOT"

case "\$1" in
    "build")
        "$BERABOX_ROOT/scripts/build.sh" --installation "$INSTALLATION_NAME" --components beacon-kit,bera-$EL_CLIENT
        ;;
    "install")
        "$BERABOX_ROOT/scripts/systemd-manage.sh" install "$INSTALLATION_NAME"
        ;;
    "uninstall")
        "$BERABOX_ROOT/scripts/systemd-manage.sh" uninstall "$INSTALLATION_NAME"
        ;;
    "start")
        "$BERABOX_ROOT/scripts/systemd-manage.sh" start "$INSTALLATION_NAME" \$2
        ;;
    "stop")
        "$BERABOX_ROOT/scripts/systemd-manage.sh" stop "$INSTALLATION_NAME" \$2
        ;;
    "restart")
        "$BERABOX_ROOT/scripts/systemd-manage.sh" restart "$INSTALLATION_NAME" \$2
        ;;
    "status")
        "$BERABOX_ROOT/scripts/systemd-manage.sh" status "$INSTALLATION_NAME" \$2
        ;;
    "logs")
        "$BERABOX_ROOT/scripts/systemd-manage.sh" logs "$INSTALLATION_NAME" \$2
        ;;
    "list")
        "$BERABOX_ROOT/scripts/systemd-manage.sh" list
        ;;
    *)
        echo "Usage: \$0 {build|install|uninstall|start|stop|restart|status|logs|list} [cl|el]"
        exit 1
        ;;
esac
EOF

chmod +x "$INSTALLATION_DIR/manage.sh"

        log_result "✓ Installation '$INSTALLATION_NAME' created"
