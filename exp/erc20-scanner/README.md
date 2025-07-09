# ERC20 Scanner

Unified tool for scanning blockchain blocks for contract creations and identifying ERC20 tokens with multiple output formats.

## Features

- **Multiple Output Formats**: JSON, CSV, Table, and Uniswap Token List
- **Confidence Scoring**: Filters tokens based on implementation confidence
- **Batch Processing**: Efficient scanning of large block ranges
- **Flexible Configuration**: Command line options and environment variables

## Installation

From the `exp` directory:
```bash
pnpm install
```

## Usage

### Basic Commands

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

### Command Line Options

- `--rpc, -r`: RPC URL (default: your local mainnet RPC)
- `--start, -s`: Starting block number
- `--end, -e`: Ending block number
- `--blocks, -b`: Number of blocks to scan from latest (default: 1M)
- `--output, -o`: Output file base name (default: erc20-scan-results)
- `--format, -f`: Output format: json, csv, table, tokenlist
- `--min-confidence`: Minimum confidence threshold (0.0-1.0, default: 0.75)
- `--batch-size`: Blocks per batch (default: 100)
- `--max-concurrent`: Max concurrent requests (default: 5)

## Output Formats

### JSON Format (Default)
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

## Configuration

### Environment Variables

See the main [exp README](../README.md#environment-variables) for detailed environment variable configuration.

Key variables:
- `EL_ETHRPC_URL`: RPC endpoint URL
- `ABIS_DIR`: Directory containing ABI files
- `CHAIN_ID`: Network chain ID

### Performance Tuning

Adjust these parameters based on your RPC performance:
- `--batch-size`: Number of blocks processed together
- `--max-concurrent`: Maximum concurrent RPC requests
- `--min-confidence`: Higher values = fewer false positives

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

### Performance Tips

1. **Adjust batch size** based on RPC performance
2. **Use local RPC** for faster scanning
3. **Set confidence threshold** to filter results
4. **Monitor memory usage** for large block ranges

## Output Files

All output files are created in the current directory unless specified otherwise:

- `erc20-scan-results.json` - Default JSON output
- `erc20-scan-results.csv` - CSV format
- `erc20-scan-results.txt` - Table format
- `berachain-tokens.tokenlist.json` - Token list format 