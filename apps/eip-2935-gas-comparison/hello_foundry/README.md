# Gas Optimization with EIP-2935 Block Hash Access

## What EIP-2935 Enables
EIP-2935 introduces a persistent block hash storage mechanism, giving smart contracts access to older block hashes, beyond the 256-block limit of the current BLOCKHASH opcode.

**Why It Matters for Gas (Indirectly)**

Today: If you want to use historical block hashes beyond 256 blocks, you'd have to store them manually onchain — costing ~20,000 gas per block (SSTORE).

With EIP-2935: You can retrieve these hashes directly from protocol-provided storage — zero SSTORE costs, zero manual logging, gas saved indirectly.

Guide Layout
    - What is EIP-2935 and what it unlocks, and comparison to manual storage oracles
    - Requirements: Solidity + Foundry or Viem
    - Code walkthrough

# What is EIP-2935?
EIP-2935 proposes a new opcode to access *historical block hashes* beyond the 256-block limit currently enforced by `BLOCKHASH`.

Today, `BLOCKHASH(n)` only works for `n >= block.number - 256`. Anything older returns `0`. Therefore, dApps need to store these hashes that are older than 1 hour using `SSTORE` to access for their needs.

With EIP-2935, `BLOCKHASH(n)` works for **Up to the last 8,191 blocks**. Essentially, 

This gives you verifiable randomness sources, timestamp anchoring, and light-proof opportunities without needing to store hashes yourself.


anvil --hardfork prague --chain-id 80069 --port 8545

source .env && forge script script/BlockHashDemo.s.sol:BlockHashDemoScript \
  --rpc-url $TEST_RPC_URL \
  --broadcast -vvvv


# Estimate gas cost for native access (EIP-2935)
cast estimate $CHECKER "getOldHash(uint256)" 1000 \
  --rpc-url $TEST_RPC_URL

# Estimate gas cost for storing manually (if valid)
cast estimate $TRACKER "storeBlockHash(uint256)" 500 \
  --rpc-url $TEST_RPC_URL
