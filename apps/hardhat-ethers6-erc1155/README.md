# Berachain Create ERC1155 Contract Using Hardhat Ethers6

This Berachain guided repository will show you the configurations needed to setup Berachain testnet with Hardhat ethers, deploy, and verify the contract.

## Requirements

- NVM or Node `v18.18.2+`
- MetaMask Wallet With `BERA` tokens
- pnpm (recommended)

## Quick Setup

Install dependencies:

```bash
# FROM ./create-erc1155-contract-using-hardhat-ethers6

pnpm install; # or npm install or yarn install
```

Configure environment variables.

```bash
# FROM ./create-erc1155-contract-using-hardhat-ethers6

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

> NOTE: Make sure you've got enough gas in your wallet for deployment.

```bash
# FROM ./create-erc1155-contract-using-hardhat-ethers6

pnpm run compile; # npx hardhat compile;

# [Expected Output]:
# Compiled 1 Solidity file successfully (evm target: paris).

pnpm run deploy:berachain; # npx hardhat run scripts/deploy.ts --network berachainTestnet;

# [Expected Equivalent Output]:
# {
#   hash: '0xe6698c10e76ac89365aae141946ee8bdfef5c62b0030571155f0a934fecafd7f'
# }
# OogaBoogaNFT deployed to 0xe9470c884603c239502c4d92d108a5b3f14074b4
```

## Verify Contract On Berachain

In order to verify your contract, take note of the deployed contract `address` and the initial argument message deployed with it `"Hello From Deployed Contract"`.

```bash
# FROM ./create-erc1155-contract-using-hardhat-ethers6

# npx hardhat verify --network berachainTestnet 0xe9470c884603c239502c4d92d108a5b3f14074b4 "https://example.com" "0x012456..";
pnpm run verify 0xe9470c884603c239502c4d92d108a5b3f14074b4 "YOUR-UNIQUE-BASE-URL-FOR-HOLDING-JSON-FILES-WITH-SLASH-AT-THE-END" "0xYOUR_WALLET_ADDRESS";

# [Expected Output]:
# Successfully submitted source code for contract
# contracts/OogaBoogaNFT.sol:OogaBoogaNFT at 0xe9470c884603c239502c4d92d108a5b3f14074b4
# for verification on the block explorer. Waiting for verification result...

# Successfully verified contract OogaBoogaNFT on the block explorer.
# https://scan.berachain-internal.com/address/0xe9470c884603c239502c4d92d108a5b3f14074b4#code
```

## Run Local Node

If you'd like to run the contract locally with Hardhat, run the following commands:

**Terminal 1:**

```bash
# FROM ./create-erc1155-contract-using-hardhat-ethers6

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
# FROM ./create-erc1155-contract-using-hardhat-ethers6

pnpm run deploy:localhost; # npx hardhat run scripts/deploy.ts --network localhost;

# [Expected Output]:
# OogaBoogaNFT deployed to 0x5fbdb2315678afecb367f032d93f642f64180aa3
```

## Run Tests

To run tests defined in `./test/OogaBoogaNFT.test.ts`, run the following:

```bash
# FROM ./create-erc1155-contract-using-hardhat-ethers6

pnpm run test; # npx hardhat test;

# [Expected Output]:
#  OogaBoogaNFT
#    Deployment
#      ✔ Should deploy with original message (1929ms)
#      ✔ Should set a new message
#
#
#  2 passing (2s)
```
