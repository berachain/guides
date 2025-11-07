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

## Directories

### beralyzer/

Database-backed blockchain indexing and analysis tool tracking validator activity, block proposals, and chain metrics. See [beralyzer/README.md](beralyzer/README.md) for details.

### block-scanners/

Suite of blockchain analysis utilities examining blocks, validators, voting patterns, and network performance. See [block-scanners/README.md](block-scanners/README.md) for details.

### cometbft-decoder/

Go utility for decoding CometBFT validator addresses and correlating them with on-chain data.

### gas-burner/

Solidity contract and scripts for controlled gas consumption testing and network stress testing. See [gas-burner/README.md](gas-burner/README.md) for details.

### peer-filter/

Go-based P2P network peer filtering and management tool. See [peer-filter/README.md](peer-filter/README.md) for details.

### pol-performance-study/

Analysis tools for studying Proof-of-Liquidity validator performance and reward distribution patterns. See [pol-performance-study/README.md](pol-performance-study/README.md) for details.

### staking-pools/

Staking pool deployment and management tools including helper scripts for validators and delegators. See [staking-pools/install-helpers/README.md](staking-pools/install-helpers/README.md) for details.

## Smart Contract & DApp Examples

### batch-transactions/

EIP-7702 batch transaction examples demonstrating atomic multi-call patterns.

### berachain-governance-proposal/

Scripts and examples for interacting with Berachain's on-chain governance system.

### berps-bot/

Trading bot implementation for Berps (Berachain Perpetuals).

### eip-7702-gas-sponsorship/

EIP-7702 gas sponsorship implementation with Foundry examples.

### envio-indexer-erc20/

Envio-based indexer for tracking ERC20 token events and transfers.

### erpc-proxy-caching/

eRPC proxy configuration for caching and optimizing RPC requests.

### ethers6-solc-helloworld/

Basic smart contract deployment using ethers.js v6 and solc compiler.

### foundry-erc20/

ERC20 token implementation and deployment guide using Foundry.

### gelato-vrf/

Gelato VRF (Verifiable Random Function) integration example.

### goldsky-subgraph/

Goldsky-powered subgraph for indexing Berachain data.

### grafana/

Grafana dashboards and Prometheus configuration for monitoring Berachain nodes.

### hardhat-contract-verification/

Smart contract verification guide using Hardhat and Berascan.

### hardhat-ethers6-erc1155/

ERC1155 NFT contract implementation with Hardhat and ethers.js v6.

### hardhat-viem-helloworld/

Basic smart contract deployment using Hardhat and viem.

### irys-bera-nodejs/

Irys (Arweave) integration for permanent data storage on Berachain.

### layerzero-oft/

LayerZero OFT (Omnichain Fungible Token) implementation for cross-chain tokens.

### local-docker-devnet/

Docker-based local Berachain devnet for testing and development.

### node-scripts/

Various Node.js utilities for interacting with Berachain.

### openzeppelin-upgrades/

OpenZeppelin upgradeable contract patterns and deployment scripts.

### particle-auth-core-vite/

Particle Network authentication integration with Vite.

### privy-nextjs/

Privy authentication integration with Next.js for web3 login.

### pyth-entropy/

Pyth Entropy integration for verifiable randomness.

### pyth-oracle/

Pyth price oracle integration examples.

### rainbowkit-vite/

RainbowKit wallet connection with Vite.

### thirdweb-connectwallet-nextjs/

Thirdweb wallet connection with Next.js.

### viem-solc-helloworld/

Smart contract compilation and deployment using viem and solc.

### walletconnect-expo/

WalletConnect integration for React Native Expo apps.

### walletconnect-nextjs/

WalletConnect integration for Next.js applications.
