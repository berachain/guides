# Block Scanners

This directory contains utilities for analyzing blockchain blocks and their patterns.

## Scripts

Each script includes inline help and detailed comments explaining usage, configuration, and functionality. Just browse the source code or run the scripts to see what they do.

### Available Scripts

- `analyze-block-delays.js` - Analyzes how each validator's block proposals affect subsequent block timing and participation
- `analyze-validator-voting.js` - Scans validator voting patterns and missed blocks over time  
- `analyze-voting-power.js` - Voting power analysis and validator performance metrics
- `proposer-delay-analysis.js` - Analyzes average delays between consecutive blocks by proposer
- `find_monday_blocks.js` - Finds blocks at Monday midnight UTC timestamps
- `scan-block-filling.js` - Scans block gas usage and transaction patterns
- `scan-deposits.js` - Analyzes deposit transactions and patterns
- `scan-distributions.js` - Tracks reward distribution events
- `scan-state-changes.js` - Monitors blockchain state changes
- `scan-transactions-by-client.js` - Groups transactions by client software

## Configuration

Scripts use:
- RPC URL: `http://37.27.231.195:59820` (configurable in each script)
- Validator database: `../cometbft-decoder/validators_correlated.db` (for name lookups)
- Most scripts scan backwards from current block height

Run any script without arguments to see its specific usage and configuration options.