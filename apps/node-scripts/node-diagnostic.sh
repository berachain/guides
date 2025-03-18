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
echo -e "${YELLOW}⏳ Running diagnostics... Please wait...${NC}"
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
BEACOND_VERSION=$($BEACOND_PATH version 2>/dev/null)
if [ $? -eq 0 ]; then
    echo -e "${GREEN}🔖 Beacond Version: ${NC}$BEACOND_VERSION"
else
    echo -e "${RED}❌ Could not determine beacond version.${NC}"
    echo -e "${YELLOW}⚠️  Is beacond installed? Use --path option to specify the correct path.${NC}"
fi

# Check number of peers
print_header "🔗 PEER CONNECTIONS"
PEERS_COUNT=$(curl -s http://localhost:26657/net_info | grep -o '"n_peers":"[^"]*"' | cut -d'"' -f4)
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

# Check pruning config in app.toml
print_header "🗑️  PRUNING CONFIGURATION"
if check_file_exists "$APP_TOML"; then
    echo -e "${BLUE}Pruning settings:${NC}"
    grep "^pruning = " "$APP_TOML" | sed 's/^/    /'
else
    echo -e "${RED}❌ Could not check pruning configuration.${NC}"
fi

# Check RPC timeout in app.toml
print_header "⏱️  RPC TIMEOUT CONFIGURATION"
if check_file_exists "$APP_TOML"; then
    RPC_TIMEOUT=$(grep "rpc-timeout" "$APP_TOML" | sed 's/.*= *//')
    if [ -n "$RPC_TIMEOUT" ]; then
        # Convert timeout to seconds, handling both s and ms units
        if [[ $RPC_TIMEOUT == *"ms"* ]]; then
            # Convert ms to seconds
            TIMEOUT_VALUE=$(echo "$RPC_TIMEOUT" | sed 's/ms$//' | awk '{print $1/1000}')
        else
            # Remove 's' suffix if present
            TIMEOUT_VALUE=$(echo "$RPC_TIMEOUT" | sed 's/s$//')
        fi
        
        if (( $(echo "$TIMEOUT_VALUE < 2" | bc -l) )); then
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
    echo -e "\n${BLUE}Additional P2P Settings:${NC}"
    echo -e "${BLUE}Network Settings:${NC}"
    grep -A 20 "^\[p2p\]" "$CONFIG_TOML" | while IFS= read -r line; do
        if [[ $line == \[* ]] && [[ $line != "[p2p]" ]]; then
            break
        fi
        if [[ $line != "[p2p]" ]] && [[ -n $line ]]; then
            echo "    $line"
        fi
    done
else
    echo -e "${RED}❌ Could not check peers configuration.${NC}"
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

# Display summary
print_header "📋 SUMMARY REPORT"
echo -e "${GREEN}✅ Node diagnostic completed!${NC}"
echo
echo -e "${YELLOW}⚙️  If you need more detailed diagnostics, consider:${NC}"
echo -e "   - Checking the node logs${NC}"

# Display current block height information
NODE_STATUS=$($BEACOND_PATH status 2>/dev/null)
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

echo -e "${CYAN}=================================================================${NC}"
echo -e "${CYAN}🛰️  DIAGNOSTIC COMPLETE 🛰️${NC}"
echo -e "${CYAN}=================================================================${NC}"

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
