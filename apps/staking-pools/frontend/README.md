# Staking Pools Frontend

Boilerplate user-facing web interface for staking into a single StakingPool and requesting withdrawals on Berachain.

## Quick Start

```bash
cd /home/cam/src/contracts-staking-pools/script/frontend
npm install
npm run dev
```

The app will open automatically at http://localhost:3000

## Configuration

This app loads `/config.json` at runtime. Serve or edit `config.json` to set:

- **Network**: `rpcUrl`, `chainId`, `explorerUrl`
- **Contracts**: `withdrawalVault` (required), `stakingPoolFactory` (optional)
- **Pools**: one or more pools with `name`, `validatorPubkey`, `stakingPool`, `enabled`

## Features

### User Page (👤)

- Connect wallet (MetaMask)
- Select configured pool
- Deposit BERA via `submit(receiver)`
- View stBERA balance, pool total assets, and your position value (BERA)
- Request withdrawals:
  - by assets: `WithdrawalVault.requestWithdrawal(pubkey, assetsInGWei, maxFeeToPay)`
  - by shares: `WithdrawalVault.requestRedeem(pubkey, shares, maxFeeToPay)`
  - finalize: `WithdrawalVault.finalizeWithdrawalRequest(requestId)` after cooldown

Operator and delegator views were removed to keep this a minimal end‑user example.

## External Access

To run on an external IP:

```bash
npm run dev -- --host 0.0.0.0 --port 3000
```

Then access at: `http://YOUR_IP:3000`

## Tech Stack

- **React 18** - UI framework
- **Vite** - Build tool (fast HMR)
- **Viem** - Ethereum interactions
- **MetaMask** - Wallet connection

## Development

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
