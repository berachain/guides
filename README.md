# Berachain Guides

A collection of [Berachain](https://docs.berachain.com/learn/) EVM examples: code, frameworks, languages, contracts, and more.

## Requirements

- Node.js `v20+`
- pnpm (recommended)

## Documentation Tree

```
📚 Berachain Guides
├── 📦 Core Packages
│   ├── 📄 berachain-config/                           # Network & RPC configurations
│   │   ├── 📄 README.md                               # Integration patterns & security
│   │   ├── 📄 viem/                                   # Viem integration utilities
│   │   └── 📄 ethers/                                 # Ethers integration utilities
│   ├── 📄 typescript-config/                          # Shared TypeScript configs
│   ├── 📄 eslint-config/                              # Shared ESLint configs
│   └── 📄 ui/                                         # Shared UI components
│
├── 📱 Smart Contract Development
│   ├── 📄 Basic Deployment
│   │   ├── 📄 viem-solc-helloworld/                   # Viem + Solc example
│   │   ├── 📄 ethers6-solc-helloworld/                # Ethers + Solc example
│   │   └── 📄 foundry-erc20/                          # Foundry ERC20 example
│   │
│   ├── 📄 Hardhat Examples
│   │   ├── 📄 hardhat-viem-helloworld/                # Hardhat + Viem
│   │   ├── 📄 hardhat-ethers6-erc1155/                # Hardhat + Ethers
│   │   └── 📄 hardhat-contract-verification/          # Contract verification
│   │
│   └── 📄 Advanced Patterns
│       ├── 📄 openzeppelin-upgrades/                  # Upgrade patterns
│       ├── 📄 berachain-governance-proposal/          # Governance
│       ├── 📄 gelato-vrf/                             # Chainlink VRF
│       └── 📄 layerzero-oft/                          # Cross-chain
│
├── 🌐 Frontend Integration
│   ├── 📄 Web Applications
│   │   ├── 📄 walletconnect-nextjs/                   # WalletConnect
│   │   ├── 📄 particle-auth-core-vite/                # Particle Network
│   │   ├── 📄 rainbowkit-vite/                        # RainbowKit
│   │   └── 📄 thirdweb-connectwallet-nextjs/          # Thirdweb
│   │
│   └── 📄 Mobile
│       └── 📄 walletconnect-expo/                     # React Native
│
└── 🛠️ Infrastructure & Tools
    ├── 📄 Indexing & Data
    │   ├── 📄 goldsky-subgraph/                       # The Graph
    │   ├── 📄 envio-indexer-erc20/                    # Envio
    │   └── 📄 erpc-proxy-caching/                     # RPC caching
    │
    ├── 📄 Oracle Integration
    │   ├── 📄 pyth-oracle/                            # Price feeds
    │   └── 📄 pyth-entropy/                           # Entropy
    │
    └── 📄 Development Tools
        ├── 📄 local-docker-devnet/                    # Local dev
        ├── 📄 node-scripts/                           # Utilities
        └── 📄 berps-bot/                              # Trading bot
```

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

1. **Core Concepts**

   - Start with `berachain-config` to understand network integration
   - Review basic contract deployment examples

2. **Choose Your Path**

   - Smart Contract Development: Start with basic deployment examples
   - Frontend Integration: Begin with wallet connection examples
   - Infrastructure: Explore indexing and oracle examples

3. **Advanced Topics**
   - Contract upgrades and governance
   - Cross-chain functionality
   - Advanced indexing patterns

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
