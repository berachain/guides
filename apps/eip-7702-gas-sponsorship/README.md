---
head:
  - - meta
    - property: og:title
      content: EIP-7702 Gas Sponsorship with Anvil
  - - meta
    - name: description
      content: Set up a quick demo showcasing gas sponsorship on an Anvil fork unlocked by EIP-7702
  - - meta
    - property: og:description
      content: Set up a quick demo showcasing gas sponsorship on an Anvil fork unlocked by EIP-7702
---

# Quickstart: EIP-7702 Gas Sponsorship with Anvil

This quickstart gives you everything you need to simulate gas sponsorship on an Anvil fork using EIP-7702. A comprehensive guide with context on EIP-7702 and gas sponsorship can be found within our [docs](https://docs.berachain.com/developers/).

There are two parts to this guide:

- **Part A**: Use `cast` to simulate a minimal EIP-7702 sponsorship flow with empty calldata.
- **Part B**: Use a full Solidity script to simulate delegation, signer validation, calldata execution, and sponsor reimbursement.

---

### Part A — Minimal Gas Sponsorship with `cast`

EIP-7702 enables an EOA to act like a smart contract for a single tx. Here we use `cast` to demonstrate a sponsor broadcasting a signed EOA transaction.

#### Prerequisites

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

#### Step 1 - Install Deps

```bash
cd apps/eip-7702-gas-sponsorship
```

```bash
# From apps/eip-7702-gas-sponsorship
npm install && cp .env.example .env
```

ℹ️ forge install pulls in required dependencies like forge-std and openzeppelin-contracts. Don’t skip it.

```bash
forge install && forge build
```

#### Step 2 - Start Anvil Fork

```bash
# From apps/eip-7702-gas-sponsorship
anvil --hardfork prague --chain-id 80069 --port 8545
```

#### Step 3 - Deploy SimpleDelegate Implementation and Update `.env`

```bash
source .env && forge script script/Implementation.s.sol:SimpleDelegateScript \
  --rpc-url $TEST_RPC_URL \
  --private-key $EOA_PRIVATE_KEY \
  --broadcast -vvvv \
  | tee deployment.log && \
CONTRACT_ADDRESS=$(grep -Eo '0x[a-fA-F0-9]{40}' deployment.log | tail -n1) && \
sed -i '' "/^CONTRACT_ADDRESS=/d" .env && echo "CONTRACT_ADDRESS=$CONTRACT_ADDRESS" >> .env
```

#### Step 4 - Fetch Nonce and Compute NONCE_TO_USE

```bash
source .env && \
EOA_NONCE=$(cast nonce $EOA_ADDRESS --rpc-url $TEST_RPC_URL) && \
NONCE_TO_USE=$(cast call $CONTRACT_ADDRESS "getNonceToUse(uint256)(uint256)" $EOA_NONCE --rpc-url $TEST_RPC_URL) && \
sed -i '' "/^NONCE_TO_USE=/d" .env && echo "NONCE_TO_USE=$NONCE_TO_USE" >> .env
```

#### Step 5 - Sign EOA TX and Broadcast with Sponsor (Gas Paid by Sponsor)

```bash
EOA_BAL_BEFORE=$(cast balance $EOA_ADDRESS --rpc-url $TEST_RPC_URL) && \
SPONSOR_BAL_BEFORE=$(cast balance $SPONSOR_ADDRESS --rpc-url $TEST_RPC_URL) && \
echo "💰 EOA Balance Before:     $EOA_BAL_BEFORE wei" && \
echo "💸 Sponsor Balance Before: $SPONSOR_BAL_BEFORE wei" && \

# ✍️ Sign EOA authorization
AUTH_SIG=$(cast wallet sign-auth $CONTRACT_ADDRESS \
  --private-key $EOA_PRIVATE_KEY \
  --nonce $NONCE_TO_USE \
  --rpc-url $TEST_RPC_URL) && \

# 📦 Prepare calldata for `execute(...)`
CALLDATA=$(cast calldata "execute((bytes,address,uint256),address,uint256)" \
  "(0x,$CONTRACT_ADDRESS,0)" $SPONSOR_ADDRESS $NONCE_TO_USE) && \

# 🚀 Send the sponsored transaction
TX_HASH=$(cast send $EOA_ADDRESS "$CALLDATA" \
  --private-key $SPONSOR_PRIVATE_KEY \
  --auth "$AUTH_SIG" \
  --rpc-url $TEST_RPC_URL | grep -i 'transactionHash' | awk '{print $2}') && \

# 🧾 Retrieve gas used and cost
RECEIPT=$(cast receipt $TX_HASH --rpc-url $TEST_RPC_URL) && \
GAS_USED=$(echo "$RECEIPT" | grep gasUsed | awk '{print $2}') && \
GAS_PRICE=$(echo "$RECEIPT" | grep effectiveGasPrice | awk '{print $2}') && \
GAS_COST_WEI=$(echo "$GAS_USED * $GAS_PRICE" | bc) && \
GAS_COST_GWEI=$(echo "scale=9; $GAS_COST_WEI / 1000000000" | bc) && \

# 💰 Capture balances after
EOA_BAL_AFTER=$(cast balance $EOA_ADDRESS --rpc-url $TEST_RPC_URL) && \
SPONSOR_BAL_AFTER=$(cast balance $SPONSOR_ADDRESS --rpc-url $TEST_RPC_URL) && \

# 📉 Calculate deltas
EOA_DELTA=$(echo "$EOA_BAL_BEFORE - $EOA_BAL_AFTER" | bc) && \
SPONSOR_DELTA=$(echo "$SPONSOR_BAL_BEFORE - $SPONSOR_BAL_AFTER" | bc) && \

# 🧾 Output Results
echo "📦 Transaction Hash: $TX_HASH" && \
echo "🔍 To view the auth list, run:" && \
echo "source .env && cast tx $TX_HASH --rpc-url $TEST_RPC_URL" && \
echo "To view the receipt and ensure that the transaction was successful or not, run: " && \
echo "source .env && cast receipt $TX_HASH --rpc-url $TEST_RPC_URL" && \
echo "📜 Gas Used: $GAS_USED gas units" && \
echo "💸 Gas Cost: $GAS_COST_WEI wei (~$GAS_COST_GWEI gwei)" && \
echo "💰 EOA Balance After:     $EOA_BAL_AFTER wei" && \
echo "💸 Sponsor Balance After: $SPONSOR_BAL_AFTER wei" && \
echo "📉 EOA Δ:                  $(echo "$EOA_DELTA / 10^9" | bc) Gwei" && \
echo "📉 Sponsor Δ (gas):        $(echo "$SPONSOR_DELTA / 10^9" | bc) Gwei" && \

# 🔬 Gas sanity check
cast receipt $TX_HASH --rpc-url $TEST_RPC_URL | grep -E 'gasUsed|effectiveGasPrice' && \
echo "✅ If sponsor delta roughly equals gasUsed * effectiveGasPrice → gas was paid by SPONSOR."
```

## Step 5 - Assessing the Results

The output from running the last command will provide two `cast` commands to assess the results. If you prefer, just run the following commands though and copy and paste the transaction hash in accordingly.

1. To see the Authorization List and other details signifying that the EIP-7702 transaction was successful, run:

```bash
source .env && cast tx $TX_HASH --rpc-url $TEST_RPC_URL
```

Here you'll see the following:
_Using our example contract address to illustrate, you'll have a different one. Our contract address as seen in the previous screenshot is: 0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82_
Under authorization list, you should see the contract address:

```bash
authorizationList    [{"chainId":"0x138c5","address":"0x0dcd1bf9a1b36ce34237eeafef220932846bcd82","nonce":"0x18","yParity":"0x1","r":"0x5b9ac56625105f2b627f344470290bfa3e5c5b19075ee741f5eedeb3e7288db2","s":"0xaa0bf8139cd82e5de12d33b13c1199444c9bca7f60fa7d577fafc7ddd455511"}]
```

and the `to` specified should be the EOA address, and the `from` address should be the SPONSOR address. These will be the same for you too assuming you followed the guide and are using the anvil test wallets 1 and 2:

```bash
to                   0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
from                 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
```

2. To see the transaction receipt, run:

```bash
source .env && cast receipt $TX_HASH --rpc-url $TEST_RPC_URL
```

Here you can see the gasUsed, as well as that the transaction has successfully passed.

```bash
blockHash            0x4c20dd22bfec22f1a1e7e647a38d2af17087e8a02b39adcd4f77ab96cb985558
blockNumber          2
contractAddress
cumulativeGasUsed    47476
effectiveGasPrice    878700701
from                 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
gasUsed              47476
logs                 []
logsBloom            0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
root
status               1 (success)
transactionHash      0xd8c7c699172330bc68cceff113a188dd146a1460a59aad50ff85dfbd52f91e41
transactionIndex     0
type                 4
blobGasPrice         1
blobGasUsed
to                   0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

Regarding the gas, we can do a check on how much gas was taken from the Sponsor, and how much was reimbursed. We do just that with the previous command you sent where gas logs were output, but of course take what we need and carry out comparisons.

```bash
SPONSOR." sponsor delta roughly equals gasUsed * effectiveGasPrice → gas was paid b
💰 EOA Balance Before:     9999999555915999555916 wei
💸 Sponsor Balance Before: 10000000000000000000000 wei
�� Transaction Hash: 0xd8c7c699172330bc68cceff113a188dd146a1460a59aad50ff85dfbd52f91e41
🔍 To view the auth list, run:
source .env && cast tx 0xd8c7c699172330bc68cceff113a188dd146a1460a59aad50ff85dfbd52f91e41 --rpc-url http://localhost:8545
To view the receipt and ensure that the transaction was successful or not, run:
source .env && cast receipt 0xd8c7c699172330bc68cceff113a188dd146a1460a59aad50ff85dfbd52f91e41 --rpc-url http://localhost:8545
📜 Gas Used: 47476 gas units
💸 Gas Cost: 41717194480676 wei (~41717.194480676 gwei)
💰 EOA Balance After:     9999999555915999555916 wei
💸 Sponsor Balance After: 9999999958282805519324 wei
📉 EOA Δ:                  0 Gwei
📉 Sponsor Δ (gas):        41717 Gwei
effectiveGasPrice    878700701
gasUsed              47476
✅ If sponsor delta roughly equals gasUsed * effectiveGasPrice → gas was paid by SPONSOR.
```

The rough gas used matches the delta (gas spent) from the `SPONSOR` address, whereas the `EOA` has not spent any gas at all.
That's it! Congrats you've walked through a high level example of gas sponsorship using EIP-7702 and Foundry Cast. Feel free to add comments or suggestions on our `guides` repo or reach out via Discord.

---

### Part B — Full Sponsorship Flow with Solidity Script

You have to update your `.env` so you can broadcast properly to Bepolia. You will need to have $tBERA within your wallets that you are using for both the EOA and the SPONSOR.

> If you need $tBERA, you can get some from our [faucet](#step-5---understanding-and-running-the-solidity-script), or contact us directly.

```
# YOUR OWN WALLET DETAILS FOR DEPLOYING TO ACTUAL NETWORKS
EOA_WALLET1_ADDRESS=
EOA_WALLET1_PK=
SPONSOR_WALLET2_ADDRESS=
SPONSOR_WALLET2_PK=
```

Next, run the following commands:

```bash
lsof -i :8545
```

You will see an output listing the PID for the network you launched for Part 1. Now you must kill it so you can relaunch another network at port 8545. Run the following command:

```bash
kill -9 <PID>
```

Now we can start a new `anvil` fork with Bepolia at "hardfork prague."

```bash
source .env && anvil --fork-url $BEPOLIA_RPC_URL --chain-id 80069 --hardfork prague --port 8545
```

Instead of piecing things together with `cast`, we use a full Foundry Solidity script to handle everything: deployment, delegation, authorization, broadcasting, and even checking for replay and signature mismatches. This is a great way to simulate what a service or wallet might actually do when working with EIP-7702.

Using a Foundry Solidity script gives you a lot:

- You get full control over both the EOA and the sponsor inside one flow
- Cheatcodes like `vm.sign`, `vm.envAddress`, `vm.startBroadcast` make this super clean
- You can easily simulate replay, forged signatures, chain ID mismatches
- You can inspect balances, gas deltas, and storage at the EOA address directly

The file is `SimpleDelegatePart2.s.sol`, and the main entry point is the `SimpleDelegate2Script` contract. You can run it using:

```bash
source .env && forge script script/SimpleDelegatePart2.s.sol:SimpleDelegate2Script \
  --rpc-url $TEST_RPC_URL \
  --broadcast -vvvv
```

This script works on a local anvil fork or Bepolia. As mentioned before, just make sure your `.env` has the right test keys and enough $tBERA.

#### What the Script Does

The Solidity script does the entire 7702 lifecycle in one flow:

1. Deploys the `SimpleDelegatePart2` contract
2. Signs a delegation from the EOA to itself
3. Constructs a call to `burnNative()` using the implementation logic
4. Signs the transaction offchain using the EOA private key
5. Has the sponsor broadcast the transaction using `execute(...)`
6. Logs balances, costs, and verifies the result

This is a pretty accurate simulation of how things would work in practice with a wallet frontend, sponsor backend, and protocol logic.

We also run two important tests mentioned before:

- **Replay attack**: Try sending the same tx again → should revert due to `nonceUsed[nonce]` being true.
- **Cross-chain replay**: Try a forged signature using the wrong chain ID → should fail signature recovery.

### Core Lessons in the Script

There are a few key things this script shows:

- `address(this)` inside the implementation contract equals the EOA, since EIP-7702 executes the logic at the EOA's address
- Storage writes like `nonceUsed[nonce] = true` persist at the EOA
- Including `block.chainid` in the digest ensures signatures only work on the intended chain

All of these are things are highly recommended to get right in a production deployment of EIP-7702 sponsorship flows.

### Step 6 - Assessing the New Final Results

The contract has been successfully interacted with at the EOA's address by observing the following:

Below you can see the `to` address is the EOA, the `from` address is the SPONSOR, and the implementation address is seen under the `authorizationList`.

```json
{
  "hash": "0x131051742f94c2fb10422d53d134a78deb41404dd5b47e99cff721dc4eb70b02",
  "transactionType": "CALL",
  "contractName": null,
  "contractAddress": "0x63e6ab65010c695805a3049546ef71e4a242eb6c",
  "function": "execute((bytes,address,uint256),address,uint256,bytes)",
  "arguments": [
    "(0xfbc7c433, 0x63E6ab65010C695805a3049546EF71e4A242EB6C, 10000000000000000)",
    "0x00195EFB66D39809EcE9AaBDa38172A5e603C0dE",
    "17",
    "0xbb7f5ba622d818bb258263974aaa2131dd1dda771c78f88b89152d6b432cfbfe3d02237565c005bb0e6811de03311210e04ec7224d262b2bf7c764b66ce4aff41b"
  ],
  "transaction": {
    "from": "0x00195efb66d39809ece9aabda38172a5e603c0de",
    "to": "0x63e6ab65010c695805a3049546ef71e4a242eb6c",
    "gas": "0x2a7d1",
    "value": "0x6a94d74f430000",
    "input": "0xd65fcb6c000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000195efb66d39809ece9aabda38172a5e603c0de00000000000000000000000000000000000000000000000000000000000000110000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000006000000000000000000000000063e6ab65010c695805a3049546ef71e4a242eb6c000000000000000000000000000000000000000000000000002386f26fc100000000000000000000000000000000000000000000000000000000000000000004fbc7c433000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000041bb7f5ba622d818bb258263974aaa2131dd1dda771c78f88b89152d6b432cfbfe3d02237565c005bb0e6811de03311210e04ec7224d262b2bf7c764b66ce4aff41b00000000000000000000000000000000000000000000000000000000000000",
    "nonce": "0x2",
    "chainId": "0x138c5",
    "authorizationList": [
      {
        "chainId": "0x138c5",
        "address": "0xddb11edb9498e778d783e1514519631db978cefe",
        "nonce": "0x7",
        "yParity": "0x1",
        "r": "0xd304ce7ae24007d5f367dd397030c92686c7a10180c8094825736854a96be633",
        "s": "0x1c304881690f634b1a2f9192137097d0e7e37d27538353f26446368925e0c2e5"
      }
    ]
  },
  "additionalContracts": [],
  "isFixedGasLimit": false
}
```

The output will showcase a successful transaction and a reversion for both `NonceAlreadyUsed()` and `Invalid Signer`.

```bash
[⠊] Compiling...
No files changed, compilation skipped
Warning: Detected artifacts built from source files that no longer exist. Run `forge clean` to make sure builds are in sync w
ith project files.                                                                                                            - /Users/ichiraku/Documents/1-CODE/2-Guides/May-22/guides/apps/eip-7702-gas-sponsorship/script/SimpleDelegatePart2RealDeploy
ment.s.sol                                                                                                                   Warning: EIP-3855 is not supported in one or more of the RPCs used.
Unsupported Chain IDs: 80069.
Contracts deployed with a Solidity version equal or higher than 0.8.20 might not work properly.
For more information, please see https://eips.ethereum.org/EIPS/eip-3855
Script ran successfully.

== Logs ==
  Sponsor balance (wei): 19992485519997369932
  ---- Execution Summary ----
  Sponsor Gas Spent (wei): 996420000348747
  EOA Delta (wei): 0
  Amount reimbursed to Sponsor (wei): 29003579999651253
  ---- Test Case 1: Replay with Same Nonce ----
  Replay failed as expected (nonce already used).
  ---- Test Case 2: Replay with Wrong ChainID ----
  Cross-chain replay failed as expected (invalid chainId in signature).

## Setting up 1 EVM.
  [12323] 0x63E6ab65010C695805a3049546EF71e4A242EB6C::execute{value: 30000000000000000}(Call({ data: 0xfbc7c433, to: 0x63E6ab
65010C695805a3049546EF71e4A242EB6C, value: 10000000000000000 [1e16] }), 0x00195EFB66D39809EcE9AaBDa38172A5e603C0dE, 19, 0x91f3ff0d4999ce2d97ad98d9c78c967e30a17e313941763f726f943d122d6f6d24d01b00050c9cf12c2a060a22c012d70787d07a174b87187b6cd083cc24b59e1b)                                                                                                                              ├─ [3000] PRECOMPILES::ecrecover(0xbaf222251f89c11d41a500b7a405321c85d41d2cbc0a926cdb39d802150a979c, 27, 6601646718486358
1129492900441135972292030061417493464943343716828623890378605, 16650953086154607435429330488942928347914477230191894192328024569607478359454) [staticcall]                                                                                                    │   └─ ← [Return] 0x00000000000000000000000063e6ab65010c695805a3049546ef71e4a242eb6c
    └─ ← [Revert] NonceAlreadyUsed()

  [10049] 0x63E6ab65010C695805a3049546EF71e4A242EB6C::execute{value: 30000000000000000}(Call({ data: 0xfbc7c433, to: 0x63E6ab
65010C695805a3049546EF71e4A242EB6C, value: 10000000000000000 [1e16] }), 0x00195EFB66D39809EcE9AaBDa38172A5e603C0dE, 19, 0x90574dcdf09f26952729cdbede854d50a10d377fb224970f2eb38654c8627f34293347fdd28a3d4396dbd9f7f80f157cc930a6c5b221efd916fb7441614e294d1c)                                                                                                                              ├─ [3000] PRECOMPILES::ecrecover(0xbaf222251f89c11d41a500b7a405321c85d41d2cbc0a926cdb39d802150a979c, 28, 6528730287722426
9808226580710698351715294006742266363989773667897382331907892, 18635432859247198048365968425627914393284181918472378048396876387465699404109) [staticcall]                                                                                                    │   └─ ← [Return] 0x0000000000000000000000001191ad406538b598920074e2197cbe682dc0f449
    └─ ← [Revert] Invalid signer

Error: Simulated execution failed.
```

The below snippit from the output shows chat the EOA successfully burns a small amount of $tBERA, thus showcasing the authorized transaction with an inner call broadcast by the SPONSOR.

```bash
├─ [36698] 0x63E6ab65010C695805a3049546EF71e4A242EB6C::burnNative{value: 10000000000000000}()
│   ├─ [0] 0x000000000000000000000000000000000000dEaD::fallback{value: 10000000000000000}()
│   │   └─ ← [Stop]
│   ├─ emit Burned(from: 0x63E6ab..., amount: 10000000000000000 [1e16])
│   └─ ← [Return]

```

Finally, we have walked through the second part of gas sponsorship. Congrats! In the next gas-sponsorship guide expansion, we will walk through support for ERC20 payment flows.
