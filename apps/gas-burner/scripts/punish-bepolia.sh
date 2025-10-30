#!/bin/bash

# Punish Bepolia - Stress test script
# Sends 100 transactions of 25 million gas each in forward order

set -e

# Test configuration
GAS_PRICE=200000
GAS_AMOUNT=8000000
NUM_TRANSACTIONS=100
RPC_URL="${EL_ETHRPC_URL:-http://10.147.18.191:41003}"

echo "🔍 Client Mix Test: 100 tx @ 8M gas each"
echo "========================================"
echo "This stress test will send $NUM_TRANSACTIONS transactions"
echo "Each transaction will burn $GAS_AMOUNT gas (optimized for sealing)"
echo "Gas price: $GAS_PRICE wei (200k wei - maximum priority sealing)"
echo "Target RPC: $RPC_URL"
echo ""

# Estimate total cost
TOTAL_GAS=$((NUM_TRANSACTIONS * GAS_AMOUNT))
TOTAL_COST_WEI=$((TOTAL_GAS * GAS_PRICE))
TOTAL_COST_ETH=$(echo "scale=6; $TOTAL_COST_WEI / 1000000000000000000" | bc -l 2>/dev/null || echo "N/A")

echo "💥 Stress Test Estimates:"
echo "  Total gas: $TOTAL_GAS (2.5 billion gas!)"
echo "  Total cost: $TOTAL_COST_WEI wei (~$TOTAL_COST_ETH ETH)"
echo ""

echo ""
echo "🚀 Starting client sealing test..."

# Run the gas burner script
./scripts/burn-gas.sh \
    --gas-price "$GAS_PRICE" \
    --gas-amount "$GAS_AMOUNT" \
    --num-tx "$NUM_TRANSACTIONS" \
    --rpc-url "$RPC_URL"

echo ""
echo "🔍 Client sealing test completed!"
echo ""
echo "💡 Sealing analysis:"
echo "  - Check the results directory for transaction sealing patterns"
echo "  - Analyze reth vs geth sealing behavior"
echo "  - Monitor client mix performance differences" 