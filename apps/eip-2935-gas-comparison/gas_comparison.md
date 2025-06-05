
# EIP-2935 Gas Comparison

| Pattern                             | Methods Involved                         | Total Gas |
|-------------------------------------|------------------------------------------|-----------|
| Before EIP-2935: SSTORE pattern     | storeWithSSTORE(...), readWithSLOAD(...) |     46210 |
| After EIP-2935: .get() access       | readWithGet(...)                         |      6494 |
| Before EIP-2935: Oracle pattern     | submitOracleBlockhash(...), readFromOracle(...) |     46338 |
