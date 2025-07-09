# Block Scanners

This directory contains utilities for analyzing blockchain blocks and their patterns.

## Scripts

### find_monday_blocks.js

Finds blocks that occur at the beginning of each Monday (midnight UTC). Uses a binary search-like approach to efficiently locate blocks at specific timestamps.

**Usage:**
```bash
node find_monday_blocks.js
```

**Output:**
- CSV format with columns: "Week of Date", "Block Number"
- Logs detailed search process to stderr
- Finds blocks at midnight UTC on Mondays starting from Feb 10, 2025

### empty_blocks_scanner.js

Scans for empty blocks (blocks with zero transactions) and analyzes gas usage patterns by day. Provides configurable date ranges, batch processing, and visual progress indicators.

**Usage:**
```bash
# Scan the last 30 days (default)
node empty_blocks_scanner.js

# Scan specific date range
node empty_blocks_scanner.js --start-date 2025-01-01 --end-date 2025-01-31

# Scan from a specific start date to today
node empty_blocks_scanner.js --start-date 2025-01-15

# Custom performance settings
node empty_blocks_scanner.js --batch-size 200 --concurrency 20

# Show help
node empty_blocks_scanner.js --help
```

**Performance Options:**
- `--batch-size N`: Number of blocks to process in each batch (default: 100)
- `--concurrency N`: Number of concurrent requests (default: 10)
- `--start-date YYYY-MM-DD`: Start date for scanning (default: 30 days ago)
- `--end-date YYYY-MM-DD`: End date for scanning (default: today)

**Features:**
- **High Performance**: Batch processing with configurable concurrency
- **Empty Block Detection**: Identifies blocks with zero transactions
- **Gas Usage Analysis**: Tracks average, min, max gas usage and utilization percentages
- **Progress Bars**: Visual progress indicators for each day's scanning
- **Detailed Logging**: Emojis and formatted output for better readability
- **Clean Output**: Focused summary table with essential metrics
- **Exact Block Boundaries**: Finds precise midnight UTC transitions
- **Automatic Optimization**: Parallel RPC calls and efficient batch processing

**Output:**
- **Professional Table**: Uses cli-table3 for clean, formatted output with colored headers
- **Progress Bars**: Real-time progress indicators during scanning with gas utilization info
- **Gas Analytics**: Gas utilization percentages and total consumption stats
- **Daily Breakdown**: Per-day analysis of empty blocks and gas patterns

## Configuration

Both scripts are configured to use:
- RPC URL: `http://192.168.2.69:40003`
- Reference block: 933558 (2025-02-10 16:45:14 UTC)
- Block time: 2 seconds

## Technical Details

Both scripts use the same core techniques:
- JSON-RPC calls to blockchain node
- Binary search approach to find blocks at specific timestamps
- Efficient timestamp-to-block conversion using estimated block times
- Boundary detection to find exact midnight transitions
- Rate limiting to avoid overwhelming the RPC endpoint

The empty blocks scanner extends these techniques to:
- Process daily ranges instead of weekly milestones
- Count transaction-less blocks within each day
- Provide incremental progress reporting
- Handle configurable date ranges 