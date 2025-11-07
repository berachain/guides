# Block Scanners

Production-ready utilities for analyzing blockchain blocks, validator performance, and network patterns on Berachain networks. These tools provide insights into consensus behavior, block production efficiency, validator activity, and network health metrics.

## Use Cases

These tools are designed for:

- **Validator operators** monitoring their own performance and identifying optimization opportunities
- **Network researchers** studying consensus patterns, block production, and validator behavior
- **Protocol developers** analyzing network health metrics and identifying issues
- **DApp developers** tracking pool events, deposits, and contract state changes
- **Data analysts** extracting historical blockchain data for reporting and visualization

## Setup

Install dependencies:

```bash
npm install
```

## Configuration

All scripts use the consolidated configuration from `../config.js` which supports:

- Environment variable overrides via `.env` file
- Network-specific settings (mainnet/bepolia)
- Validator database integration for name lookups
- Configurable RPC endpoints (execution and consensus layers)

You can override default settings by setting environment variables:

- `MAINNET_EL_URL` - Mainnet execution layer RPC endpoint
- `MAINNET_CL_URL` - Mainnet consensus layer RPC endpoint
- `BEPOLIA_EL_URL` - Bepolia execution layer RPC endpoint
- `BEPOLIA_CL_URL` - Bepolia consensus layer RPC endpoint
- `VALIDATOR_DB_PATH` - Path to validator database for name lookups (see `cometbft-decoder`)

## Available Scripts

### `analyze-block-delays.js`

Analyzes block delays between consecutive blocks with percentile analysis per proposer.

**Features:**

- Efficient single-pass block fetching
- Millisecond-accurate timing analysis between consecutive blocks
- Percentile analysis (P25, P50/median, P75, P90, P99) for block delays
- Statistical analysis with min/max values and block numbers
- Detailed histograms when filtering by proposer

**Usage:** `node analyze-block-delays.js [--blocks N] [--chain NAME] [-a] [-p PROPOSER] [-h]`

### `analyze-voting-power.js`

Comprehensive validator performance analyzer examining block proposals, client types, and voting patterns.

**Features:**

- Decodes RLP-encoded extraData to identify client types and versions
- Analyzes validator block proposal patterns
- Tracks client distribution across validators
- Client upgrade tracking across time
- Detailed performance metrics and statistics

**Usage:** `node analyze-voting-power.js [-b N] [-d] [-u] [-n NAME] [-h]`

### `analyze-block-filling.js`

Block utilization analyzer examining transaction counts, gas usage, and block filling patterns.

**Features:**

- Analyzes block utilization and transaction density
- Identifies client types from extraData decoding
- Tracks validator performance metrics
- Detailed block filling statistics
- Sortable results by various metrics

**Usage:** `node analyze-block-filling.js [-b N] [-n NAME] [-s COLUMN] [-h]`

### `analyze-missing-validators.js`

Analyzes missing validators (block_id_flag = 1) per proposer with detailed histograms.

**Features:**

- Efficient single-pass block fetching
- Per-proposer histogram of missing validator counts
- Overall distribution analysis
- Statistical analysis with percentiles
- Validator name lookup via database

**Usage:** `node analyze-missing-validators.js [--blocks N] [--chain NAME] [-a] [-p PROPOSER] [-h]`

### `scan-proposer-activity.js`

Backwards consensus layer scanner to find when a specific proposer last voted on a block and last proposed a block.

**Features:**

- Efficient backwards block scanning from latest block
- Tracks both voting activity (last_commit signatures) and proposal activity
- Flexible proposer input (with or without 0x prefix)
- Progress reporting with block scanning status
- Validator name lookup via database
- Configurable scan limits with no upper bound for historical searches

**Usage:** `node scan-proposer-activity.js [-p PROPOSER] [-c CHAIN] [-m MAX_BLOCKS] [-h]`

### `scan-active-pools.js`

Scans for active liquidity pools and analyzes pool events on BEX (Berachain DEX).

**Usage:** `node scan-active-pools.js`

### `scan-berachef-activations.js`

Tracks BeraChef cutting board activations and reward distribution events.

**Usage:** `node scan-berachef-activations.js`

### `scan-deposits.js`

Analyzes validator deposit transactions and staking patterns.

**Usage:** `node scan-deposits.js`

### `scan-pool-events.js`

Monitors and analyzes pool-related events including swaps, joins, and exits.

**Usage:** `node scan-pool-events.js`

### `scan-state-changes.js`

Monitors blockchain state changes and contract storage modifications.

**Usage:** `node scan-state-changes.js`

### `find_day_boundaries.js`

Utility to find blocks at daily midnight UTC timestamps, useful for daily aggregation analysis.

**Usage:** `node find_day_boundaries.js`

### `analyze-block-granular.js`

Detailed granular analysis of individual block properties and characteristics.

**Usage:** `node analyze-block-granular.js`

## Common Options

All major scripts support:

- `-h, --help` - Show detailed help and usage information
- `-c, --chain NAME` - Specify network (mainnet/bepolia)
- `--blocks N` - Number of blocks to analyze
- `-a, --addresses` - Show validator addresses instead of names
- `-p, --proposer X` - Filter analysis to a specific proposer

## Dependencies

These scripts require:

- **Node.js** (v16 or later)
- **SQLite3**: For validator name lookups via `validators_correlated.db`
- **Berachain RPC access**: Both execution layer (EL) and consensus layer (CL) endpoints

The validator database is expected at `../cometbft-decoder/validators_correlated.db` by default, but can be overridden via the `VALIDATOR_DB_PATH` environment variable.

## Examples

Analyze the last 1000 blocks on mainnet:

```bash
node analyze-block-delays.js --blocks 1000 --chain mainnet
```

Check validator voting power distribution:

```bash
node analyze-voting-power.js -b 5000 -d
```

Find when a specific validator last proposed a block:

```bash
node scan-proposer-activity.js -p 0xYOUR_VALIDATOR_ADDRESS -c mainnet
```

Analyze block filling patterns by a specific proposer:

```bash
node analyze-block-filling.js -b 2000 -n "Validator Name"
```

## Getting Help

Run any script with `-h` or `--help` for detailed usage instructions and examples:

```bash
node analyze-block-delays.js -h
```
