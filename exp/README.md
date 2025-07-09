# Berachain Experiments

This directory contains experimental tools and scripts for analyzing the Berachain blockchain. All experiments share a common `node_modules` directory for efficient dependency management using pnpm workspaces.

## Shared Dependencies Architecture

The `exp` directory is configured as a **pnpm workspace** where all experiments share common dependencies. This provides several benefits:

- **Disk space efficiency**: Common packages like `ethers`, `yargs`, and `cli-table3` are installed once
- **Version consistency**: All experiments use the same versions of shared dependencies
- **Easy maintenance**: Update dependencies in one place for all experiments
- **Fast installation**: pnpm's efficient linking system

### Workspace Structure
```
exp/
├── package.json              # Workspace root with shared dependencies
├── pnpm-workspace.yaml       # Workspace configuration
├── erc20-scanner/           # ERC20 contract detection tool
│   ├── package.json         # Experiment-specific config
│   ├── README.md           # Tool-specific documentation
│   └── scan-erc20-contracts.js
├── block-scanners/          # Block analysis utilities
│   ├── README.md           # Tool-specific documentation
│   ├── find_monday_blocks.js
│   └── empty_blocks_scanner.js
├── gas-burner/              # Gas consumption testing
├── cometbft-decoder/        # CometBFT message decoder
└── node_modules/            # Shared dependencies (managed by pnpm)
```

## Setup

### Prerequisites
- Node.js 20+
- pnpm (recommended) or npm

### Installation
```bash
cd exp
pnpm install
```

### Adding Dependencies
```bash
cd exp
pnpm add package-name
```

## Tools

### ERC20 Scanner (`erc20-scanner/`)
Unified tool for scanning blockchain blocks for contract creations and identifying ERC20 tokens with multiple output formats.

See [`erc20-scanner/README.md`](erc20-scanner/README.md) for detailed usage instructions.

### Block Scanners (`block-scanners/`)
Utilities for analyzing blockchain blocks and their patterns, including:
- Finding blocks at specific timestamps (e.g., Monday boundaries)
- Scanning for empty blocks and daily statistics

See [`block-scanners/README.md`](block-scanners/README.md) for detailed usage instructions.

### Gas Burner (`gas-burner/`)
Tools for testing gas consumption and network performance.

### CometBFT Decoder (`cometbft-decoder/`)
Utilities for decoding CometBFT consensus messages.

## Environment Variables

All experiments use a shared configuration file (`config.js`) with your preferred defaults:

### Default Configuration
- `EL_ETHRPC_URL`: `http://10.147.18.191:40003` (your local mainnet RPC)
- `CL_ETHRPC_URL`: `http://10.147.18.191:40000` (your local mainnet CL)
- `ABIS_DIR`: `~/src/abis/` (your preferred ABI directory)

### Override with Environment Variables
Set these environment variables to override the defaults:

#### Required Variables
- `EL_ETHRPC_URL`: Execution layer RPC URL
  - Mainnet: `https://rpc.berachain.com`
  - Bepolia: `https://bepolia.rpc.berachain.com`
  - Local: `http://10.147.18.191:40003` (mainnet) or `http://localhost:41003` (bepolia)

#### Optional Variables
- `CL_ETHRPC_URL`: Consensus layer RPC URL (for future use)
  - Mainnet: `http://10.147.18.191:40000`
  - Bepolia: `http://localhost:41000`
- `ABIS_DIR`: Directory for ABI files (default: `~/src/abis/`)
- `CHAIN_ID`: Network chain ID (80094 for mainnet, 80064 for Bepolia)
- `FUNDING_PRIVATE_KEY`: Private key for funding account (for testing)

### Environment Variable Priority
1. **Command line arguments** (highest priority)
2. **Environment variables** (set in shell)
3. **Shared config defaults** (lowest priority)

## Network Configuration

**Berachain Networks:**
- **Mainnet**: Chain ID 80094, RPC: `https://rpc.berachain.com`
- **Bepolia**: Chain ID 80064, RPC: `https://bepolia.rpc.berachain.com`

## Usage Examples

**Use defaults (recommended):**
```bash
cd exp
pnpm erc20-scan
pnpm token-find
```

**Override with environment variables:**
```bash
export EL_ETHRPC_URL=https://bepolia.rpc.berachain.com
pnpm token-find
```

**Override with command line:**
```bash
pnpm token-find --rpc https://bepolia.rpc.berachain.com
```

## Performance Tips

1. **Adjust batch size** based on RPC performance
2. **Use local RPC** for faster scanning
3. **Set confidence threshold** to filter results
4. **Monitor memory usage** for large block ranges

## Troubleshooting

### Common Issues

**Dependencies not found:**
```bash
cd exp
rm -rf node_modules
pnpm install
```

**Version conflicts:**
```bash
cd exp
pnpm update
```

**RPC Timeouts:**
- Reduce `--batch-size` and `--max-concurrent`
- Use a more reliable RPC endpoint

**Memory Issues:**
- Process smaller block ranges
- Use CSV or table output for large datasets

## Contributing

### Adding New Experiments

To add a new experiment:

1. **Create experiment directory**:
   ```bash
   mkdir exp/my-new-experiment
   cd exp/my-new-experiment
   ```

2. **Create package.json**:
   ```json
   {
     "name": "berachain-my-experiment",
     "version": "1.0.0",
     "description": "My new Berachain experiment",
     "main": "index.js",
     "scripts": {
       "start": "node index.js"
     }
   }
   ```

3. **Add to workspace**:
   - Add to `exp/pnpm-workspace.yaml`
   - Run `pnpm install` from exp directory

4. **Create README.md**:
   - Document tool-specific usage
   - Reference from main exp README

### Best Practices

1. **Use shared dependencies** when possible
2. **Keep experiment-specific dependencies** minimal
3. **Use descriptive package names** with `berachain-` prefix
4. **Document your experiment** in its own README if complex
5. **Use flexible version ranges** to allow minor updates

## License

MIT License - see individual package files for details. 