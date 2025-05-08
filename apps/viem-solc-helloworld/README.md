# Viem + Solc Hello World

This example demonstrates deploying a Hello World smart contract using Viem and Solc directly, without any framework.

## Prerequisites

- Node.js v20+
- pnpm
- A wallet with some BERA tokens on Berachain Bepolia testnet

## Setup

1. Install dependencies:
```bash
pnpm install
```

2. Set up your environment variables:
```bash
cp .env.example .env
```

Then edit `.env` and add your wallet private key (with 0x prefix):
```
WALLET_PRIVATE_KEY=0x<your-private-key>
```

## Usage

To deploy the contract:
```bash
pnpm deploy:berachain
```

## Project Structure
```
.
├── contracts/           # Solidity contract files
├── scripts/            # Deployment and interaction scripts
├── solc.d.ts          # TypeScript type definitions
└── package.json       # Project dependencies and scripts
```

## Network Details

The contract is deployed to Berachain Bepolia testnet with the following configuration:
- Network Name: Berachain Bepolia
- Chain ID: 80069
- RPC URL: https://bepolia.rpc.berachain.com
- Explorer: https://bepolia.beratrail.io

## Additional Resources

- [Viem Documentation](https://viem.sh)
- [Solc-js Documentation](https://github.com/ethereum/solc-js#readme)
- [Berachain Documentation](https://docs.berachain.com/)
- [@branch/berachain-config Package](../../packages/berachain-config/README.md)

## Detailed Walkthrough

For a detailed explanation of the deployment process and script functionality, see [WALKTHROUGH.md](./WALKTHROUGH.md). 