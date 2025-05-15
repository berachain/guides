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
import {
  berachainMainnet,
  berachainBepolia,
  getChainById,
  getChainByName,
} from "@branch/berachain-config";

// Use predefined chains
const mainnet = berachainMainnet;
const testnet = berachainBepolia;

// Get chain by ID
const chain = getChainById(80085); // Returns berachainMainnet

// Get chain by name
const chainByName = getChainByName("berachain"); // Returns berachainMainnet
```

## Integration Patterns

### Browser Integration

For browser-based applications, you can use either Viem or Ethers to create wallet connections:

```typescript
// Using Viem
import { createBrowserWalletClient } from "@branch/berachain-config/viem";
import { berachainMainnet } from "@branch/berachain-config";

const browserWallet = createBrowserWalletClient(berachainMainnet);

// Using Ethers
import { createBrowserEthersSigner } from "@branch/berachain-config/ethers";
import { berachainMainnet } from "@branch/berachain-config";

const browserSigner = createBrowserEthersSigner(berachainMainnet);
```

Security considerations for browser integration:

- Always use HTTPS in production
- Implement proper error handling for wallet connection failures
- Consider implementing wallet connection persistence
- Handle network switching gracefully
- Implement proper transaction confirmation handling

### Node.js Script Integration

For scripts and backend services, you can use private key-based authentication:

```typescript
// Using Viem
import { createBerachainWalletClient } from "@branch/berachain-config/viem";
import { berachainMainnet } from "@branch/berachain-config";

const walletClient = createBerachainWalletClient(http(), berachainMainnet);

// Using Ethers
import { createBerachainEthersSigner } from "@branch/berachain-config/ethers";
import { berachainMainnet } from "@branch/berachain-config";

const signer = createBerachainEthersSigner(
  "your-private-key",
  berachainMainnet,
);
```

Security considerations for Node.js scripts:

- Never commit private keys to version control
- Use environment variables for sensitive data
- Implement proper error handling and retries
- Consider implementing transaction monitoring
- Use secure RPC endpoints

### Framework Integration

The package works with various development frameworks:

#### Hardhat

- [hardhat-viem-helloworld](../../apps/hardhat-viem-helloworld)
- [hardhat-ethers6-erc1155](../../apps/hardhat-ethers6-erc1155)

#### Foundry

- [foundry-erc20](../../apps/foundry-erc20)

#### Frontend Frameworks

- Next.js: [walletconnect-nextjs](../../apps/walletconnect-nextjs)
- React Native: [walletconnect-expo](../../apps/walletconnect-expo)
- Vite: [particle-auth-core-vite](../../apps/particle-auth-core-vite)

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

## Additional Resources

- [Berachain Documentation](https://docs.berachain.com/)
- [Viem Documentation](https://viem.sh)
- [Ethers Documentation](https://docs.ethers.org/v6/)

## Contributing

This package is part of the [Berachain Guides](https://github.com/berachain/guides) repository.
