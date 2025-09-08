#!/bin/bash

# Script to update the local-docker-devnet genesis file from beacon-kit
# This script:
# 1. Checks out the current beacon-kit source
# 2. Grabs testing/networks/80069/eth-genesis.json
# 3. Replaces the chain ID with <CHAIN_ID>
# 4. Adds a funded account: 0x20f33ce90a13a4b5e7697e3544c3083b8f8a51d4 with balance 0x123450000000000000000
# 5. Replaces the top level "timestamp" value with 0

set -e

# Configuration
BEACON_KIT_REPO="https://github.com/berachain/beacon-kit.git"
BEACON_KIT_DIR="/tmp/beacon-kit-temp"
SOURCE_GENESIS_PATH="testing/networks/80069/eth-genesis.json"
TARGET_GENESIS_PATH="eth-genesis.json"
FUNDED_ACCOUNT="0x20f33ce90a13a4b5e7697e3544c3083b8f8a51d4"
FUNDED_BALANCE="0x123450000000000000000"

# Predeploy contract to inject into alloc
CUSTOM_CONTRACT_ADDRESS="0x00000961Ef480Eb55e80D19ad83579A64c007002"
CUSTOM_CONTRACT_CODE="0x3373fffffffffffffffffffffffffffffffffffffffe1460cb5760115f54807fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff146101f457600182026001905f5b5f82111560685781019083028483029004916001019190604d565b909390049250505036603814608857366101f457346101f4575f5260205ff35b34106101f457600154600101600155600354806003026004013381556001015f35815560010160203590553360601b5f5260385f601437604c5fa0600101600355005b6003546002548082038060101160df575060105b5f5b8181146101835782810160030260040181604c02815460601b8152601401816001015481526020019060020154807fffffffffffffffffffffffffffffffff00000000000000000000000000000000168252906010019060401c908160381c81600701538160301c81600601538160281c81600501538160201c81600401538160181c81600301538160101c81600201538160081c81600101535360010160e1565b910180921461019557906002556101a0565b90505f6002555f6003555b5f54807fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff14156101cd57505f5b6001546002828201116101e25750505f6101e8565b01600290035b5f555f600155604c025ff35b5f5ffd"
CUSTOM_CONTRACT_NONCE="0x1"
CUSTOM_CONTRACT_BALANCE="0x0"
CUSTOM_CONTRACT_STORAGE_KEY="0x0000000000000000000000000000000000000000000000000000000000000000"
CUSTOM_CONTRACT_STORAGE_VALUE="0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🔄 Updating genesis file from beacon-kit..."

# Clean up any existing temp directory
if [ -d "$BEACON_KIT_DIR" ]; then
    echo "🧹 Cleaning up existing temp directory..."
    rm -rf "$BEACON_KIT_DIR"
fi

# Clone beacon-kit repository
echo "📥 Cloning beacon-kit repository..."
git clone "$BEACON_KIT_REPO" "$BEACON_KIT_DIR"

# Check if the source genesis file exists
SOURCE_FILE="$BEACON_KIT_DIR/$SOURCE_GENESIS_PATH"
if [ ! -f "$SOURCE_FILE" ]; then
    echo "❌ Error: Source genesis file not found at $SOURCE_FILE"
    exit 1
fi

echo "✅ Found source genesis file at $SOURCE_FILE"

# Create a temporary file for processing
TEMP_FILE=$(mktemp)

# Copy the source file and make modifications
echo "🔧 Processing genesis file..."
cp "$SOURCE_FILE" "$TEMP_FILE"

# Replace chain ID with placeholder
echo "  - Replacing chain ID with <CHAIN_ID> placeholder..."
jq --arg chainid "<CHAIN_ID>" '.config.chainId = $chainid' "$TEMP_FILE" > "${TEMP_FILE}.tmp" && mv "${TEMP_FILE}.tmp" "$TEMP_FILE"

# Replace timestamp with 0
echo "  - Setting timestamp to 0..."
jq '.timestamp = "0"' "$TEMP_FILE" > "${TEMP_FILE}.tmp" && mv "${TEMP_FILE}.tmp" "$TEMP_FILE"

# Add the funded account
echo "  - Adding funded account $FUNDED_ACCOUNT with balance $FUNDED_BALANCE..."
jq --arg account "$FUNDED_ACCOUNT" --arg balance "$FUNDED_BALANCE" '.alloc[$account] = {"balance": $balance}' "$TEMP_FILE" > "${TEMP_FILE}.tmp" && mv "${TEMP_FILE}.tmp" "$TEMP_FILE"

# Add the requested predeploy contract (code, nonce, balance, storage)
echo "  - Adding predeploy contract $CUSTOM_CONTRACT_ADDRESS..."
jq \
  --arg addr "$CUSTOM_CONTRACT_ADDRESS" \
  --arg code "$CUSTOM_CONTRACT_CODE" \
  --arg nonce "$CUSTOM_CONTRACT_NONCE" \
  --arg balance "$CUSTOM_CONTRACT_BALANCE" \
  --arg sk "$CUSTOM_CONTRACT_STORAGE_KEY" \
  --arg sv "$CUSTOM_CONTRACT_STORAGE_VALUE" \
  '.alloc[$addr] = {"code": $code, "nonce": $nonce, "balance": $balance, "storage": {($sk): $sv}}' \
  "$TEMP_FILE" > "${TEMP_FILE}.tmp" && mv "${TEMP_FILE}.tmp" "$TEMP_FILE"

# Move the processed file to the target location
TARGET_FILE="$SCRIPT_DIR/$TARGET_GENESIS_PATH"
echo "💾 Saving updated genesis file to $TARGET_FILE..."
mv "$TEMP_FILE" "$TARGET_FILE"

# Clean up temp directory
echo "🧹 Cleaning up..."
rm -rf "$BEACON_KIT_DIR"

echo "✅ Genesis file updated successfully!"
echo ""
echo "📋 Summary of changes:"
echo "  - Chain ID: Set to <CHAIN_ID> placeholder"
echo "  - Timestamp: Set to 0"
echo "  - Added funded account: $FUNDED_ACCOUNT with balance $FUNDED_BALANCE"
echo "  - Added predeploy contract: $CUSTOM_CONTRACT_ADDRESS"
echo ""
echo "🎯 The updated genesis file is ready at: $TARGET_FILE"
