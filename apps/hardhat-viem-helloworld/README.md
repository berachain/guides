# Berachain Create HelloWorld Contract Using Hardhat Viem

This Berachain guided repository will show you the configurations needed to setup Berachain testnet with Hardhat viem, deploy, and verify the contract.

## Requirements

- NVM or Node `v18.18.2+`
- MetaMask Wallet With `BERA` tokens
- pnpm (recommended)

## Quick Setup

Install dependencies:

```bash
# FROM ./create-helloworld-contract-using-hardhat

pnpm install; # or npm install or yarn install
```

Configure environment variables.

```bash
# FROM ./create-helloworld-contract-using-hardhat

cp .env.example .env;
```

The only variable you will need to set is the `WALLET_PRIVATE_KEY` for the Berachain network.

**File:** `.env`

```bash
# Replace this ↴
WALLET_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

## Deploy Contract To Berachain

When your `WALLET_PRIVATE_KEY` is setup correctly, run the following to compile and deploy the contract.

```bash
# FROM ./create-helloworld-contract-using-hardhat

pnpm run compile; # npx hardhat compile;

# [Expected Output]:
# Compiled 1 Solidity file successfully (evm target: paris).

pnpm run deploy:berachain; # npx hardhat run scripts/deploy.ts --network berachainTestnet;

# [Expected Equivalent Output]:
# {
#   hash: '0xe6698c10e76ac89365aae141946ee8bdfef5c62b0030571155f0a934fecafd7f'
# }
# HelloWorld deployed to 0xe9470c884603c239502c4d92d108a5b3f14074b4
```

## Verify Contract On Berachain

In order to verify your contract, take note of the deployed contract `address` and the initial argument message deployed with it `"Hello From Deployed Contract"`.

```bash
# FROM ./create-helloworld-contract-using-hardhat

# npx hardhat verify --network berachainTestnet 0xe9470c884603c239502c4d92d108a5b3f14074b4 "Hello From Deployed Contract";
pnpm run verify 0xe9470c884603c239502c4d92d108a5b3f14074b4 "Hello From Deployed Contract";

# [Expected Output]:
# Successfully submitted source code for contract
# contracts/HelloWorld.sol:HelloWorld at 0xe9470c884603c239502c4d92d108a5b3f14074b4
# for verification on the block explorer. Waiting for verification result...

# Successfully verified contract HelloWorld on the block explorer.
# https://scan.berachain-internal.com/address/0xe9470c884603c239502c4d92d108a5b3f14074b4#code
```

## Run Local Node

If you'd like to run the contract locally with Hardhat, run the following commands:

**Terminal 1:**

```bash
# FROM ./create-helloworld-contract-using-hardhat

pnpm run node; # npx hardhat node;

# [Expected Output]:
# Started HTTP and WebSocket JSON-RPC server at http://127.0.0.1:8545/
#
# Accounts
# ========
#
# WARNING: These accounts, and their private keys, are publicly known.
# Any funds sent to them on Mainnet or any other live network WILL BE LOST.
# ...
```

**Terminal 2:**

```bash
# FROM ./create-helloworld-contract-using-hardhat

pnpm run deploy:localhost; # npx hardhat run scripts/deploy.ts --network localhost;

# [Expected Output]:
# HelloWorld deployed to 0x5fbdb2315678afecb367f032d93f642f64180aa3
```

## Run Tests

To run tests defined in `./test/HelloWorld.test.ts`, run the following:

```bash
# FROM ./create-helloworld-contract-using-hardhat

pnpm run test; # npx hardhat test;

# [Expected Output]:
#  HelloWorld
#    Deployment
#      ✔ Should deploy with original message (1929ms)
#      ✔ Should set a new message
#
#
#  2 passing (2s)
```
