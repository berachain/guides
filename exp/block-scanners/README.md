# Block Scanners

This directory contains utilities for analyzing blockchain blocks and their patterns on Berachain networks.

## Configuration

All scripts use the consolidated configuration from `../config.js` which supports:

- Environment variable overrides
- Network-specific settings (mainnet/bepolia)
- Validator database integration
- Configurable RPC endpoints

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

### Other Scripts

- `find_day_boundaries.js` - Finds blocks at daily midnight UTC timestamps
- `scan-deposits.js` - Analyzes deposit transactions and patterns
- `scan-state-changes.js` - Monitors blockchain state changes

## Common Options

All major scripts support:

- `-h, --help` - Show detailed help and usage information
- `-c, --chain NAME` - Specify network (mainnet/bepolia)
- `--blocks N` - Number of blocks to analyze
- `-a, --addresses` - Show validator addresses instead of names
- `-p, --proposer X` - Filter analysis to a specific proposer

## Dependencies

Scripts require:

- Node.js with axios, ethers, yargs
- SQLite3 for validator name lookups
- Access to `validators_correlated.db` database
- Berachain RPC endpoints (configurable via config.js)

Run any script with `-h` for detailed usage instructions and examples.
