# Viem + Solc Hello World Example 🚀

A simple example of deploying a smart contract on Berachain using Viem and Solc. This guide will help you get started with smart contract development on Berachain.

## Prerequisites 📋

Before you begin, make sure you have:

- Node.js v20+ installed
- A Berachain wallet with some test tokens
- Your wallet's private key (we'll help you set this up)

## Quick Start 🚀

1. **Clone and Install**

   ```bash
   git clone <repository-url>
   cd viem-solc-helloworld
   pnpm install
   ```

2. **Environment Setup**

   ```bash
   # Copy the example environment file
   cp .env.example .env
````

Then open `.env` and add your wallet's private key:

```
WALLET_PRIVATE_KEY=your_private_key_here
```

3. **Deploy Your Contract**
   ```bash
   pnpm deploy:berachain
   ```

## Project Structure 📁

```
viem-solc-helloworld/
├── contracts/              # Your Solidity contracts
│   └── HelloWorld.sol     # The contract we'll deploy
├── scripts/               # Deployment scripts
│   └── deploy.ts         # Main deployment script
├── .env.example          # Example environment file
└── package.json          # Project dependencies
```

## What's Inside? 🔍

- A simple "Hello World" smart contract
- A deployment script using Viem and Solc
- Configuration for Berachain network

## Need More Details? 📚

Check out the [WALKTHROUGH.md](./WALKTHROUGH.md) for a detailed explanation of the deployment process and code snippets.

## Common Setup Issues 🔧

1. **Node.js Version**

   - Make sure you're using Node.js v20 or higher
   - You can check your version with `node --version`

2. **Private Key Format**

   - Your private key should start with `0x`
   - Keep it secure and never share it

3. **Test Tokens**
   - You'll need some test tokens for deployment
   - Get them from the Berachain faucet

## Need Help? 🤝

If you run into any issues:

- Check the error message carefully
- Make sure all prerequisites are met
- Verify your environment variables are set correctly

Happy coding! 🌟

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
- [@branch/rpc-config Package](../../packages/rpc-config/README.md)

## Detailed Walkthrough

For a detailed explanation of the deployment process and script functionality, see [WALKTHROUGH.md](./WALKTHROUGH.md).
