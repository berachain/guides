# EIP-2935 Gas Comparison

| Pattern                         | Methods Involved           | Total Gas |
| ------------------------------- | -------------------------- | --------- |
| Before EIP-2935: SSTORE pattern | storeWithSSTORE(...)       | 45354     |
| After EIP-2935: .get() access   | readWithGet(...)           | 6497      |
| Before EIP-2935: Oracle pattern | submitOracleBlockhash(...) | 45568     |
