# EIP-2935 Gas-Efficient Blockhash Access for Berachain Developers

This quickstart covers [EIP-2935, _an EIP focused on historical block hashes from state_,](https://eips.ethereum.org/EIPS/eip-2935) and how it enables gas optimizations for applications building on Berachain. It is part of the [Bectra upgrade](https://x.com/berachain/status/1930326162577776655), which brings Ethereum’s Pectra-era EIPs to Berachain.

A more detailed version of this guide, with context on EIP-2935, can be found within our [docs](https://docs.berachain.com/developers/).

## Quick Context

EIP-2935 introduces a system contract that stores the last 8,191 block hashes in a ring buffer, making them readily available onchain. This dramatically improves the developer experience for use cases that rely on historical blockhashes, without requiring manual storage or trusted offchain sources.

This guide specifically shows obtaining a historic blockhash using the power of EIP-2935 and its system contracts, all on Bepolia. This can be done on Berachain as well.

This guide primarily revolves around the following files:

- `eip2935GasComparison.sol` - A simple implementation showcasing the methods for obtaining a blockhash, including storing them pre-EIP-2935.
- `eip2935GasComparison.t.sol` - A simple test suite to showcase unit testing with the `eip2935GasComparison.sol` contract.
- `eip2935GasComparison.s.sol` - A solidity script used to deploy the `eip2935GasComparison.sol` and make calls to it to simulate different blockhash reading methods.
- `run_gas_comparison.sh` - A bash script created to deploy `eip2935GasComparison.sol` and tabulate the gas expenditure results.

### Requirements

Make sure you have the following installed on your computer before we begin:

- Foundry (Foirge & Cast): v1.0.0 or greater
- Solidity: version ^0.8.29

If you have not installed these before, simply follow the commands below:

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup  # Ensures you have the latest version (with solc auto-install support)
```

If you've already installed Foundry, just run:

```bash
foundryup
```

> This guide requires Solidity ^0.8.29. `forge build` will automatically download the right version if you're using a modern `forge` via `foundryup`.

Next, go through the following steps to setup your dependencies and `.env`.

### Step 1 - Install Dependencies


```bash
cd apps/eip-2935-gas-comparison
```

```bash
# FROM ./
pnpm install && cp .env.example .env
```

> ℹ️ forge install pulls in required dependencies like forge-std. Don’t skip it.

```bash
# FROM ./
forge install && forge build
```

### Step 2 - Run Forge Tests

The majority of this guide will go through running tests against an anvil fork. Of course, running unit tests is important for the development cycle in the beginning. We have provided quick foundry tests to showcase checks that the example implementation contract, `eip2935GasComparison.sol`, is functioning properly before testing against anvil forks or on actual networks.

> NOTE: The tests in this guide are setup to test against a Bepolia fork-url because the typical foundry EVM environment does not reflect EIP-2935 (and the needed system contract), and the other Bectra upgrades.

Run tests by running:

```bash-vue
# FROM: ./
source .env && forge test --fork-url $BEPOLIA_RPC_URL --fork-block-number 5045482
```

You should see an ouput showcasing the tests passing:

```bash
[⠊] Compiling...
[⠔] Compiling 1 files with Solc 0.8.29
[⠒] Solc 0.8.29 finished in 426.77ms
Compiler run successful!

Ran 4 tests for test/eip2935GasComparison.t.sol:GasComparisonTest
[PASS] testBlock() (gas: 2515)
[PASS] testGas_OracleSubmission() (gas: 39693)
[PASS] testGas_ReadWithGet() (gas: 41618)
[PASS] testGas_ReadWithSLOAD() (gas: 59398)
Suite result: ok. 4 passed; 0 failed; 0 skipped; finished in 1.05ms (679.63µs CPU time)

Ran 1 test suite in 278.65ms (1.05ms CPU time): 4 tests passed, 0 failed, 0 skipped (4 total tests)
```

The pertinent tests to ensure that `eip2935GasComparison.sol` implementation is functioning properly includes:

- `testGas_OracleSubmission()`: Checking that the oracle-based pattern methods for obtaining blockhash history and inherent historic data functions
- `testGas_ReadWithGet()`: Checking the usage of the system contract as per EIP2935 for obtaining historic blockhashes
- `testGas_ReadWithSLOAD()`: Checking that the SSTORE and SLOAD pattern methods for storing and obtaining blockhash history, respectively, functions properly

Now we can move onto testing with an actual script either against an anvil network or an actual network.

### Step 3 - Start Your Anvil Fork

Run the following command to deploy a local anvil fork via your terminal. You need to specify the block number shown below to ensure that the EIP2935 system contract will function properly to reflect being activated after Bectra upgrades on Bepolia.

```bash-vue
# FROM: ./
source .env && anvil --fork-url $BEPOLIA_RPC_URL --fork-block-number 4867668 --chain-id 80069 --port 8545
```

### Step 4 - Update Your `.env` and Deploy `eip2935GasComparison.sol` Implementation

Now that you have an Anvil fork running, open up another terminal window and continue. Next you'll run a script on the local bepolia Anvil fork.

Update your `.env` with your `EOA_PRIVATE_KEY` and make sure it has enough $tBERA for deployment. A single $tBERA should be more than enough.

```bash
# FROM: ./

./script/run_gas_comparison.sh

```

#### Expected Similar Results:

After running `run_gas_comparison.sh` you should see results like the following in your terminal:

```bash
./script/run_gas_comparison.sh
🔧 Running eip2935GasComparison.s.sol script...
No files changed, compilation skipped
Warning: EIP-3855 is not supported in one or more of the RPCs used.
Unsupported Chain IDs: 80069.
Contracts deployed with a Solidity version equal or higher than 0.8.20 might not work properly
.                                                                                             For more information, please see https://eips.ethereum.org/EIPS/eip-3855
Traces:
  [507107] eip2935GasComparison::run()
    ├─ [0] VM::startBroadcast()
    │   └─ ← [Return]
    ├─ [412864] → new BlockhashConsumer@0x59ef61D43bdAF8B1257071a2035Ef5789f46463f
    │   └─ ← [Return] 2062 bytes of code
    ├─ [0] console::log("Consumer contract deployed at: %s", BlockhashConsumer: [0x59ef61D43bd
AF8B1257071a2035Ef5789f46463f]) [staticcall]                                                      │   └─ ← [Stop]
    ├─ [0] console::log("Current block: %s", 4867668 [4.867e6]) [staticcall]
    │   └─ ← [Stop]
    ├─ [22677] BlockhashConsumer::storeWithSSTORE(4867666 [4.867e6])
    │   └─ ← [Stop]
    ├─ [6497] BlockhashConsumer::readWithGet(4867666 [4.867e6]) [staticcall]
    │   ├─ [2225] 0x0000F90827F1C53a10cb7A02335B175320002935::00000000(00000000000000000000000
0000000000000000000000000004a4652) [staticcall]                                                   │   │   └─ ← [Return] 0x713825db1a93b11015ba43eb0eea7005c55c7b98375dda1961cc9c3c96d03c0b
    │   └─ ← [Return] 0x713825db1a93b11015ba43eb0eea7005c55c7b98375dda1961cc9c3c96d03c0b
    ├─ [22784] BlockhashConsumer::submitOracleBlockhash(4867666 [4.867e6], 0x713825db1a93b1101
5ba43eb0eea7005c55c7b98375dda1961cc9c3c96d03c0b)                                                  │   └─ ← [Stop]
    ├─ [0] VM::stopBroadcast()
    │   └─ ← [Return]
    └─ ← [Stop]


Script ran successfully.

== Logs ==
  Consumer contract deployed at: 0x59ef61D43bdAF8B1257071a2035Ef5789f46463f
  Current block: 4867668

## Setting up 1 EVM.
==========================
Simulated On-chain Traces:

  [412864] → new BlockhashConsumer@0x59ef61D43bdAF8B1257071a2035Ef5789f46463f
    └─ ← [Return] 2062 bytes of code

  [22677] BlockhashConsumer::storeWithSSTORE(4867666 [4.867e6])
    └─ ← [Stop]

  [22784] BlockhashConsumer::submitOracleBlockhash(4867666 [4.867e6], 0x713825db1a93b11015ba43
eb0eea7005c55c7b98375dda1961cc9c3c96d03c0b)                                                       └─ ← [Stop]


==========================

Chain 80069

Estimated gas price: 20.000000014 gwei

Estimated total gas used for script: 771474

Estimated amount required: 0.015429480010800636 BERA

==========================

##### berachain-bepolia
✅  [Success] Hash: 0x04112af6eee2ec29d1647353a2854e803d360856db00f7e65267bd5640958daa
Contract Address: 0x59ef61D43bdAF8B1257071a2035Ef5789f46463f
Block: 4867669
Paid: 0.009934880003477208 ETH (496744 gas * 20.000000007 gwei)


##### berachain-bepolia
✅  [Success] Hash: 0x08e8aa80c9e97fef47566f56215969536631228ba0f37fecd54bbb44fe5a6bd1
Block: 4867670
Paid: 0.000878100000307335 ETH (43905 gas * 20.000000007 gwei)


##### berachain-bepolia
✅  [Success] Hash: 0xa098ac84c403a04265ba3657a177382957547201eea8360564335e0a6b5fe4af
Block: 4867670
Paid: 0.000890480000311668 ETH (44524 gas * 20.000000007 gwei)

✅ Sequence #1 on berachain-bepolia | Total Paid: 0.011703460004096211 ETH (585173 gas * avg 2
0.000000007 gwei)                                                                                                                                                                           

==========================

ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.

Transactions saved to: ichiraku/guides/apps/eip-
2935-gas-comparison/broadcast/eip2935GasComparison.s.sol/80069/run-latest.json                
Sensitive values saved to: ichiraku/guides/apps/
eip-2935-gas-comparison/cache/eip2935GasComparison.s.sol/80069/run-latest.json                
✅ Script execution complete. Parsing gas usage...

📄 Table saved to gas_comparison.md


# EIP-2935 Gas Comparison

| Pattern                             | Methods Involved                         | Total Gas |
|-------------------------------------|------------------------------------------|-----------|
| Before EIP-2935: SSTORE pattern     | storeWithSSTORE(...)                     |     45354 |
| After EIP-2935: .get() access       | readWithGet(...)                         |      6497 |
| Before EIP-2935: Oracle pattern     | submitOracleBlockhash(...)               |     45568 |

```

### Step 5 - Understanding What the Script Does

The bash script, `run_gas_comparison.sh` deploys the `eip2935GasComparison.sol` contract on the locally ran anvil fork of Bepolia. It then goes through the results and tabulates the total gas expenses for each blockhashing method, including storing the blockhash or replicating the usage of an oracle.

### Step 6 - Highlevel Review of the Solidity File

This project demonstrates and benchmarks different blockhash access patterns:

1. Manual SSTORE of blockhash (pre-EIP-2935 workaround) and direct SLOAD readback of stored hash
2. EIP-2935-style .get() call to a mock system contract
3. Oracle-submitted blockhash pattern simulating offchain access

You can see the details of the code in `eip2935GasComparison.sol`.

> It is very important to note that the system contract only receives the `calldata`, and there is no specification of the function signature or anything. See the explaination below. You can see this more within the `eip2935GasComparison.sol` `readWithGet()` function.

### Step 7 - Assessing the Results

The table is output in `gas_comparison.md` at the root of this subdirectory, where we can see the gas savings when comparing one method to the next.

Below is an example output that you ought to see when running the bash script:

| Pattern                         | Methods Involved                                | Total Gas |
| ------------------------------- | ----------------------------------------------- | --------- |
| Before EIP-2935: SSTORE pattern | storeWithSSTORE(...), readWithSLOAD(...)        | 46210     |
| After EIP-2935: .get() access   | readWithGet(...)                                | 6494      |
| Before EIP-2935: Oracle pattern | submitOracleBlockhash(...), readFromOracle(...) | 46338     |

Simply reading the blockhash from the system contract resulted in significantly less gas expenditure compared to the other methods typically used before EIP-2935. A table showcasing the savings can be seen below when comparing against the new method of just reading from the system contract.

| Pattern                         | Total Gas | Savings vs. `.get()` | % Saved Compared to `.get()` |
| ------------------------------- | --------- | -------------------- | ---------------------------- |
| Before EIP-2935: SSTORE pattern | 46,210    | 39,716               | 85.95%                       |
| Before EIP-2935: Oracle pattern | 46,338    | 39,844               | 86.00%                       |
| After EIP-2935: .get() access   | 6,494     | —                    | —                            |

> It should be noted that if carrying out any of these calls cold results in the gas expenditures above, and warm calls will be less. The comparative analysis still stands even with this in mind.

🐻🎉 Congrats! You have finished the guide and have now seen the gas savings that come about with EIP-2935 when accessing historical blockhashes.
