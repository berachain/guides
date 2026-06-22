# apps = production guides

Developer guides, tools, and production-ready examples for building on Berachain.

## Configuration

Many scripts and tools use shared configuration from `config.js` which provides:

- Network-specific RPC endpoints (mainnet/bepolia) with environment variable overrides
- Validator database integration
- Common helper functions for accessing chain configurations

The configuration file is shared from the parent repository's `exp/config.js`. If you're running scripts that reference `config.js`, you'll need to either:

- Copy `../exp/config.js` to `apps/config.js`, or
- Symlink it: `ln -s ../exp/config.js config.js`

## Tools And Operations

### beralyzer/

Database-backed blockchain indexing and analysis tool tracking validator activity, block proposals, and chain metrics.

### block-scanners/

Suite of blockchain analysis utilities examining blocks, validators, voting patterns, and network performance.

### cometbft-decoder/

Go utility for decoding CometBFT validator addresses and correlating them with on-chain data.

### erpc-proxy-caching/

eRPC proxy configuration for caching and optimizing RPC requests.

### grafana/

Grafana dashboards and Prometheus configuration for monitoring Berachain nodes.

### local-docker-devnet/

Docker-based local Berachain devnet for testing and development.

### node-scripts/

Shell utilities for operating Berachain nodes.

### peer-filter/

Go-based P2P network peer filtering and management tool.

### pol-performance-study/

Analysis tools for studying Proof-of-Liquidity validator performance and reward distribution patterns.

### snapshot-service/

Snapshot generation, publishing, and pruning pipeline for Berachain node snapshots.

### staking-pools/

Staking pool frontend and install-helper scripts.

### validators/

Validator rewards, deposits, allocations, and pubkey utility scripts.

## Smart Contract And DApp Examples

### batch-multiswap/

Vite + wagmi batch multiswap example.

### batch-transactions/

EIP-7702 batch transaction examples demonstrating atomic multi-call patterns.

### berachain-governance-proposal/

Scripts and examples for interacting with Berachain's on-chain governance system.

### berps-bot/

Trading bot implementation for Berps (Berachain Perpetuals).

### eip-7702-gas-sponsorship/

EIP-7702 gas sponsorship implementation with Foundry examples.

### eip7951/

Bun workspace demo for EIP-7951-style two-factor accounts.

### envio-indexer-erc20/

Envio-based indexer for tracking ERC20 token events and transfers.

### erc7715/

Next.js + wagmi permissions demo.

### ethers6-solc-helloworld/

Basic smart contract deployment using ethers.js v6 and solc compiler.

### evm-wallet/

Expo wallet app demonstrating local key management and EVM interactions.

### foundry-erc20/

ERC20 token implementation and deployment guide using Foundry.

### gas-burner/

Solidity contract and scripts for controlled gas consumption testing and network stress testing.

### gelato-vrf/

Gelato VRF integration example. This app needs a Hardhat/tooling rebuild before it should be treated as current.

### hardhat-contract-verification/

Smart contract verification guide using Hardhat and Berascan.

### hardhat-ethers6-erc1155/

ERC1155 NFT contract implementation with Hardhat and ethers.js v6.

### hardhat-viem-helloworld/

Basic smart contract deployment using Hardhat and viem.

### honey-x402-demo/

HONEY x402 demo with contracts and frontend examples.

### irys-bera-nodejs/

Irys integration for permanent data storage on Berachain.

### layerzero-oft/

LayerZero OFT implementation for cross-chain tokens.

### openzeppelin-upgrades/

OpenZeppelin upgradeable contract patterns and deployment scripts.

### particle-auth-core-vite/

Particle Network authentication integration with Vite. This app needs a frontend/tooling rebuild before it should be treated as current.

### privy-nextjs/

Privy authentication integration with Next.js for web3 login.

### pyth-entropy/

Pyth Entropy integration for verifiable randomness.

### pyth-oracle/

Pyth price oracle integration examples.

### rainbowkit-vite/

RainbowKit wallet connection with Vite.

### thirdweb-connectwallet-nextjs/

Deprecated Thirdweb wallet connection example. Prefer rebuilding or removing rather than patching in place.

### viem-solc-helloworld/

Smart contract compilation and deployment using viem and solc.

### walletconnect-expo/

WalletConnect integration for React Native Expo apps. This app needs a modern WalletConnect/Reown rebuild.

### walletconnect-nextjs/

WalletConnect integration for Next.js applications. This app needs a modern WalletConnect/Reown rebuild.

### x402/

Bun Hono API and Vite web app demonstrating x402 payments.
