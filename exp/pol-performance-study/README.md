# Validator POL Performance Study

This script provides a comprehensive analysis of Berachain validator performance by examining both technical reliability and economic contribution to the Proof of Liquidity (POL) ecosystem. Rather than focusing solely on uptime metrics, it evaluates validators across four key dimensions to provide a holistic view of their value to the network.

## How It Works

The analysis begins by scanning blockchain data across a specified time period, typically ranging from a single day for quick testing up to 45 days for comprehensive evaluation. The script identifies day boundaries by finding the exact blocks where each UTC day begins, then systematically processes all blocks within those ranges.

For each day, the script collects three types of data. First, it scans every block to identify which validator proposed it and whether the block was empty (containing only the mandatory coinbase transaction). Second, it queries the consensus layer to obtain each validator's stake amount and the execution layer to fetch their BGT boost amounts from smart contracts. Third, it indexes POL events from the blockchain to capture BGT vault emissions and booster token incentives distributed to validators.

The economic analysis involves fetching real-time token prices from the Kyberswap API, with special handling for HONEY (which maintains a 1:1 USD peg) and BGT (which is priced via WBERA since they're convertible 1:1). All token amounts are processed using BigInt arithmetic to handle the large numbers involved in blockchain calculations without losing precision.

## Scoring Methodology

The script calculates four distinct scores for each validator, each normalized to a 0-100% scale where 100% represents the best performer for that metric on that day.

**Uptime Score** measures technical reliability using the formula:
```
Uptime Score = 100 - (empty_blocks / total_blocks × 100)
```
This inverted empty block percentage rewards validators who consistently include transactions in their blocks rather than producing empty ones.

**Boost/Stake Ratio Score** evaluates participation in the Proof of Liquidity system:
```
Boost/Stake Ratio Score = (validator_boost_stake_ratio / daily_max_boost_stake_ratio) × 100
```
This measures how effectively a validator leverages BGT boost relative to their stake, normalized against the day's best performer.

**BGT→Vault/Stake Score** measures stake-scaled BGT vault earnings:
```
BGT→Vault/Stake Score = (validator_bgt_vault_usd_per_stake / daily_max_bgt_vault_usd_per_stake) × 100
```
This reflects how effectively a validator generates BGT vault emissions relative to their stake size, measuring the flow of BGT from the protocol to validator vaults.

**Incentive→User/Stake Score** measures stake-scaled booster incentive distribution:
```
Incentive→User/Stake Score = (validator_booster_incentive_usd_per_stake / daily_max_booster_incentive_usd_per_stake) × 100
```
This captures how well a validator attracts and distributes booster token incentives to users relative to their stake, indicating success in driving user engagement in the POL ecosystem.

The final score combines all four metrics with equal weighting:
```
Total Score = (Uptime + Boost/Stake Ratio + BGT→Vault/Stake + Incentive→User/Stake) / 4
```

## Analysis Process

The script follows a systematic six-step process:

**Step 1: Day Boundary Detection**
The script calculates exact block numbers for midnight UTC on each day being analyzed, using binary search against block timestamps to find precise boundaries.

**Step 2: Block Scanning**
Every block in the analysis period is scanned in parallel to identify the proposer and determine if the block is empty. This data feeds into the uptime calculations.

**Step 3: Stake and Boost Collection**
For each day boundary, the script queries the consensus layer for validator stake amounts and the BGT smart contract for boost amounts, providing the data needed for POL scoring.

**Step 4: POL Event Indexing**
The script scans for `Distributed` events (BGT vault emissions) and `BGTBoosterIncentivesProcessed` events (booster token incentives) to capture the economic value flowing to each validator.

**Step 5: USD Valuation**
Token amounts are converted to USD values using real-time exchange rates from Kyberswap, with the economic calculations performed using BigInt arithmetic to maintain precision.

**Step 6: Scoring and Reporting**
Daily metrics are calculated and averaged across the analysis period, then validators are ranked by their total scores and detailed reports are generated.

## Output

The analysis produces two complementary reports with detailed column structures.

### validator_stats.csv

**Main Columns:**
- `Validator name` - Validator display name
- `Pubkey` - Validator public key
- `Proposer` - Consensus layer address
- `Operator` - Execution layer address
- `Stake` - Current stake amount in BERA
- `Uptime Score` - Empty block performance (0-100%)
- `Boost/Stake Ratio Score` - POL participation efficiency (0-100%)
- `BGT→Vault/Stake Score` - BGT vault earnings per stake (0-100%)
- `Incentive→User/Stake Score` - Booster incentive distribution per stake (0-100%)
- `Total Score` - Average of all 4 scores (0-100%)

**VERBOSE Mode Additional Columns (per analyzed date):**
When `VERBOSE=true` or `VERBOSE=1`, 7 additional columns are added for each day:
- `{date} BGT boost` - BGT boost amount for that day
- `{date} stake` - Validator stake for that day
- `{date} empty blocks` - Number of empty blocks proposed
- `{date} total blocks` - Total blocks proposed
- `{date} boost/stake ratio` - POL ratio for that day
- `{date} BGT→vault USD` - USD value of BGT flowing to validator vaults
- `{date} incentive→user USD` - USD value of booster tokens flowing to users

Note: Calculated values like empty block percentage and total USD are omitted since they can be derived from the raw data.

### validator_incentive_summary.csv

This file presents a matrix view showing exactly which tokens each validator earned and in what quantities. The matrix includes a second header row displaying the USD exchange rate for each token, making it easy to understand both the token distribution and economic impact.

## Usage

Run the script with `node score-validators.js --days=N` where N is the number of days to analyze. Use `--days=1` for quick testing, `--days=7` for weekly analysis, or the default 45 days for comprehensive evaluation. Set `VERBOSE=true` for detailed daily breakdowns and additional logging.
