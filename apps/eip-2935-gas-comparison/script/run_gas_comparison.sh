#!/bin/bash

# Exit on any error, undefined var, or pipefail
set -euo pipefail

# Load environment variables
source ../.env

# Output log
LOG_FILE="script_output.log"
OUTPUT_FILE="gas_comparison.md"

# Step 1: Run script
cd ..
echo "🔧 Running DeployGasComparison script..."
forge script script/DeployGasComparison.s.sol:DeployGasComparison \
  --rpc-url "$TEST_RPC_URL" \
  --private-key "$PK_1" \
  --broadcast -vvvv > "$LOG_FILE" 2>&1

echo "✅ Script execution complete. Parsing gas usage..."

# Step 2: Header for table
{
echo ""
echo "# EIP-2935 Gas Comparison"
echo ""
echo "| Pattern                   | Method                         | Approx. Gas |"
echo "|---------------------------|---------------------------------|-------------|"
} > "$OUTPUT_FILE"

# Step 3: Parse log and append to table
grep -E 'BlockhashConsumer::|MockBlockhashHistory::' "$LOG_FILE" | \
grep -o '\[[0-9]\{3,\}\]' | tr -d '[]' > /tmp/gas_vals.txt

grep -E 'BlockhashConsumer::|MockBlockhashHistory::' "$LOG_FILE" | \
grep -o '::[a-zA-Z_]\+' | tr -d ':' > /tmp/func_names.txt

paste /tmp/gas_vals.txt /tmp/func_names.txt | sort -k2 | uniq | while read -r gas func; do
  case "$func" in
    set) pattern="Before EIP-2935: SSTORE storage" ;;
    submitOracleBlockhash) pattern="Before EIP-2935: Oracle submission" ;;
    stored) pattern="Before EIP-2935: SLOAD readback" ;;
    readWithGet) pattern="After EIP-2935: .get() access" ;;
    readFromOracle) pattern="Before EIP-2935: Oracle read" ;;
    get) pattern="After EIP-2935: .get() (internal)" ;;
    *) pattern="Other" ;;
  esac
  printf "| %-25s | %-31s | %11s |\n" "$pattern" "$func(...)" "$gas" | tee -a "$OUTPUT_FILE"
done

echo ""
echo "📄 Table saved to gas_comparison.md"
