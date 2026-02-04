# Configuration Guide

This guide covers all configuration options for the staking pool frontend. For deployment instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md).

## Quick Start

Copy `public/config.example.json` to `public/config.json` and edit with your settings. The helper scripts `npm run config:single` and `npm run config:discovery` switch modes, or edit the `mode` field directly.

## Configuration Modes

The frontend supports two modes. Single pool mode is the typical deployment scenario where you're serving one validator's staking pool. Set `"mode": "single"` and add your pool details in the `pools` section. The frontend displays that pool and allows users to stake directly to it.

Discovery mode loads multiple pools automatically and lets users browse and select pools. Set `"mode": "discovery"` and leave the `pools` object empty. Discovery uses `api.berachain.com/graphql` to enumerate validator pubkeys, then resolves each validator’s staking pool via on-chain factory calls.

## Configuration Fields

### Network Settings

The network section defines which blockchain network the frontend connects to:

| Field | Description |
|-------|-------------|
| `name` | Display name users will see |
| `chainId` | Network chain ID (80069 for Bepolia, 80094 for mainnet) |
| `rpcUrl` | RPC endpoint (must be accessible from browsers and support eth_call and eth_getBalance) |
| `explorerUrl` | Block explorer URL |

Public RPC endpoints work, but consider using a dedicated endpoint for production to avoid rate limits that appear during peak usage, because that's when they always appear.

### Branding

Set `name` to your pool's display name (appears in header and page title). The `logo` field accepts a path relative to `public`, or `null`. SVG files scale cleanly; place logos in `public/branding/` and reference as `/branding/logo.svg`.

The `theme` field selects a preset color scheme. Available presets: `"blue"`, `"purple"`, `"green"`, `"orange"`, `"teal"`, `"coral"`, `"indigo"`, `"emerald"`, and `"cyan"`. Each preset includes a matching example logo in `public/branding/` and defines accent colors for buttons, links, and highlights. For custom colors, leave `theme` as `null` and edit `public/theme-overrides.css` to override CSS variables. The override loads after preset themes, so you can customize a preset or start from scratch.

Example branding configuration with a preset theme:

```json
"branding": {
  "name": "My Staking Pool",
  "logo": "/branding/logo.svg",
  "theme": "blue"
}
```

For custom themes, see the theme override examples in `public/theme-overrides.example-*.css` and copy one to `public/theme-overrides.css` to customize.

### Contracts

The contracts section specifies on-chain addresses. The `withdrawalVault` address is required and must match your network. See [Network Presets](#network-presets) for current addresses. Set `delegationHandler` to `0x0000000000000000000000000000000000000000` if not using delegation, or provide the handler address.

### Pools (Single Mode Only)

In single pool mode, add your pool details under the `pools` object. Use `"default"` as the key, or any identifier you prefer (only the first enabled pool is used). The `name` field is what users see when viewing pool information. The `stakingPool` address must be your deployed staking pool contract address on the specified network. The `validatorPubkey` is the validator's public key from the beacon chain, exactly 98 hex characters including the `0x` prefix. Set `enabled` to `true` to activate the pool, or `false` to disable it without removing the entry.

## Network Presets

| Network | Chain ID | RPC URL | Explorer | Staking Pool Factory | Delegation Handler Factory |
|---------|----------|---------|----------|---------------------|---------------------------|
| Bepolia | 80069 | `https://bepolia.rpc.berachain.com` | `https://bepolia.berascan.com` | `0x176c081E95C82CA68DEa20CA419C7506Aa063C24` | `0x8b472791aC2f9e9Bd85f8919401b8Ce3bdFd464c` |
| Mainnet | 80094 | `https://rpc.berachain.com` | `https://berascan.com` | `0xb79b43dBA821Cb67751276Ce050fF4111445fB99` | `0xAd17932a5B1aaeEa73D277a6AE670623F176E0D0` |

## Getting Your Pool Address

You need your staking pool contract address and validator public key. Check your deployment records, or query the factory contract's `getCoreContracts(bytes pubkey)` function. The `generate-frontend-config.sh` script in `guides/apps/staking-pools/install-helpers/` automates this lookup and generates a complete config file.

## Build Commands

Build with `npm run build`. The output in `dist/` contains your static site. Test locally with `npm run preview` before deploying. The build copies `config.json` and `public/` assets to the output directory.

## Troubleshooting

1. **"No enabled pools found":** In single pool mode, set `pools.default.enabled` to `true`. In discovery mode, confirm your RPC works and that `api.berachain.com/graphql` is reachable from the browser environment.

2. **Pool data doesn't load:** Verify your RPC URL is correct and accessible (test with `curl`). Check that the pool address matches your deployed contract and is on the network specified in your config. The validator pubkey must be exactly 98 hex characters. Open the browser console for specific errors; wrong chain ID, incorrect contract addresses, or RPC connection failures are common.

## Examples

See `public/config.example.json` for a minimal example, or check `public/config.example-*.json` files for complete examples with different theme presets. Each example demonstrates a working configuration; copy and modify as needed, because your pool is special but not that special.
