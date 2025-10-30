#!/bin/bash

# Enhanced Gas Burner with configurable options
# Usage: ./burn-gas.sh [OPTIONS]
# 
# Options:
#   -g, --gas-amount GAS     Amount of gas to burn (default: 8000000)
#   -p, --gas-price PRICE    Gas price in wei (default: auto-estimate)
#   -n, --num-tx COUNT       Number of transactions to send (default: 1)
#   -c, --contract ADDRESS   Contract address (default: from env)
#   -k, --private-key KEY    Private key (default: from env)
#   -r, --rpc-url URL        RPC URL (default: from EL_ETHRPC_URL env)
#   -h, --help               Show this help message

set -e

# Default values
CONTRACT_ADDRESS="0xb7eE90D4977567778245772A5cbCD61CCc0dd891"
PRIVATE_KEY="0x1ef5909e3da2aad77f3b6040bd6eec1b5f4a70acf4cd9090eba6901a5a0a5023"
RPC_URL="${EL_ETHRPC_URL:-https://bepolia.rpc.berachain.com}"
GAS_AMOUNT=8000000
GAS_PRICE=""
NUM_TRANSACTIONS=1

# Function to show help
show_help() {
    cat << EOF
Enhanced Gas Burner with configurable options

Usage: $0 [OPTIONS]

Options:
  -g, --gas-amount GAS     Amount of gas to burn per transaction (default: $GAS_AMOUNT)
  -p, --gas-price PRICE    Gas price in wei (default: auto-estimate)
  -n, --num-tx COUNT       Number of transactions to send (default: $NUM_TRANSACTIONS)
  -c, --contract ADDRESS   Contract address (default: $CONTRACT_ADDRESS)
  -k, --private-key KEY    Private key (default: from environment)
  -r, --rpc-url URL        RPC URL (default: $RPC_URL)
  -h, --help               Show this help message

Examples:
  # Send single transaction with 900,000 wei gas price
  $0 --gas-price 900000 --gas-amount 10000000
  
  # Send 200 transactions with custom gas price
  $0 --gas-price 900000 --gas-amount 10000000 --num-tx 200
  
  # Use custom RPC endpoint
  $0 --rpc-url http://10.147.18.191:40003 --gas-price 900000

Environment Variables:
  EL_ETHRPC_URL           RPC endpoint URL
  
EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -g|--gas-amount)
            GAS_AMOUNT="$2"
            shift 2
            ;;
        -p|--gas-price)
            GAS_PRICE="$2"
            shift 2
            ;;
        -n|--num-tx)
            NUM_TRANSACTIONS="$2"
            shift 2
            ;;
        -c|--contract)
            CONTRACT_ADDRESS="$2"
            shift 2
            ;;
        -k|--private-key)
            PRIVATE_KEY="$2"
            shift 2
            ;;
        -r|--rpc-url)
            RPC_URL="$2"
            shift 2
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Validate inputs
if ! [[ "$GAS_AMOUNT" =~ ^[0-9]+$ ]]; then
    echo "Error: Gas amount must be a number"
    exit 1
fi

if ! [[ "$NUM_TRANSACTIONS" =~ ^[0-9]+$ ]]; then
    echo "Error: Number of transactions must be a number"
    exit 1
fi

if [[ -n "$GAS_PRICE" ]] && ! [[ "$GAS_PRICE" =~ ^[0-9]+$ ]]; then
    echo "Error: Gas price must be a number (in wei)"
    exit 1
fi

# Display configuration
echo "Gas Burner Configuration"
echo "======================="
echo "Contract: $CONTRACT_ADDRESS"
echo "RPC URL: $RPC_URL"
echo "Gas per transaction: $GAS_AMOUNT"
echo "Number of transactions: $NUM_TRANSACTIONS"
if [[ -n "$GAS_PRICE" ]]; then
    PRIORITY_FEE=$((GAS_PRICE / 10))
    echo "Gas price: $GAS_PRICE wei ($(echo "scale=2; $GAS_PRICE / 1000000000" | bc -l 2>/dev/null || echo "N/A") gwei)"
    echo "Max fee per gas: $GAS_PRICE wei, Priority fee: $PRIORITY_FEE wei (EIP-1559)"
else
    echo "Gas price: Auto-estimate"
fi
echo ""

# Get the account address from private key
ACCOUNT_ADDRESS=$(cast wallet address --private-key "$PRIVATE_KEY")
echo "Account: $ACCOUNT_ADDRESS"

# Check account balance
echo "Checking account balance..."
BALANCE=$(cast balance "$ACCOUNT_ADDRESS" --rpc-url "$RPC_URL")
BALANCE_ETH=$(cast --to-unit "$BALANCE" ether)
echo "Balance: $BALANCE_ETH ETH"

# Get current nonce for multi-transaction scenarios
if [[ $NUM_TRANSACTIONS -gt 1 ]]; then
    echo "Getting current nonce..."
    CURRENT_NONCE=$(cast nonce "$ACCOUNT_ADDRESS" --rpc-url "$RPC_URL")
    echo "Current nonce: $CURRENT_NONCE"
    
    # Create results directory for multi-transaction tests
    RESULTS_DIR="gas-burn-results-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$RESULTS_DIR"
    LOG_FILE="$RESULTS_DIR/transactions.log"
    
    echo "Transaction Log - $(date)" > "$LOG_FILE"
    echo "========================" >> "$LOG_FILE"
    echo "Account: $ACCOUNT_ADDRESS" >> "$LOG_FILE"
    echo "Starting nonce: $CURRENT_NONCE" >> "$LOG_FILE"
    echo "Gas amount: $GAS_AMOUNT" >> "$LOG_FILE"
    echo "Gas price: ${GAS_PRICE:-auto}" >> "$LOG_FILE"
    echo "========================" >> "$LOG_FILE"
