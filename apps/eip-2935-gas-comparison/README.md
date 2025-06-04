# EIP-2935: Gas-Efficient Blockhash Access for Berachain Developers

This guide covers EIP-2935, and how it enables gas optimizations for applications building on Berachain. It is part of the Bectra upgrade, which brings Ethereum’s Pectra-era EIPs to Berachain.

EIP-2935 introduces a system contract that stores the last 8,191 block hashes in a ring buffer, making them available to smart contracts via a simple interface. This dramatically improves the developer experience for use cases that rely on historical blockhashes, without requiring manual storage or trusted offchain sources.

> Please note that Bepolia, and even Ethereum Mainnet, have not deployed these state contracts yet. Thus this guide showcases how it would be used in theory, and how much overall gas savings can be obtained.
<!-- TODO - confirm the above, because I could not find the contract addresses to work with that the standard eludes to -->

## Before vs After EIP-2935

Before EIP-2935, smart contracts could access only the last 256 block hashes using the `BLOCKHASH` opcode. This process raised challenges though:

- Accessing a hash outside that window, returned `0x0`, silently,
- You couldn’t fetch a blockhash using dynamic inputs (e.g. calldata or computation),
- If you needed a blockhash later, you had to store it manually using `SSTORE` (~20,000 gas),
- Or emit it in an event and recover it offchain, which breaks onchain determinism

This led to dApps implementing expensive or complex workarounds, especially in cases like:

- Randomness beacons
- Voting snapshot validation
- Rollup L1↔L2 anchors
- zk-proof verification
- Timestamp anchoring
- Evidence-based slashing

## What EIP-2935 Enables

EIP-2935 solves this by creating a system contract at a fixed address on the respective network, that stores block hashes for the last 8,191 blocks (approximately 1 day), aka the `HISTORY_SERVE_WINDOW,` in protocol-maintained storage.

Smart contracts can now:

- Access historical blockhashes using arbitrary block numbers within the window referred to as `HISTORY_SERVE_WINDOW`,
- Avoid `SSTORE` overhead by not needing to manually persist hashes, unless they need hashes outside of the new `HISTORY_SERVE_WINDOW` which is 8191 blocks.
- Ensure reliable behavior where the system contract will revert if a block is out of range, rather than returning silent garbage
- Support calldata-driven logic, dynamic access, and composable designs

Anyone can later call `get(blockNumber)` to retrieve a hash from that range.

## What This Looks Like in Code

Before EIP-2935, developers would do something like:

```solidity
bytes32 hash = blockhash(n); // Only works if n is within 256-block window
storedHash = hash; // Costly SSTORE just to remember it
```

With EIP2935, they can just do something liket:

```solidity
bytes32 h = EIP2935SystemContract.get(blockNumber);
```

This saves at least one SSTORE per use case, which can reduce total gas by 20,000+ per user interaction. Within an application, this of course can add up to massive savings over time.

Now that you have an understanding of EIP-2935 and what it brings to Berachain's developer experience, let's get into the guide and code itself for this guide.

## Guide

### Step 1: Setup

- Dependencies
- .env setup

Run an anvil fork of Bepolia:

`source .env && anvil --fork-url $BEPOLIA_RPC_URL --chain-id 80069 --hardfork prague --port 8545`

### Step 2: Review of the solidity file

This project demonstrates and benchmarks different blockhash access patterns:

1. Manual SSTORE of blockhash (pre-EIP-2935 workaround)
2. Direct SLOAD readback of stored hash
3. EIP-2935-style .get() call to a mock system contract
4. Oracle-submitted blockhash pattern simulating offchain access

#### Contracts

`MockBlockhashHistory.sol`: Simulates the system contract from EIP-2935

`BlockhashConsumer.sol`: Contains all access patterns for comparison

### Step 3: Running the Tests

Run gas benchmarks:

`forge test --gas-report`

### Step 4: Running the Script Files

Deploy mock contracts and simulate protocol + oracle behavior. First make your way to the `./script` subdirectory. Then run:

`./run_gas_comparison.sh`

This will run the solidity script, and output a table showcasing the gas spent on the anvil network.

<!-- ## Expected Results (Approximate)

| Pattern         | Operation               | Gas      |
|----------------|--------------------------|----------|
| Manual storage | `storeWithSSTORE`        | ~20,000  |
| Manual read    | `readWithSLOAD`          | ~2,100   |
| EIP-2935 mock  | `readWithGet (cold)`     | ~5,200   |
|                | `readWithGet (warm)`     | ~2,600   |
| Oracle submit  | `submitOracleBlockhash`  | ~20,000  |
| Oracle read    | `readFromOracle`         | ~2,100   |


Goal

This benchmark helps evaluate gas savings unlocked by EIP-2935 when accessing historical blockhashes compared to manual caching or offchain submission methods.

Feel free to plug this into a guide, lecture, or internal protocol evaluation.

### Step 3: Review of the solidity test file

### Step 4: Review of the solidity script file to get this working on Bepolia or a local anvil fork of Bepolia

### Step 5: Running the actual code

### Step 6: Assessing the results

------


 -->
