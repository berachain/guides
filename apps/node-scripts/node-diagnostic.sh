#!/bin/bash

# Beacond Node Diagnostic Script
# This script checks the status and configuration of a Beacond node

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default paths - these can be overridden with command-line options
BEACOND_PATH="beacond"
BEACOND_HOME="$HOME/.beacond"
CONFIG_DIR="$BEACOND_HOME/config"
CHECK_DISK_IO=false

print_help() {
    echo -e "${CYAN}=================================================================${NC}"
    echo -e "${CYAN}🛰️  BEACOND NODE DIAGNOSTIC TOOL - HELP 🛰️${NC}"
    echo -e "${CYAN}=================================================================${NC}"
    echo -e "Usage: $0 [OPTIONS]"
    echo -e "\nOptions:"
    echo -e "  -h, --help                Show this help message"
    echo -e "  -p, --path PATH           Path to beacond executable (default: 'beacond')"
    echo -e "  -d, --home DIR            Beacond home directory (default: '$HOME/.beacond')"
    echo -e "  -i, --disk-io             Enable disk I/O checks (default: disabled)"
    echo -e "\nExample:"
    echo -e "  $0 --path /usr/local/bin/beacond --home /data/beacond --disk-io"
    echo -e "${CYAN}=================================================================${NC}"
    exit 0
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            print_help
            ;;
        -p|--path)
            BEACOND_PATH="$2"
            shift 2
            ;;
        -d|--home)
            BEACOND_HOME="$2"
            CONFIG_DIR="$BEACOND_HOME/config"
            shift 2
            ;;
        -i|--disk-io)
            CHECK_DISK_IO=true
            shift
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            print_help
            ;;
    esac
done

print_header() {
    echo -e "\n${PURPLE}🔍 $1 ${NC}"
    echo -e "${PURPLE}=================================================${NC}"
}

check_file_exists() {
    if [ ! -f "$1" ]; then
        echo -e "${RED}❌ Error: $1 not found!${NC}"
        return 1
    fi
    return 0
}

# Update configuration paths
CONFIG_TOML="$CONFIG_DIR/config.toml"
APP_TOML="$CONFIG_DIR/app.toml"

# Script header
echo -e "${CYAN}=================================================================${NC}"
echo -e "${CYAN}🛰️  BEACOND NODE DIAGNOSTIC TOOL 🛰️${NC}"
echo -e "${CYAN}=================================================================${NC}"
echo -e "${BLUE}Using beacond path: ${NC}$BEACOND_PATH"
echo -e "${BLUE}Using beacond home: ${NC}$BEACOND_HOME\n"

# Check if required files exist
if ! check_file_exists "$CONFIG_TOML"; then
    echo -e "${RED}❌ Cannot locate config files at $CONFIG_DIR.${NC}"
    echo -e "${YELLOW}⚠️  Use --home option to specify the correct home directory.${NC}"
    exit 1
fi

# Get node version
print_header "📊 NODE VERSION"
BEACOND_VERSION=$($BEACOND_PATH --home $BEACOND_HOME version 2>/dev/null)
if [ $? -eq 0 ]; then
    echo -e "${GREEN}🔖 Beacond Version: ${NC}$BEACOND_VERSION"
else
    echo -e "${RED}❌ Could not determine beacond version.${NC}"
    echo -e "${YELLOW}⚠️  Is beacond installed? Use --path option to specify the correct path.${NC}"
fi


# Check pruning config in app.toml
print_header "🗑️  PRUNING CONFIGURATION"
if check_file_exists "$APP_TOML"; then
    echo -e "${BLUE}Pruning settings:${NC}"
    PRUNING_MODE=$(grep "^pruning = " "$APP_TOML" | sed 's/.*= *//' | tr -d '"')

    if [ "$PRUNING_MODE" = "nothing" ]; then
        echo -e "${RED}⚠️  WARNING: Pruning is set to 'nothing'. This will cause your disk usage to grow excessively!${NC}"
        echo -e "${YELLOW}   Consider changing to 'default' or 'everything' pruning mode.${NC}"
    else
        echo -e "${GREEN}✅ Pruning mode: ${NC}$PRUNING_MODE"
    fi

