#!/bin/bash

# Simple transaction spammer - sends transactions as fast as possible without waiting
# Usage: ./scripts/spam-transactions.sh [NUM_TRANSACTIONS] [GAS_AMOUNT]

set -e

CONTRACT_ADDRESS="0xb7eE90D4977567778245772A5cbCD61CCc0dd891"
PRIVATE_KEY="0x1ef5909e3da2aad77f3b6040bd6eec1b5f4a70acf4cd9090eba6901a5a0a5023"
# Use EL_ETHRPC_URL if set, otherwise default
RPC_URL="${EL_ETHRPC_URL:-https://bepolia.rpc.berachain.com}"

# Default values
NUM_TRANSACTIONS=${1:-10}
GAS_AMOUNT=${2:-8000000}

echo "Starting transaction spam (no waiting for responses)..."
echo "Contract: $CONTRACT_ADDRESS"
echo "RPC: $RPC_URL"
echo "Transactions to send: $NUM_TRANSACTIONS"
echo "Gas per transaction: $GAS_AMOUNT"
echo ""

# Get the account address from private key
ACCOUNT_ADDRESS=$(cast wallet address --private-key "$PRIVATE_KEY")
echo "Account: $ACCOUNT_ADDRESS"

# Get current nonce
echo "Getting current nonce..."
CURRENT_NONCE=$(cast nonce "$ACCOUNT_ADDRESS" --rpc-url "$RPC_URL")
echo "Current nonce: $CURRENT_NONCE"
echo ""

# Create results directory
RESULTS_DIR="spam-results-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS_DIR"

# Log file
LOG_FILE="$RESULTS_DIR/transactions.log"
echo "Transaction Log - $(date)" > "$LOG_FILE"
echo "========================" >> "$LOG_FILE"
echo "Account: $ACCOUNT_ADDRESS" >> "$LOG_FILE"
echo "Starting nonce: $CURRENT_NONCE" >> "$LOG_FILE"
echo "========================" >> "$LOG_FILE"

start_time=$(date +%s)

echo "Starting at $(date)"
echo "Sending $NUM_TRANSACTIONS transactions as fast as possible..."
echo ""

# Send transactions as fast as possible without waiting for responses
for i in $(seq 1 $NUM_TRANSACTIONS); do
    current_nonce=$((CURRENT_NONCE + i - 1))
    echo "[$i/$NUM_TRANSACTIONS] Sending transaction with nonce $current_nonce..."
    
    # Send transaction in background (don't wait for response)
    cast send "$CONTRACT_ADDRESS" "burnGas(uint256)" "$GAS_AMOUNT" \
        --private-key "$PRIVATE_KEY" \
        --rpc-url "$RPC_URL" \
        --nonce "$current_nonce" \
        --json > "$RESULTS_DIR/tx_$i.json" 2>&1 &
    
    echo "  📤 SENT (background) - nonce $current_nonce"
    echo "$(date +%s),$i,SENT,$current_nonce" >> "$LOG_FILE"
    
    # Small delay to prevent overwhelming the RPC
    sleep 0.1
done

# Calculate duration
end_time=$(date +%s)
duration=$((end_time - start_time))

# Final summary
echo ""
echo "========================"
echo "Test completed at $(date)"
echo "Duration: ${duration} seconds"
echo "Total transactions sent: $NUM_TRANSACTIONS"
echo "Rate: $(echo "scale=2; $NUM_TRANSACTIONS / $duration" | bc -l 2>/dev/null || echo "N/A") tx/sec"
echo "Results saved to: $RESULTS_DIR/"

# Save summary
cat > "$RESULTS_DIR/summary.txt" << EOF
Transaction Spam Test Summary
============================
Start time: $(date -r $start_time 2>/dev/null || date)
End time: $(date)
Duration: ${duration} seconds
Total transactions sent: $NUM_TRANSACTIONS
Gas per transaction: $GAS_AMOUNT
Contract: $CONTRACT_ADDRESS
Account: $ACCOUNT_ADDRESS
Starting nonce: $CURRENT_NONCE

Results:
- Transactions sent: $NUM_TRANSACTIONS
- Rate: $(echo "scale=2; $NUM_TRANSACTIONS / $duration" | bc -l 2>/dev/null || echo "N/A") tx/sec

Note: Transactions were sent in background. Check individual tx_*.json files for results.
Transaction log: transactions.log
EOF

echo ""
echo "Summary saved to: $RESULTS_DIR/summary.txt"
echo "Individual transaction results in: $RESULTS_DIR/tx_*.json" 