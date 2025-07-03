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
├── erc20-scanner/           # Individual experiment
│   ├── package.json         # Experiment-specific config
│   └── scan-erc20-contracts.js
├── token-finder/            # Individual experiment
│   ├── package.json         # Experiment-specific config
│   └── list-erc20.js
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

### ERC20 Scanner (`erc20-scanner`)

Unified tool for scanning blockchain blocks for contract creations and identifying ERC20 tokens with multiple output formats.

**Usage:**
```bash
# Basic scan with JSON output (default)
pnpm scan

# CSV output
pnpm scan --format csv --output tokens.csv

# Pretty table output
pnpm scan --format table --output tokens.txt

# Uniswap Token List format
pnpm scan --format tokenlist --output berachain-tokens.tokenlist.json

# Scan specific block range
pnpm scan --start 1000000 --end 1100000

# High confidence tokens only
pnpm scan --min-confidence 0.9

# Custom RPC and performance settings
pnpm scan --rpc https://rpc.berachain.com --batch-size 50 --max-concurrent 10
```

**Output Formats:**

1. **JSON** (default): Complete scan data with metadata
2. **CSV**: Spreadsheet-friendly format with all token details
3. **Table**: Pretty-printed ASCII table for terminal viewing
4. **Token List**: [Uniswap Token List](https://github.com/Uniswap/token-lists#authoring-token-lists) format for dApp integration

**Options:**
- `--rpc, -r`: RPC URL (default: your local mainnet RPC)
- `--start, -s`: Starting block number
- `--end, -e`: Ending block number
- `--blocks, -b`: Number of blocks to scan from latest (default: 1M)
- `--output, -o`: Output file base name (default: erc20-scan-results)
- `--format, -f`: Output format: json, csv, table, tokenlist
- `--min-confidence`: Minimum confidence threshold (0.0-1.0, default: 0.75)
- `--batch-size`: Blocks per batch (default: 100)
- `--max-concurrent`: Max concurrent requests (default: 5)

## Environment Variables

All experiments use a shared configuration file (`config.js`) with your preferred defaults:

### Default Configuration
- `EL_ETHRPC_URL`: `http://10.147.18.191:40003` (your local mainnet RPC)
- `CL_ETHRPC_URL`: `http://10.147.18.191:40000` (your local mainnet CL)
- `ABIS_DIR`: `~/src/abis/` (your preferred ABI directory)

### Override with Environment Variables
Set these environment variables to override the defaults:

### Required Variables
- `EL_ETHRPC_URL`: Execution layer RPC URL
  - Mainnet: `https://rpc.berachain.com`
  - Bepolia: `https://bepolia.rpc.berachain.com`
  - Local: `http://10.147.18.191:40003` (mainnet) or `http://localhost:41003` (bepolia)

### Optional Variables
- `CL_ETHRPC_URL`: Consensus layer RPC URL (for future use)
  - Mainnet: `http://10.147.18.191:40000`
  - Bepolia: `http://localhost:41000`
- `ABIS_DIR`: Directory for ABI files (default: `~/src/abis/`)
- `CHAIN_ID`: Network chain ID (80094 for mainnet, 80064 for Bepolia)
- `FUNDING_PRIVATE_KEY`: Private key for funding account (for testing)

### Usage Examples

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

### Environment Variable Priority
1. **Command line arguments** (highest priority)
2. **Environment variables** (set in shell)
3. **Shared config defaults** (lowest priority)

## Network Configuration

**Berachain Networks:**
- **Mainnet**: Chain ID 80094, RPC: `https://rpc.berachain.com`
- **Bepolia**: Chain ID 80064, RPC: `https://bepolia.rpc.berachain.com`

## Examples

### Quick Scan of Recent Blocks
```bash
# Scan last 10,000 blocks on mainnet
pnpm scan --rpc https://rpc.berachain.com --blocks 10000 --format csv

# Using environment variables (recommended)
export EL_ETHRPC_URL=https://rpc.berachain.com
pnpm scan --blocks 10000 --format csv
```

### Generate Token List for dApp
```bash
# Create Uniswap-compatible token list
pnpm scan --format tokenlist --min-confidence 0.8 --output berachain-mainnet-tokens

# Using environment variables
export EL_ETHRPC_URL=https://rpc.berachain.com
export ABIS_DIR=~/src/abis/
pnpm scan --format tokenlist --min-confidence 0.8 --output berachain-mainnet-tokens
```

### Batch Processing
```bash
# Process specific block ranges
pnpm scan --start 1000000 --end 1100000 --format table
```

## Output Files

### JSON Format
Complete scan data including:
- Scan metadata and statistics
- Full contract details
- Confidence scores
- Block and transaction information

### CSV Format
Spreadsheet-friendly with columns:
- Address, Name, Symbol, Decimals, Total Supply
- Block Number, Creator, Confidence, Timestamp

### Table Format
Pretty-printed ASCII table showing:
- Contract addresses
- Token names and symbols
- Key metadata in aligned columns

### Token List Format
Uniswap-compatible JSON following the [Token Lists specification](https://github.com/Uniswap/token-lists#authoring-token-lists):
- Standard token metadata
- Chain ID and addresses
- Confidence scores in extensions
- Ready for dApp integration

## Performance Tips

1. **Adjust batch size** based on RPC performance
2. **Use local RPC** for faster scanning
3. **Set confidence threshold** to filter results
4. **Monitor memory usage** for large block ranges

## Troubleshooting

### Common Issues

**RPC Timeouts:**
- Reduce `--batch-size` and `--max-concurrent`
- Use a more reliable RPC endpoint

**Memory Issues:**
- Process smaller block ranges
- Use CSV or table output for large datasets

**Low Token Detection:**
- Lower `--min-confidence` threshold
- Check RPC endpoint reliability

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

### Best Practices

1. **Use shared dependencies** when possible
2. **Keep experiment-specific dependencies** minimal
3. **Use descriptive package names** with `berachain-` prefix
4. **Document your experiment** in its own README if complex
5. **Use flexible version ranges** to allow minor updates

## License

MIT License - see individual package files for details. 