else
    echo -e "${RED}❌ Could not check pruning configuration.${NC}"
fi

# Check RPC timeout in app.toml
print_header "⏱️  RPC TIMEOUT CONFIGURATION"
if check_file_exists "$APP_TOML"; then
    RPC_TIMEOUT=$(grep "rpc-timeout" "$APP_TOML" | sed 's/.*= *//')
    if [ -n "$RPC_TIMEOUT" ]; then
        # Strip quotes from RPC timeout value
        RPC_TIMEOUT=$(echo "$RPC_TIMEOUT" | tr -d '"')
        # Convert timeout to seconds, handling both s and ms units
        if [[ $RPC_TIMEOUT == *"ms"* ]]; then
            # Convert ms to seconds
            TIMEOUT_VALUE=$(echo "$RPC_TIMEOUT" | sed 's/ms$//' | awk '{print $1/1000}')
        else
            # Remove 's' suffix if present
            TIMEOUT_VALUE=$(echo "$RPC_TIMEOUT" | sed 's/s$//')
        fi
        
        if [ "$TIMEOUT_VALUE" -lt 2 ]; then
            echo -e "${RED}❌ RPC timeout value too low: ${NC}$RPC_TIMEOUT (should be at least 2s)"
        else
            echo -e "${GREEN}✅ RPC timeout value: ${NC}$RPC_TIMEOUT"
        fi
    else
        echo -e "${YELLOW}⚠️  RPC timeout not found in app.toml${NC}"
    fi
else
    echo -e "${RED}❌ Could not check RPC timeout configuration.${NC}"
fi

# Check peers config in config.toml
print_header "👥 PEERS CONFIGURATION"
if check_file_exists "$CONFIG_TOML"; then
    # Check PEX
    PEX_ENABLED=$(grep "pex =" "$CONFIG_TOML" | sed 's/.*= *//')
    if [ "$PEX_ENABLED" = "true" ]; then
        echo -e "${GREEN}✅ PEX (Peer Exchange): ${NC}Enabled"
    else
        echo -e "${YELLOW}⚠️  PEX (Peer Exchange): ${NC}Disabled"
    fi
    
    # Check seeds and persistent peers
    SEEDS=$(grep "^seeds =" "$CONFIG_TOML" | sed 's/.*= *//' | tr -d '"')
    PERSISTENT_PEERS=$(grep "^persistent_peers =" "$CONFIG_TOML" | sed 's/.*= *//' | tr -d '"')
    
    if [ -n "$SEEDS" ] && [ "$SEEDS" != "" ]; then
        SEED_COUNT=$(echo "$SEEDS" | tr ',' '\n' | wc -l)
        echo -e "${GREEN}✅ Seeds: ${NC}Using $SEED_COUNT seed nodes"
    else
        echo -e "${YELLOW}⚠️  Seeds: ${NC}None configured"
    fi
    
    if [ -n "$PERSISTENT_PEERS" ] && [ "$PERSISTENT_PEERS" != "" ]; then
        PERSISTENT_COUNT=$(echo "$PERSISTENT_PEERS" | tr ',' '\n' | wc -l)
        echo -e "${GREEN}✅ Persistent peers: ${NC}Using $PERSISTENT_COUNT persistent peers"
    else
        echo -e "${YELLOW}⚠️  Persistent peers: ${NC}None configured"
    fi
    
    # Show additional P2P settings
    echo -e "\n${BLUE}Additional [p2p] Settings:${NC}"
    
    # Initialize variables
    INBOUND_PEERS=0
    OUTBOUND_PEERS=0
    
    # Read p2p settings directly from config file
    INBOUND_PEERS=$(grep "^max_num_inbound_peers" "$CONFIG_TOML" | sed 's/.*= *//' | tr -d '[:space:]')
    OUTBOUND_PEERS=$(grep "^max_num_outbound_peers" "$CONFIG_TOML" | sed 's/.*= *//' | tr -d '[:space:]')
    
    # Display the settings
    if [ -n "$INBOUND_PEERS" ]; then
        echo -e "    max_num_inbound_peers = $INBOUND_PEERS"
        fi
    if [ -n "$OUTBOUND_PEERS" ]; then
        echo -e "    max_num_outbound_peers = $OUTBOUND_PEERS"
    fi

    # Convert peer values to integers to ensure proper comparison
    INBOUND_PEERS=$((INBOUND_PEERS + 0))
    OUTBOUND_PEERS=$((OUTBOUND_PEERS + 0))
    TOTAL_PEERS=$((INBOUND_PEERS + OUTBOUND_PEERS))

    if [[ $TOTAL_PEERS -gt 100 ]]; then
        echo -e "    ${RED}❌ Total peer connections ($TOTAL_PEERS) exceeds maximum of 100${NC}"
        echo -e "    ${YELLOW}   Recommended: max_num_inbound_peers = 40, max_num_outbound_peers = 10${NC}"
    elif [[ $INBOUND_PEERS -gt 40 ]] || [[ $OUTBOUND_PEERS -gt 80 ]]; then
        echo -e "    ${YELLOW}⚠️  Peer connection limits need adjustment${NC}"
        if [[ $INBOUND_PEERS -gt 40 ]]; then
            echo -e "    ${YELLOW}   Inbound peers ($INBOUND_PEERS) exceeds recommended maximum of 40${NC}"
        fi
        if [[ $OUTBOUND_PEERS -gt 80 ]]; then
            echo -e "    ${YELLOW}   Outbound peers ($OUTBOUND_PEERS) exceeds recommended maximum of 80${NC}"
        fi
        echo -e "    ${YELLOW}   Recommended: max_num_inbound_peers = 40, max_num_outbound_peers = 10${NC}"
    elif [[ $TOTAL_PEERS -lt 50 ]]; then
        echo -e "    ${GREEN}✅ Total peer connections ($TOTAL_PEERS) within recommended range (under 50)${NC}"
        echo -e "    ${YELLOW}   Recommended: max_num_inbound_peers = 40, max_num_outbound_peers = 10${NC}"
    else
        echo -e "    ${YELLOW}⚠️  Total peer connections ($TOTAL_PEERS) above recommended range (50)${NC}"
        echo -e "    ${YELLOW}   Recommended: max_num_inbound_peers = 40, max_num_outbound_peers = 10${NC}"
        fi
