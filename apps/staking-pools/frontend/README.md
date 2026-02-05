# Staking Pool Frontend

A Vue.js frontend for Berachain staking pools. Users can stake BERA, view positions, and manage withdrawals.

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure:**
   ```bash
   cp public/config.example.json public/config.json
   # Edit public/config.json with your settings
   ```

3. **Run dev server:**
   ```bash
   npx vite
   ```

4. **Build for production:**
   ```bash
   npm run build
   ```

## Configuration

**See [user-docs/CONFIG_GUIDE.md](./user-docs/CONFIG_GUIDE.md) for detailed configuration instructions.**

Quick summary:
- **Single Pool Mode**: Set `"mode": "single"` and add your pool to `pools` section
- **Discovery Mode**: Set `"mode": "discovery"` and leave `pools` empty


## Development

- Dev server: `npx vite` (runs on port 3001)
- Tests: `npm run test:e2e` (Playwright E2E tests)
- Build: `npm run build` (outputs to `dist/`)

## Project Structure

- `src/` - Vue application source
- `public/` - Static assets and config files
- `tests/` - Playwright E2E tests (includes TEST_PLAN.md)
- `user-docs/` - User-facing documentation (configuration guides)

## Features

- ✅ Single pool staking interface
- ✅ Multi-pool discovery (optional)
- ✅ Wallet connection (MetaMask, WalletConnect, etc.)
- ✅ Stake BERA to receive stBERA
- ✅ Request and finalize withdrawals
- ✅ Delegation badge display
- ✅ Real-time pool data updates

## Support

For configuration help, see [user-docs/CONFIG_GUIDE.md](./user-docs/CONFIG_GUIDE.md).