fi

echo ""
echo "Starting transaction(s)..."
echo ""

start_time=$(date +%s)

# Build cast command with optional gas price
build_cast_command() {
    local nonce="$1"
    local output_file="$2"
    
    local cmd="cast send \"$CONTRACT_ADDRESS\" \"burnGas(uint256)\" \"$GAS_AMOUNT\" \
        --private-key \"$PRIVATE_KEY\" \
        --rpc-url \"$RPC_URL\" \
        --json"
    
    if [[ -n "$GAS_PRICE" ]]; then
        # Use EIP-1559 style gas fees for better compatibility
        cmd="$cmd --gas-price \"$GAS_PRICE\" --priority-gas-price \"$((GAS_PRICE / 10))\""
    fi
    
    if [[ -n "$nonce" ]]; then
        cmd="$cmd --nonce \"$nonce\""
    fi
    
    if [[ -n "$output_file" ]]; then
        cmd="$cmd > \"$output_file\" 2>&1"
    fi
    
    echo "$cmd"
}

# Send transactions
if [[ $NUM_TRANSACTIONS -eq 1 ]]; then
    # Single transaction
    echo "Sending single transaction..."
    cmd=$(build_cast_command "" "")
    eval "$cmd"
    echo "✅ Transaction sent successfully!"
else
    # Multiple transactions - RAPID SENDING with predicted nonces
    echo "Sending $NUM_TRANSACTIONS transactions rapidly..."
    echo "Using predicted nonces without waiting for confirmation..."
    echo ""
    
    successful_transactions=0
    failed_transactions=0
    
    # Send transactions rapidly with predicted nonces (no confirmation waiting)
    for i in $(seq 1 $NUM_TRANSACTIONS); do
        current_nonce=$((CURRENT_NONCE + i - 1))
        echo "[$i/$NUM_TRANSACTIONS] Sending transaction with nonce $current_nonce..."
        
        # Build and execute command without waiting for confirmation
        cmd="cast send \"$CONTRACT_ADDRESS\" \"burnGas(uint256)\" \"$GAS_AMOUNT\" \
            --private-key \"$PRIVATE_KEY\" \
            --rpc-url \"$RPC_URL\" \
            --nonce \"$current_nonce\" \
            --json"
        
        if [[ -n "$GAS_PRICE" ]]; then
            cmd="$cmd --gas-price \"$GAS_PRICE\" --priority-gas-price \"$((GAS_PRICE / 10))\""
        fi
        
        # Send transaction in background for rapid submission
        eval "$cmd > \"$RESULTS_DIR/tx_$i.json\" 2>&1 &"
        echo "  📤 SENT - nonce $current_nonce"
        echo "$(date +%s),$i,SENT,$current_nonce" >> "$LOG_FILE"
        ((successful_transactions++))
        
        # Small delay to prevent overwhelming the RPC
        sleep 0.05
    done
    
    echo "Rapid transaction sending completed!"
    echo "📤 Sent: $successful_transactions"
    echo ""
    echo "Waiting for background processes to complete..."
    wait
fi

# Calculate duration and show summary
end_time=$(date +%s)
duration=$((end_time - start_time))

echo ""
echo "========================"
echo "Test completed at $(date)"
echo "Duration: ${duration} seconds"
echo "Total transactions sent: $NUM_TRANSACTIONS"

if [[ $NUM_TRANSACTIONS -gt 1 ]]; then
    if [[ $successful_transactions -gt 0 ]]; then
        echo "Send rate: $(echo "scale=1; $successful_transactions * 100 / $NUM_TRANSACTIONS" | bc -l 2>/dev/null || echo "N/A")%"
        echo "Average rate: $(echo "scale=2; $successful_transactions / $duration" | bc -l 2>/dev/null || echo "N/A") sent tx/sec"
    fi
    echo "Results saved to: $RESULTS_DIR/"
    
    # Save summary for multi-transaction tests
    cat > "$RESULTS_DIR/summary.txt" << EOF
Gas Burner Test Summary (Rapid Send Mode)
=========================================
Start time: $(date -r $start_time 2>/dev/null || date)
End time: $(date)
Duration: ${duration} seconds
Mode: Rapid sending with predicted nonces (no confirmation waiting)
Total transactions attempted: $NUM_TRANSACTIONS
Gas per transaction: $GAS_AMOUNT
Gas price: ${GAS_PRICE:-auto-estimate} wei
Contract: $CONTRACT_ADDRESS
Account: $ACCOUNT_ADDRESS
Starting nonce: $CURRENT_NONCE
RPC URL: $RPC_URL

Results:
- Transactions attempted: $NUM_TRANSACTIONS
- Sent: $successful_transactions
- Rejected: $failed_transactions
- Send rate: $(echo "scale=1; $successful_transactions * 100 / $NUM_TRANSACTIONS" | bc -l 2>/dev/null || echo "N/A")%
- Average rate: $(echo "scale=2; $successful_transactions / $duration" | bc -l 2>/dev/null || echo "N/A") sent tx/sec

Individual transaction results: tx_*.json
Transaction log: transactions.log
EOF
    
    echo "Summary saved to: $RESULTS_DIR/summary.txt"
fi

echo "========================" 