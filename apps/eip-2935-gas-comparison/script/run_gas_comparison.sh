#!/bin/bash

set -euo pipefail
source .env

LOG_FILE="script_output.log"
OUTPUT_FILE="gas_comparison.md"

echo "🔧 Running eip2935GasComparison.s script..."

# Run script and save logs
forge script ./script/eip2935GasComparison.s.sol:eip2935GasComparison.s \
  --rpc-url "$TEST_RPC_URL" \
  --private-key "$EOA_PRIVATE_KEY" \
  --broadcast -vvvv | tee "$LOG_FILE"

echo "✅ Script execution complete. Parsing gas usage..."

{
  echo ""
  echo "# EIP-2935 Gas Comparison"
  echo ""
  echo "| Pattern                             | Methods Involved                         | Total Gas |"
  echo "|-------------------------------------|------------------------------------------|-----------|"
} > "$OUTPUT_FILE"

# Match lines like: [22677] BlockhashConsumer::storeWithSSTORE(...) [ or staticcall
grep -Eo '\[[0-9]+\] BlockhashConsumer::[a-zA-Z_]+\(' "$LOG_FILE" | \
  sed -E 's/\[([0-9]+)\] BlockhashConsumer::([a-zA-Z_]+)\(.*/\2 \1/' > /tmp/gas_data.txt

# Group + aggregate
patterns=()
methods=()
totals=()

while read -r func gas; do
  if [[ "$func" == "storeWithSSTORE" || "$func" == "readWithSLOAD" ]]; then
    key="Before EIP-2935: SSTORE pattern"
  elif [[ "$func" == "submitOracleBlockhash" || "$func" == "readFromOracle" ]]; then
    key="Before EIP-2935: Oracle pattern"
  elif [[ "$func" == "readWithGet" ]]; then
    key="After EIP-2935: .get() access"
  else
    key="Other"
  fi

  found=false
  for i in "${!patterns[@]}"; do
    if [[ "${patterns[$i]}" == "$key" ]]; then
      totals[$i]=$(( ${totals[$i]} + gas ))
      if [[ "${methods[$i]}" != *"$func(...)"* ]]; then
        methods[$i]="${methods[$i]}, $func(...)"
      fi
      found=true
      break
    fi
  done

  if [[ "$found" = false ]]; then
    patterns+=("$key")
    methods+=("$func(...)")
    totals+=("$gas")
  fi
done < /tmp/gas_data.txt

# Output table rows
for i in "${!patterns[@]}"; do
  printf "| %-35s | %-40s | %9s |\n" \
    "${patterns[$i]}" "${methods[$i]}" "${totals[$i]}" >> "$OUTPUT_FILE"
done

echo ""
echo "📄 Table saved to gas_comparison.md"
echo ""
cat "$OUTPUT_FILE"
