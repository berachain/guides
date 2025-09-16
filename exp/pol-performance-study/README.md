# Validator POL Performance Study

A comprehensive analysis tool for Berachain validator performance that evaluates validators across multiple dimensions including uptime, Proof of Liquidity (POL) participation, and economic value generation.

## What This Script Does

The `score-validators.js` script analyzes Berachain validator performance by:

1. **Scanning blockchain data** across specified day ranges to track validator behavior
2. **Indexing POL events** to capture BGT vault emissions and booster token incentives
3. **Calculating multi-dimensional scores** based on technical and economic performance
4. **Generating detailed reports** with rankings and incentive distribution matrices

## 4-Metric Scoring System

The script calculates validator scores using four equally-weighted metrics (25% each):

### 1. Uptime Score (0-100%)
- **Formula**: `100 - (empty_blocks / total_blocks * 100)`
- **What it measures**: How consistently validators produce non-empty blocks
- **Perfect score**: 100% (no empty blocks)
- **Calculation**: Inverted empty block percentage - fewer empty blocks = higher score

### 2. POL Score (0-100%)  
- **Formula**: `(validator_pol_ratio / max_daily_pol_ratio) * 100`
- **What it measures**: Validator's BGT boost relative to their stake, compared to the best performer
- **Perfect score**: 100% (highest boost/stake ratio of the day)
- **Calculation**: Normalized against the day's maximum POL ratio

### 3. Economic Score (0-100%)
- **Formula**: `(validator_economic_value / max_daily_economic_value) * 100`
- **What it measures**: Total USD value generated from vault emissions and booster incentives
- **Perfect score**: 100% (highest absolute economic value of the day)
- **Calculation**: Normalized against the day's maximum economic output

### 4. Stake-Scaled Economic Score (0-100%)
- **Formula**: `(validator_economic_value_per_stake / max_daily_economic_per_stake) * 100`
- **What it measures**: Economic efficiency - how much value generated per unit of stake
- **Perfect score**: 100% (highest economic value per stake ratio of the day)
- **Calculation**: Economic value divided by stake, normalized against day's maximum

### Total Score
- **Formula**: `(uptime_score + pol_score + economic_score + stake_scaled_economic_score) / 4`
- **Range**: 0-100%
- **Interpretation**: Higher scores indicate better overall validator performance

## Data Sources

### Blockchain Events
- **Distributed Events**: BGT emissions from vaults to validators
- **BGTBoosterIncentivesProcessed Events**: Booster token incentives to validators
- **Block Proposer Data**: From consensus layer to track which validator proposed each block
- **Validator Voting Power**: Stake amounts from consensus layer
- **BGT Boost Data**: From BGT smart contract `boostees()` function

### External APIs
- **Kyberswap API**: For token USD exchange rates
- **Special Handling**: 
  - HONEY token: 1:1 USD peg
  - BGT token: Priced via WBERA substitute (1:1 convertible)

## Output Files

### 1. `validator_stats.csv`
Detailed validator rankings with:
- Basic info (name, addresses, pubkey)
- Current stake amount
- All 4 individual scores and total score
- Optional: Daily breakdown with full metrics (if `VERBOSE=true`)

### 2. `validator_incentive_summary.csv`
Validator vs token incentive matrix with:
- **Rows**: All validators
- **Columns**: All discovered incentive tokens (BGT vaults + booster tokens)
- **Header Row 1**: Token names and addresses
- **Header Row 2**: USD exchange rates per token
- **Data**: Token amounts earned by each validator
- **Totals**: Row and column totals

## Usage Examples

```bash
# Quick test - analyze yesterday only
node score-validators.js --days=1

# Weekly analysis
node score-validators.js --days=7

# Full analysis (default)
node score-validators.js --days=45

# Verbose output with daily breakdowns
VERBOSE=true node score-validators.js --days=7

# High memory usage for large analyses
node --max-old-space-size=8192 score-validators.js --days=45
```

## Key Features

### Performance Optimizations
- **Parallel block scanning**: Uses multiple CPU cores for faster processing
- **Chunked log fetching**: Prevents memory crashes on large block ranges
- **BigInt arithmetic**: Handles large token amounts without precision loss
- **Caching**: Token decimals, names, and USD rates are cached
- **Progress bars**: Visual feedback for long-running operations

### Error Handling
- **Automatic retries**: Network failures are retried with exponential backoff
- **Graceful degradation**: Individual failures don't crash the entire analysis
- **Memory management**: Chunked processing prevents JavaScript memory limits

### Economic Analysis
- **Real-time pricing**: Uses Kyberswap for current token values
- **Multi-token support**: Handles 19+ different incentive tokens
- **Stake normalization**: Accounts for validator stake size in efficiency metrics
- **USD conversion**: All values normalized to USD for comparison

## Requirements

- **Node.js**: ES modules support
- **Foundry**: `cast` command for smart contract calls
- **RPC Access**: Berachain execution and consensus layer endpoints
- **CSV File**: `genesis_validators.csv` with validator information

## Environment Variables

- `EL_ETHRPC_URL`: Execution layer RPC endpoint
- `CL_ETHRPC_URL`: Consensus layer RPC endpoint  
- `VERBOSE`: Set to 'true' for detailed logging
- `HONEY_TOKEN`: HONEY token contract address (optional)
- `DISTRIBUTOR_ADDRESS`: Distributor contract address (optional)

This tool provides a comprehensive view of validator performance that goes beyond simple uptime metrics to include economic contribution and efficiency measures, giving a more complete picture of validator value to the network.
