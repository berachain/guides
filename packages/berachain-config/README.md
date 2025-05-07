# @branch/berachain-config

A centralized configuration package for Berachain networks, providing chain configurations, RPC URLs, and utility functions for both browser and Node.js environments.

## Installation

```bash
# Core package
pnpm add @branch/berachain-config

# With viem support
pnpm add viem

# With ethers support
pnpm add ethers
```

## Usage

### Basic Usage

```typescript
import { berachainMainnet, berachainBepolia, getChainById, getChainByName } from '@branch/berachain-config';

// Use predefined chains
const mainnet = berachainMainnet;
const testnet = berachainBepolia;

// Get chain by ID
const chain = getChainById(80085); // Returns berachainMainnet

// Get chain by name
const chainByName = getChainByName('berachain'); // Returns berachainMainnet
```

### Using with Viem

```typescript
import { createBerachainPublicClient, createBerachainWalletClient, createBrowserWalletClient } from '@branch/berachain-config/viem';
import { berachainMainnet } from '@branch/berachain-config';

// Create a public client (works in both Node.js and browser)
const publicClient = createBerachainPublicClient(berachainMainnet);

// Create a wallet client with custom transport (Node.js)
const walletClient = createBerachainWalletClient(http(), berachainMainnet);

// Create a browser wallet client (browser only)
const browserWallet = createBrowserWalletClient(berachainMainnet);
```

### Using with Ethers

```typescript
import { createBerachainEthersProvider, createBerachainEthersSigner, createBrowserEthersSigner } from '@branch/berachain-config/ethers';
import { berachainMainnet } from '@branch/berachain-config';

// Create a provider (works in both Node.js and browser)
const provider = createBerachainEthersProvider(berachainMainnet);

// Create a signer with private key (Node.js)
const signer = createBerachainEthersSigner('your-private-key', berachainMainnet);

// Create a browser signer (browser only)
const browserSigner = createBrowserEthersSigner(berachainMainnet);
```

## Network Information

### Berachain Mainnet
- **Chain ID**: 80085
- **RPC URL**: https://rpc.berachain.com
- **Block Explorer**: https://berascan.com
- **Currency**: BERA
- **Symbol**: BERA

### Bepolia Testnet
- **Chain ID**: 80085
- **RPC URL**: https://bepolia.rpc.berachain.com
- **Block Explorer**: https://bepolia.beratrail.io
- **Currency**: BERA
- **Symbol**: BERA

## Adding Networks to MetaMask

To add Berachain networks to MetaMask:

1. Open MetaMask and click on the network selector dropdown
2. Click "Add Network"
3. Click "Add Network Manually"
4. Use the network information from above to fill in the fields:
   - For Mainnet, use the Berachain Mainnet details
   - For Testnet, use the Bepolia Testnet details
5. Click "Save"

## Contributing

This package is part of the [Berachain Guides](https://github.com/berachain/guides) repository. 