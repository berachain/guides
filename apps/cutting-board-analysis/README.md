# Cutting Board Analysis

Analyzes validator cutting board usage and incentive distributions from Berachain.

## Installation

```bash
npm install
```

## Usage

```bash
node scan-cutting-board-usage.js [options]
```

### Options

- `-s, --start-date=DATE` - Start date for analysis (YYYY-MM-DD, default: 2025-12-16)
- `-e, --end-date=DATE` - End date for analysis (YYYY-MM-DD, defaults to end of yesterday)
- `-d, --days=N` - Number of days to analyze from start date
- `-c, --chain=NAME` - Chain to analyze: mainnet|bepolia (default: mainnet)
- `-r, --rpc=URL` - Custom execution layer RPC endpoint URL
- `--cl-rpc=URL` - Custom consensus layer RPC endpoint URL
- `-v, --validator-db=PATH` - Path to validator database (SQLite file, default: ./validator.sqlite)
- `-h, --help` - Show help message

### Examples

```bash
# Analyze from default start date to yesterday
node scan-cutting-board-usage.js

# Analyze 7 days starting from a specific date
node scan-cutting-board-usage.js --start-date=2025-12-18 --days=7

# Analyze a specific date range
node scan-cutting-board-usage.js --start-date=2025-12-26 --end-date=2025-12-31

# Use a custom validator database
node scan-cutting-board-usage.js --validator-db=/path/to/validators.db
```

## Output

The script generates a CSV file `cutting-board-analysis.csv` with the following columns:

- Validator Name
- Validator Pubkey
- Proposer Address
- For each date: `YYYY-MM-DD ACB %` and `YYYY-MM-DD USD`
- Final Stake

## Requirements

- Node.js
- sqlite3 command-line tool (for validator database access)
- Access to Berachain RPC endpoints (or custom RPC URLs)

## Validator Database

The script requires a SQLite database with validator information. The database should have a `validators` table with columns:
- `proposer_address`
- `name`
- `pubkey`
- `voting_power`
- `operator`
- `status`

By default, the script looks for `validator.sqlite` in the same directory. Use `--validator-db` to specify a different path.

