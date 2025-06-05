# EIP-2935 Gas-Efficient Blockhash Access for Berachain Developers

This quickstart covers [EIP-2935, _an EIP focused on historical block hashes from state_,](https://eips.ethereum.org/EIPS/eip-2935) and how it enables gas optimizations for applications building on Berachain. It is part of the [Bectra upgrade](https://x.com/berachain/status/1930326162577776655), which brings Ethereum’s Pectra-era EIPs to Berachain.

A more detailed version of this guide, with context on EIP-2935, can be found within our [docs](https://docs.berachain.com/developers/).

## Quick Context

EIP-2935 introduces a system contract that stores the last 8,191 block hashes in a ring buffer, making them readily available onchain. This dramatically improves the developer experience for use cases that rely on historical blockhashes, without requiring manual storage or trusted offchain sources.

This guide specifically shows obtaining a historic blockhash using the power of EIP-2935 and its system contracts, all on Bepolia. This can be done on Berachain as well.

This guide primarily revolves around the following files:

- `eip2935GasComparison.sol` - A simple implementation showcasing the methods for obtaining a blockhash, including storing them pre-EIP-2935.
- `gasComparison.t.sol` - A simple test suite to showcase unit testing with the `eip2935GasComparison.sol` contract.
- `DeployGasComparison.s.sol` - A solidity script used to deploy the `eip2935GasComparison.sol` and make calls to it to simulate different blockhash reading methods.
- `run_gas_comparison.sh` - A bash script created to deploy `eip2935GasComparison.sol` and tabulate the gas expenditure results.

### Prerequisites

Make sure you have the Foundry toolchain installed.

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup  # Ensures you have the latest version (with solc auto-install support)
```

If you've already installed Foundry, just run:

```bash
foundryup
```

> This guide requires Solidity ^0.8.29. `forge build` will automatically download the right version if you're using a modern `forge` via `foundryup`.

Go through the following steps:

### Step 1 - Install Deps

```bash
cd apps/eip-2935-gas-comparison
```

```bash
# From apps/eip-2935-gas-comparison
pnpm install && cp .env.example .env
```

> ℹ️ forge install pulls in required dependencies like forge-std. Don’t skip it.

```bash
forge install && forge build
```

### Step 2 - Start Your Anvil Fork

Run the following command to deploy a local anvil fork via your terminal. You need to specify the block number shown below to ensure that the EIP2935 system contract will function properly to reflect being activated after Bectra upgrades on Bepolia.

```bash
# From apps/eip-2935-gas-comparison
source .env && anvil --fork-url $BEPOLIA_RPC_URL --fork-block-number 4867668 --chain-id 80069 --port 8545
```

### Step 3 - Update Your `.env` and Deploy `eip2935GasComparison.sol` Implementation

This script works on a local Bepolia Anvil fork. 

Update your `.env` with your `EOA_PRIVATE_KEY` and make sure it has enough $tBERA for deployment. A single $tBERA should be more than enough.

```bash
# From apps/eip-2935-gas-comparison
./script/run_gas-comparison.sh
```
### Step 4 - Understanding What the Script Does

The bash script, `run_gas_comparison.sh` deploys the `eip2935GasComparison.sol` contract on the locally ran anvil fork of Bepolia. It then goes through the results and tabulates the total gas expenses for each blockhashing method, including storing the blockhash or replicating the usage of an oracle.

#### Step 6 - Highlevel Review of the Solidity File

This project demonstrates and benchmarks different blockhash access patterns:

1. Manual SSTORE of blockhash (pre-EIP-2935 workaround) and direct SLOAD readback of stored hash
2. EIP-2935-style .get() call to a mock system contract
3. Oracle-submitted blockhash pattern simulating offchain access

You can see the details of the code in `eip2935GasComparison.sol`.

> It is very important to note that the system contract only receives the `calldata`, and there is no specification of the function signature or anything. See the explaination below. You can see this more within the `eip2935GasComparison.sol` `readWithGet()` function.

## Step 7 - Assessing the Results

The table is output in `gas_comparison.md` at the root of this subdirectory, where we can see the gas savings when comparing one method to the next.

Below is an example output that you ought to see when running the bash script:

| Pattern                             | Methods Involved                         | Total Gas |
|-------------------------------------|------------------------------------------|-----------|
| Before EIP-2935: SSTORE pattern     | storeWithSSTORE(...), readWithSLOAD(...) |     46210 |
| After EIP-2935: .get() access       | readWithGet(...)                         |      6494 |
| Before EIP-2935: Oracle pattern     | submitOracleBlockhash(...), readFromOracle(...) |     46338 |

Simply reading the blockhash from the system contract resulted in significantly less gas expenditure compared to the other methods typically used before EIP-2935. A table showcasing the savings can be seen below when comparing against the new method of just reading from the system contract.

| Pattern                         | Total Gas | Savings vs. `.get()` | % Saved Compared to `.get()` |
|---------------------------------|-----------|------------------------|------------------------------|
| Before EIP-2935: SSTORE pattern | 46,210    | 39,716                 | 85.95%                       |
| Before EIP-2935: Oracle pattern | 46,338    | 39,844                 | 86.00%                       |
| After EIP-2935: .get() access   | 6,494     | —                      | —                            |

> It should be noted that if carrying out any of these calls cold results in the gas expenditures above, and warm calls will be less. The comparative analysis still stands even with this in mind.

🐻🎉 Congrats! You have finished the guide and have now seen the gas savings that come about with EIP-2935 when accessing historical blockhashes. 