else
    echo -e "${RED}❌ Could not check peers configuration.${NC}"
fi

# Check network settings
print_header "🌐 NETWORK SETTINGS"

# Check if external_address is set
EXTERNAL_ADDRESS=$(grep "^external_address" "$CONFIG_TOML" | sed 's/.*= *//' | tr -d '"')
if [ -n "$EXTERNAL_ADDRESS" ]; then
    echo -e "${GREEN}✅ External address: ${NC}$EXTERNAL_ADDRESS"
else
    echo -e "${YELLOW}⚠️  External address: ${NC}Not configured"
    echo -e "${YELLOW}   Consider setting external_address in config.toml for better connectivity${NC}"
fi

# Check addr_book_strict setting
ADDR_BOOK_STRICT=$(grep "^addr_book_strict" "$CONFIG_TOML" | sed 's/.*= *//' | tr -d '[:space:]')
if [ "$ADDR_BOOK_STRICT" = "false" ]; then
    echo -e "${YELLOW}⚠️  addr_book_strict: ${NC}$ADDR_BOOK_STRICT (allows non-routable IPs)"
else
    echo -e "${GREEN}✅ addr_book_strict: ${NC}$ADDR_BOOK_STRICT"
fi

# Check unconditional_peer_ids
UNCONDITIONAL_PEER_IDS=$(grep "^unconditional_peer_ids" "$CONFIG_TOML" | sed 's/.*= *//' | tr -d '"')
if [ -n "$UNCONDITIONAL_PEER_IDS" ] && [ "$UNCONDITIONAL_PEER_IDS" != "\"\"" ]; then
    UNCONDITIONAL_COUNT=$(echo "$UNCONDITIONAL_PEER_IDS" | tr ',' '\n' | wc -l)
    echo -e "${GREEN}✅ Unconditional peer IDs: ${NC}$UNCONDITIONAL_COUNT configured"
else
    echo -e "${BLUE}ℹ️  Unconditional peer IDs: ${NC}None configured"
