# Berachain Guides

A collection of Berachain EVM examples: code, frameworks, languages, contracts, and more.

## Requirements

- NVM or Node `v18.18.2+`
- pnpm (recommended)

## Turborepo Folder Structure

This Turborepo includes the following packages/apps:

### Apps

- `apps/ethers6-solc-helloworld` - Deploy HelloWorld contract with ethers6
- `apps/viem-solc-helloworld` - Deploy HelloWorld contract with viem
- `apps/foundry-erc20` - Deploy ERC20 contract with foundry
- `apps/hardhat-ethers6-erc1155` - Deploy ERC1155 contract with hardhat ethers6
- `apps/hardhat-viem-helloworld` - Deploy HelloWorld contract with hardhat viem
- `apps/walletconnect-nextjs` - WalletConnect Web3Modal frontend contract deployment
- `apps/berachain-explorer-blazor` - Blazor Server application integrated with Berachain blockchain explorer

## Quick Start

Install dependencies for all apps and packages.

```bash
# FROM: ./

pnpm install;
```

Create and modify your `.env` and make the modifications you need to it.

```bash
cp .env.example .env;
```

If you'd like to deploy to the chain:

```bash
# FROM: ./

# IMPORTANT: --no-cache is important to avoid caching the result of the deployments
pnpm deploy:berachain --filter foundry-erc20 --no-cache;
```
