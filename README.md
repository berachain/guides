# Berachain Guides

A collection of [Berachain](https://docs.berachain.com/learn/) EVM examples: code, frameworks, languages, contracts, and more.

> **⚠️ Important Note:** This repository contains largely sample code provided by ecosystem partners. The code is not fully maintained for correctness and security patches, and is intended to be adapted and customized for your own projects. Please review and test thoroughly before using in production environments.

## Shared Packages

This monorepo includes shared packages that power the examples:

- **[`packages/rpc-config`](packages/rpc-config)** - Centralized configuration for Berachain networks, RPC URLs, and utility functions
- **[`packages/eslint-config`](packages/eslint-config)** - Shared ESLint configuration for consistent code style
- **[`packages/typescript-config`](packages/typescript-config)** - Shared TypeScript configuration for all apps
- **[`packages/ui`](packages/ui)** - Shared UI components and styles for frontend applications 

## Quick Start

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Set up environment variables:

   ```bash
   cp .env.example .env
   ```

3. Deploy a contract:
   ```bash
   # Deploy ERC20 contract
   pnpm deploy:berachain --filter foundry-erc20 --no-cache
   ```

## Getting Started

Choose your development path by exploring the apps organized by category:

### 🔗 **Wallet Integration & Authentication**
- **[WalletConnect + Next.js](apps/walletconnect-nextjs)** - Complete wallet connection with transaction signing
- **[WalletConnect + Expo](apps/walletconnect-expo)** - Mobile wallet integration for React Native
- **[RainbowKit + Vite](apps/rainbowkit-vite)** - Modern wallet connector with Rainbow theming
- **[Particle Auth Core](apps/particle-auth-core-vite)** - Social login with embedded MPC wallets
- **[ThirdWeb Connect](apps/thirdweb-connectwallet-nextjs)** - Simplified wallet connection with ThirdWeb SDK

### 🏗️ **Smart Contract Development**
- **[Foundry ERC20](apps/foundry-erc20)** - Basic token contract deployment with Foundry
- **[Hardhat + Ethers v6](apps/hardhat-ethers6-erc1155)** - NFT contract with modern Hardhat setup
- **[Viem + Solidity](apps/viem-solc-helloworld)** - Lightweight contract interaction with Viem
- **[Ethers v6 + Solidity](apps/ethers6-solc-helloworld)** - Traditional Ethers.js contract deployment
- **[OpenZeppelin Upgrades](apps/openzeppelin-upgrades)** - Upgradeable contract patterns
- **[Contract Verification](apps/hardhat-contract-verification)** - Verify contracts on Berachain explorers

### 🔍 **Data Indexing & Oracles**
- **[Goldsky Subgraph](apps/goldsky-subgraph)** - Index ERC20 balances with GraphQL queries
- **[Envio Indexer](apps/envio-indexer-erc20)** - Real-time blockchain data indexing
- **[Pyth Oracle](apps/pyth-oracle)** - Integrate real-time price feeds

### 🎲 **DeFi & Automation**
- **[Gelato VRF](apps/gelato-vrf)** - Verifiable random functions for gaming/DeFi
- **[Pyth Entropy](apps/pyth-entropy)** - Random number generation with Pyth Network
- **[Batch Transactions](apps/batch-transactions)** - Efficient multi-call patterns
- **[Berps Bot](apps/berps-bot)** - Automated trading bot example
- **[EIP-7702 Gas Sponsorship](apps/eip-7702-gas-sponsorship)** - Account abstraction with gas sponsorship
- **[LayerZero OFT](apps/layerzero-oft)** - Bridge ERC20 tokens using LayerZero V2

### 🏛️ **Governance**
- **[Governance Proposals](apps/berachain-governance-proposal)** - Create and manage on-chain governance proposals

### 🛠️ **Development Tools**
- **[Local Docker Devnet](apps/local-docker-devnet)** - Complete local Berachain environment with your own validators
- **[Node Scripts](apps/node-scripts)** - Utility scripts for launching Berachain nodes
- **[Monitoring](apps/monitoring)** - Prometheus and Grafana setup for node monitoring
- **[ERPC Proxy Caching](apps/erpc-proxy-caching)** - RPC caching layer for better performance
- **[Irys Bera Node.js](apps/irys-bera-nodejs)** - Decentralized storage integration

Need help getting started? Check out the [Berachain documentation](https://docs.berachain.com/) for network configuration and fundamental concepts!

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
