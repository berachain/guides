# Berps Trading Bot

An example of a trading bot for Berps using a Bollinger Band trading strategy. When the spot price goes above the upper band, the bot will sell. When the spot price goes below the lower band, the bot will buy.

Note: there is a max number of trades per pair (5 on bArtio), so this bot will not run indefinitely without modifications for closing open positions.

## Requirements

- NMV or Node `v20.11.0` or greater
- Wallet with testnet $HONEY tokens - See the [Berachain bArtio Faucet](https://bartio.faucet.berachain.com), receive $BERA and trade for $HONEY on [BEX](https://bartio.bex.berachain.com/swap)

## Quick Setup

### Step 1 - Install Dependencies

```bash
# FROM: ./berps-bot

pnpm install;
```

### Step 2 - Set Environment Variables

```bash
# FROM: ./berps-bot

cp .env.example .env;
```

Remember to change your private key.

**File:** `./.env`

```bash
# Wallet Configuration
PRIVATE_KEY="<YOUR_WALLET_PRIVATE_KEY>"
```

### Step 3 - Run Script

```bash
# FROM: ./berps-bot

ts-node src/index.ts;
# [Example Output]:
# Trading bot started
# 2024-04-19T00:00:30.729Z: Checking for trade at price: $3064.2602
# 2024-04-19T00:00:35.958Z: Checking for trade at price: $3063.2678
# Buy signal {
#   upperBand: 30664776725641.676,
#   lowerBand: 30642187016528.324,
#   currentPrice: 30632678175300
# }
# Placed buy order: 0xde3f0a3b176d2082d19d5677fc47cc389860690bc4b55ff8be3bb5e568fadedc
```