fi

# Check seed mode
SEED_MODE=$(grep "^seed_mode" "$CONFIG_TOML" | sed 's/.*= *//' | tr -d '[:space:]')
if [ "$SEED_MODE" = "true" ]; then
    echo -e "${BLUE}ℹ️  Seed mode: ${NC}Enabled (node is operating as a seed node)"
else
    echo -e "${BLUE}ℹ️  Seed mode: ${NC}Disabled"
fi

# Check pex setting
PEX=$(grep "^pex" "$CONFIG_TOML" | sed 's/.*= *//' | tr -d '[:space:]')
if [ "$PEX" = "false" ]; then
    echo -e "${YELLOW}⚠️  PEX (Peer Exchange): ${NC}Disabled (limits peer discovery)"
else
    echo -e "${GREEN}✅ PEX (Peer Exchange): ${NC}Enabled"
fi

RPC_URL=$(grep "^laddr =" "$CONFIG_TOML" | head -n1 | sed 's/.*= *//' | tr -d '"')
RPC_URL=$(echo "$RPC_URL" | sed 's|^tcp://|http://|')
if ! echo "$RPC_URL" | grep -q "127.0.0.1\|localhost"; then
    echo -e "${YELLOW}⚠️  Warning: RPC endpoint ($RPC_URL) is not using 127.0.0.1 or localhost.${NC}"
    echo -e "${YELLOW}   This may expose your RPC to external connections.${NC}"
fi


# Check number of peers
print_header "🔗 PEER CONNECTIONS"
PEERS_COUNT=$(curl -s $RPC_URL/net_info | grep -o '"n_peers":"[^"]*"' | cut -d'"' -f4)
if [ -n "$PEERS_COUNT" ]; then
    if [ "$PEERS_COUNT" -eq 0 ]; then
        echo -e "${RED}⚠️  Number of peers: $PEERS_COUNT (Node is isolated!)${NC}"
    elif [ "$PEERS_COUNT" -lt 3 ]; then
        echo -e "${YELLOW}⚠️  Number of peers: $PEERS_COUNT (Low peer count)${NC}"
    else
        echo -e "${GREEN}✅ Number of peers: $PEERS_COUNT${NC}"
    fi
else
    echo -e "${RED}❌ Could not get peer information. Is the node running?${NC}"
fi


# Check disk usage
print_header "💾 DISK USAGE"
DATA_DIR=$(grep "^db_dir" "$APP_TOML" 2>/dev/null | sed 's/.*= *//' | tr -d '"')
if [ -z "$DATA_DIR" ]; then
    DATA_DIR="$BEACOND_HOME/data"
fi

if [ -d "$DATA_DIR" ]; then
    echo -e "${BLUE}Data directory: ${NC}$DATA_DIR"
    echo -e "${BLUE}Data directory size: ${NC}$(du -sh "$DATA_DIR" | cut -f1)"
    
    # Get filesystem usage for the partition containing the data directory
    FS_USAGE=$(df -h "$DATA_DIR" | tail -n 1)
    FS_SIZE=$(echo "$FS_USAGE" | awk '{print $2}')
    FS_USED=$(echo "$FS_USAGE" | awk '{print $3}')
    FS_AVAIL=$(echo "$FS_USAGE" | awk '{print $4}')
    FS_USED_PCT=$(echo "$FS_USAGE" | awk '{print $5}')
    
    echo -e "${BLUE}Filesystem total: ${NC}$FS_SIZE"
    echo -e "${BLUE}Filesystem used: ${NC}$FS_USED ($FS_USED_PCT)"
    echo -e "${BLUE}Filesystem available: ${NC}$FS_AVAIL"
    
    # Alert if disk space is low
    PCT_NUM=$(echo "$FS_USED_PCT" | tr -d '%')
    if [ "$PCT_NUM" -gt 90 ]; then
        echo -e "${RED}⚠️  CRITICAL: Disk usage is very high! ${NC}"
    elif [ "$PCT_NUM" -gt 80 ]; then
        echo -e "${YELLOW}⚠️  WARNING: Disk usage is high ${NC}"
    fi
