# Berachain Docker Local Devnet

This repository will run a local devnet on your computer to test different contracts locally.
This is currently configured to run BeaconKit as a consensus client and Reth as an execution client.

> **NOTE:** This local devnet only includes the [BeaconDeposit](https://github.com/berachain/contracts/blob/main/src/pol/BeaconDeposit.sol) contract and DOES NOT include the other [PoL contracts](https://github.com/berachain/contracts/tree/main/src/pol).

## Requirements

- Docker version 28.0.1 or greater
- Linux or MacOS (Intel/AMD64 or ARM64)
- EVM Wallet (To import private key)

## Supported Platforms

- Linux (x86 and arm)
- MacOS (arm)

## RPC Details

| Name               | Value                                                            |
| ------------------ | ---------------------------------------------------------------- |
| RPC URL            | http://localhost:8545                                            |
| Chain ID           | 80069                                                            |
| Currency Symbol    | BERA                                                             |
| Decimals           | 18                                                               |
| Wallet Address     | 0x20f33CE90A13a4b5E7697E3544c3083B8F8A51D4                       |
| Wallet Private Key | fffdbb37105441e14b0ee6330d855d8504ff39e705c3afa8f859ac9865f99306 |

## Quick Start

```bash
# FROM: ./

# Build containers needed
./build.sh;

# Start containers based `env.sh` settings
./start.sh;

# Give a second to start building blocks
sleep 2;

# Test all execution clients to ensure communicating with each other and blocks are building
./test.sh;

# Confirm RPC working
curl -s --location 'http://localhost:8545' \
--header 'Content-Type: application/json' \
--data '{
  "jsonrpc": "2.0",
  "method": "eth_blockNumber",
  "params": [],
  "id": 420
}' | jq;

# Confirm cometbft api
curl -s --location 'http://localhost:26657/net_info' | jq .result.n_peers;

# [Expected Result]:
# "3"

# Confirm node api
curl -s --location 'http://localhost:3500/eth/v2/debug/beacon/states/head' | jq .data.latest_block_header.slot;

# [Expected Similar Result]:
# "0x11" (Non 0x0 number)
```

## Watch For Deposits

If `NUM_RPC_NODES` is greater than 0 and you are running the `generate-deposit-tx.sh` script, this is a good way to track whether deposits are being registered correctly.

```bash
# FROM: /
source ./env.sh;

docker logs $EL_MONIKER-rpc-0 -f;
```

## Clean Up

```bash
# FROM: /

./clean.sh;
```

## Generate Deposits

This functionality allows interaction with the BeaconDeposit contract to convert an existing RPC full node into a Validator node.

> **NOTE:** Requires `NUM_RPC_NODES` of at least one in `env.sh`

### Step 1 - Generate Transaction Commands & Monitor

**Terminal 1:**

In another terminal, run the following command to watch for deposits:

```bash
# FROM: /

source ./env.sh;

docker logs $CL_MONIKER-rpc-0 -f | grep deposit;
```

**Terminal 2:**

```bash
# FROM: /

./generate-deposit-tx.sh;

# [Expected Similar Result]:
# 0 - Retrieving Validator Pubkey & Verifying Not A Validator...
# ...
# 2 - Preparing Registration Deposit Transaction...
#
# Send this command to register the validator:
#
# cast send 0x4242424242424242424242424242424242424242... <---- FIRST CAST COMMAND
#
# 3 - Preparing Activation Deposit Transaction...
#
# Send this command to activate the validator:
#
# cast send 0x4242424242424242424242424242424242424242... <---- SECOND CAST COMMAND
```

### Step 2 - Perform Registration Deposit Transaction

Copy the first `cast` command and run it:

> **NOTE:** If you get an error message, please see the [IDepositContract.sol](https://github.com/berachain/beacon-kit/blob/81f64a569669fea9d88ea6107e52dd1bd6d93da7/contracts/src/staking/IDepositContract.sol#L11) for all error signatures.

**Terminal 2:**

```bash
# FROM: /

# Example - Registration
cast send 0x4242424242424242424242424242424242424242 'deposit(bytes,bytes,bytes,address)' 0x9047a1333a717ee3178bdc9190120021c3b325a2de6b0b18c22d72543d89af89726a5fdbc02eedb6f2ce333745e5af8e 0x01000000000000000000000020f33ce90a13a4b5e7697e3544c3083b8f8a51d4 0xa405b8bd8a4258b9e63626e210e53893cd4580659bcea4db6eb211432e59dad84c21f0768bfee290329effaf3d1cefc91695a464ae2b3a7c5fa47f320004f29e55ae1245215640c1776e11a886477332b2ddaa4b64bb2cc0838659e216a22591 0x9BcaA41DC32627776b1A4D714Eef627E640b3EF5 --value 10000ether --private-key fffdbb37105441e14b0ee6330d855d8504ff39e705c3afa8f859ac9865f99306 --rpc-url http://127.0.0.1:8545;

# [Expected Similar Result]:
# blockHash            0x55aa03b82660f6683c61dba0b15158bd880150f3a186c9122bd1d916f5295472
# blockNumber          285
# contractAddress
# ...
```

Immediately you should see the deposit made in **Terminal 1**:

> **NOTE:** If you receive `signer returned an invalid signature invalid deposit message`, DO NOT continue making deposits with the same pubkey as it will result in loss of funds. You will need to create an entirely new node pubkey to go through the process again.

```bash
# ✅ [Example Successful Deposit]:
#
# 2025-04-11T09:49:27Z INFO Found deposits on execution layer service=blockchain block=0x14 deposits=1
# 2025-04-11T09:49:29Z INFO Processed deposit to set Eth 1 deposit index service=state-processor previous=3 new=4
# 2025-04-11T09:49:29Z INFO Validator does not exist so creating service=state-processor pubkey=0xaef436c629e02ebc812a7526fb6a66c17b6a2344efc5aeaaa633b15bded1370fbebe4a9aef6071e2d6f9ee3cb985965f index=0x3 deposit_amount=0x9184e72a000
# 2025-04-11T09:49:29Z INFO Processed deposit to create new validator service=state-processor deposit_amount=10000 validator_index=0x3 # withdrawal_epoch=0xffffffffffffffff
# 2025-04-11T09:49:29Z INFO Processed deposit to set Eth 1 deposit index service=state-processor previous=3 new=4
# 2025-04-11T09:49:29Z INFO Validator does not exist so creating service=state-processor pubkey=0xaef436c629e02ebc812a7526fb6a66c17b6a2344efc5aeaaa633b15bded1370fbebe4a9aef6071e2d6f9ee3cb985965f index=0x3 deposit_amount=0x9184e72a000
# 2025-04-11T09:49:29Z INFO Processed deposit to create new validator service=state-processor deposit_amount=10000 validator_index=0x3 withdrawal_epoch=0xffffffffffffffff
#
# ❌ [Example Invalid Deposit]:
#
# 2025-04-11T09:52:37Z INFO Found deposits on execution layer service=blockchain block=0xf deposits=1
# 2025-04-11T09:52:38Z INFO Processed deposit to set Eth 1 deposit index service=state-processor previous=3 new=4
# 2025-04-11T09:52:38Z INFO Validator does not exist so creating service=state-processor pubkey=0xa4bd74c3705152c8022800e0728f0a8083c0672e957f19947a69435563b56e324643a9cb46adbc0afd9b4851ba2ea0ac index=0x3 deposit_amount=0x9188a0d6a00
# 2025-04-11T09:52:38Z WARN failed deposit signature verification service=state-processor pubkey=0xa4bd74c3705152c8022800e0728f0a8083c0672e957f19947a69435563b56e324643a9cb46adbc0afd9b4851ba2ea0ac deposit_index=0x3 amount_gwei=10001000000000 error=signer returned an invalid signature
# invalid deposit message
# 2025-04-11T09:52:38Z INFO Processed deposit to set Eth 1 deposit index service=state-processor previous=3 new=4
# 2025-04-11T09:52:38Z INFO Validator does not exist so creating service=state-processor pubkey=0xa4bd74c3705152c8022800e0728f0a8083c0672e957f19947a69435563b56e324643a9cb46adbc0afd9b4851ba2ea0ac index=0x3 deposit_amount=0x9188a0d6a00
# 2025-04-11T09:52:38Z WARN failed deposit signature verification service=state-processor pubkey=0xa4bd74c3705152c8022800e0728f0a8083c0672e957f19947a69435563b56e324643a9cb46adbc0afd9b4851ba2ea0ac deposit_index=0x3 amount_gwei=10001000000000 error=signer returned an invalid signature
# invalid deposit message
```

You can see the immediate deposit of `10000` made in the P2P port:

> **NOTE:** This indicates that the validator deposit has been made and has contributed to its effective balance.

**Terminal 2:**

```bash
# FROM: /

source env.sh;
COMETBFT_PUB_KEY=$(docker exec $CL_MONIKER-rpc-0 ./beacond deposit validator-keys|tail -1);
curl -s http://localhost:3500/eth/v2/debug/beacon/states/head | jq -r ".data.validators[] | select(.pubkey == \"$COMETBFT_PUB_KEY\")";

# [Expected Similar Result]:
# {
#   "pubkey": "0x9047a1333a717ee3178bdc9190120021c3b325a2de6b0b18c22d72543d89af89726a5fdbc02eedb6f2ce333745e5af8e",
#   "withdrawalCredentials": "0x01000000000000000000000020f33ce90a13a4b5e7697e3544c3083b8f8a51d4",
#   "effectiveBalance": "0x9184e72a000", <----- 10,000
#   "slashed": false,
#   "activationEligibilityEpoch": "0xffffffffffffffff",
#   "activationEpoch": "0xffffffffffffffff",
#   "exitEpoch": "0xffffffffffffffff",
#   "withdrawableEpoch": "0xffffffffffffffff"
# }
```

You should see the validator status shown as `pending_initialized`:

**Terminal 2:**

```bash
# FROM: /

source env.sh;
COMETBFT_PUB_KEY=$(docker exec $CL_MONIKER-rpc-0 ./beacond deposit validator-keys|tail -1);
curl -s http://localhost:3500/eth/v1/beacon/states/head/validators | jq ".data[] | select(.validator.pubkey == \"$COMETBFT_PUB_KEY\")";

# [Expected Similar Result]:
# {
#   "index": "3",
#   "balance": "10000000000000",
#   "status": "pending_initialized",
#   "validator": {
#     "pubkey": "0x9047a1333a717ee3178bdc9190120021c3b325a2de6b0b18c22d72543d89af89726a5fdbc02eedb6f2ce333745e5af8e",
#     "withdrawal_credentials": "0x01000000000000000000000020f33ce90a13a4b5e7697e3544c3083b8f8a51d4",
#     "effective_balance": "10000000000000",
#     "slashed": false,
#     "activation_eligibility_epoch": "18446744073709551615",
#     "activation_epoch": "18446744073709551615",
#     "exit_epoch": "18446744073709551615",
#     "withdrawable_epoch": "18446744073709551615"
#   }
# }
```

### Step 3 - Perform Activation Transaction

Copy the second `cast` command and run it:

**Terminal 2:**

```bash
# FROM: /

# Example - Activation
cast send 0x4242424242424242424242424242424242424242 'deposit(bytes,bytes,bytes,address)' 0xad56e3dbcd056163639bb132dc14842710d26950a68efb45ac02cf31d75622732eb750128cdeb16f1b08be89552cf0cc 0x0000000000000000000000000000000000000000000000000000000000000000 0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000 0x0000000000000000000000000000000000000000 --private-key fffdbb37105441e14b0ee6330d855d8504ff39e705c3afa8f859ac9865f99306 --value 240000ether --rpc-url http://127.0.0.1:8545;

# [Expected Similar Result]:
# blockHash            0xad08fe68248dae40c72e9d517b90d22e262601549f28cdc5858c61e54f147a75
# blockNumber          140
# contractAddress
# ...
```

See the immediate deposit contribution of `240000` made in the P2P port:

**Terminal 2:**

```bash
# FROM: /

source env.sh;
COMETBFT_PUB_KEY=$(docker exec $CL_MONIKER-rpc-0 ./beacond deposit validator-keys|tail -1);
curl -s http://localhost:3500/eth/v2/debug/beacon/states/head | jq -r ".data.validators[] | select(.pubkey == \"$COMETBFT_PUB_KEY\")";

# [Expected Similar Result]:
# {
#   "pubkey": "0x9047a1333a717ee3178bdc9190120021c3b325a2de6b0b18c22d72543d89af89726a5fdbc02eedb6f2ce333745e5af8e",
#   "withdrawalCredentials": "0x01000000000000000000000020f33ce90a13a4b5e7697e3544c3083b8f8a51d4",
#   "effectiveBalance": "0xe35fa931a000", <----- 250,000
#   "slashed": false,
#   "activationEligibilityEpoch": "0xffffffffffffffff",
#   "activationEpoch": "0xffffffffffffffff",
#   "exitEpoch": "0xffffffffffffffff",
#   "withdrawableEpoch": "0xffffffffffffffff"
# }
```

Keep running this command and you will observe the following state transitions:

- After ~7 minutes: `pending_initialized` → `pending_queued`
- After ~12 minutes: `pending_queued` → `active_ongoing` (Validator becomes fully activated and begins proposing blocks)

**Terminal 2:**

```bash
# FROM: /

source env.sh;
COMETBFT_PUB_KEY=$(docker exec $CL_MONIKER-rpc-0 ./beacond deposit validator-keys|tail -1);
curl -s http://localhost:3500/eth/v1/beacon/states/head/validators | jq ".data[] | select(.validator.pubkey == \"$COMETBFT_PUB_KEY\")";

# [Expected Similar Result]:
# {
#   "index": "3",
#   "balance": "250000000000000",
#   "status": "pending_initialized",
#   "validator": {
#     "pubkey": "0x9047a1333a717ee3178bdc9190120021c3b325a2de6b0b18c22d72543d89af89726a5fdbc02eedb6f2ce333745e5af8e",
#     "withdrawal_credentials": "0x01000000000000000000000020f33ce90a13a4b5e7697e3544c3083b8f8a51d4",
#     "effective_balance": "10000000000000",
#     "slashed": false,
#     "activation_eligibility_epoch": "18446744073709551615",
#     "activation_epoch": "18446744073709551615",
#     "exit_epoch": "18446744073709551615",
#     "withdrawable_epoch": "18446744073709551615"
#   }
# }
```