else
    echo -e "${RED}❌ Data directory not found or not accessible.${NC}"
fi

# Check disk IO (if enabled and iostat is available)
if [ "$CHECK_DISK_IO" = true ]; then
    print_header "📝 DISK I/O STATS"
    if command -v iostat &> /dev/null; then
        echo -e "${BLUE}Current disk I/O:${NC}"
        iostat -d -x 1 2 | tail -n +4 | head -n -1 | sed 's/^/    /'
    else
        echo -e "${YELLOW}⚠️  iostat not available. Install sysstat package to check disk I/O.${NC}"
    fi
fi

# Check pprof configuration in config.toml
print_header "🔍 PPROF CONFIGURATION"
if check_file_exists "$CONFIG_TOML"; then
    PPROF_LADDR=$(grep "^pprof_laddr = " "$CONFIG_TOML" | sed 's/.*= *//' | tr -d '"')
    if [ -z "$PPROF_LADDR" ] || [ "$PPROF_LADDR" = "" ]; then
        echo -e "${GREEN}✅ pprof is properly disabled${NC}"
    else
        echo -e "${RED}❌ pprof is enabled: ${NC}$PPROF_LADDR (should be empty for security)"
    fi
else
    echo -e "${RED}❌ Could not check pprof configuration.${NC}"
fi


# Display current block height information
print_header "🔍 CURRENT BLOCK INFORMATION"
NODE_STATUS=$(curl -s $RPC_URL/status | jq .result)
if [ $? -eq 0 ]; then
    LATEST_BLOCK_HEIGHT=$(echo "$NODE_STATUS" | grep latest_block_height | sed 's/.*: *//' | tr -d '",')
    CATCHING_UP=$(echo "$NODE_STATUS" | grep catching_up | sed 's/.*: *//' | tr -d '",')
    
    echo -e "\n${GREEN}📊 Current Block Information:${NC}"
    echo -e "   - Latest Block Height: ${BLUE}$LATEST_BLOCK_HEIGHT${NC}"
    if [ "$CATCHING_UP" = "true" ]; then
        echo -e "   - Sync Status: ${YELLOW}Catching up${NC}"
    else
        echo -e "   - Sync Status: ${GREEN}Synced${NC}"
    fi
else
    echo -e "\n${YELLOW}⚠️  Could not get current block information${NC}"
fi
echo

print_header "💻 SYSTEM RESOURCES"
# Check Memory Usage
echo -e "${BLUE}Memory Usage:${NC}"
if command -v free &> /dev/null; then
    free -h | grep "Mem:" | awk '{printf "    Total: %s, Used: %s, Free: %s\n", $2, $3, $4}'
    # Calculate memory usage percentage
    MEM_USED_PCT=$(free | grep Mem | awk '{printf "%.1f", $3/$2 * 100}')
    if [ $(echo "$MEM_USED_PCT > 90" | bc -l) -eq 1 ]; then
        echo -e "    ${RED}⚠️  CRITICAL: Memory usage at ${MEM_USED_PCT}%${NC}"
    elif [ $(echo "$MEM_USED_PCT > 80" | bc -l) -eq 1 ]; then
        echo -e "    ${YELLOW}⚠️  WARNING: Memory usage at ${MEM_USED_PCT}%${NC}"
    else
        echo -e "    ${GREEN}✅ Memory usage at ${MEM_USED_PCT}%${NC}"
    fi
else
    echo -e "${RED}❌ Could not check memory usage (free command not available)${NC}"
fi

# Check CPU Usage
echo -e "\n${BLUE}CPU Usage:${NC}"
if command -v top &> /dev/null; then
    CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}')
    echo -e "    CPU Usage: ${CPU_USAGE}%"
    if [ $(echo "$CPU_USAGE > 90" | bc -l) -eq 1 ]; then
        echo -e "    ${RED}⚠️  CRITICAL: CPU usage is very high!${NC}"
    elif [ $(echo "$CPU_USAGE > 80" | bc -l) -eq 1 ]; then
        echo -e "    ${YELLOW}⚠️  WARNING: CPU usage is high${NC}"
    fi
else
    echo -e "${RED}❌ Could not check CPU usage (top command not available)${NC}"
fi
