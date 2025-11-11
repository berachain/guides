# Validators

This repo containts a script that retrieves all deposits and then retrieves all operators addresses and best identifies validators

## Requirements

- Node v22.14.0 or greater
- Pnpm
- Dedicated RPC for Berachain Mainnet - Public RPC will likely not work

## Files

```bash
# FROM: ./
.
├── files # Main output of final files for deposits and validators
│   ├── deposits.csv # All deposits found
│   ├── validators.csv # All validators found
│   ├── allocations.csv # All validators current allocations
│   └── rewards.csv # All reward vaults stats
├── out # Temporary directory for downloaded files like genesis and metadata
├── src # Where main script
    ├── deposits.ts # Step 1 - Gets all deposits from BeaconDeposit contract
    ├── pubkeys.ts # Step 2 - Gets all operator addresses and names associated to validators
    ├── allocations.ts # Step 3 - Gets all reward allocations based on validators
    └── rewards.ts # Step 4 - Gets an idea of how rewards are allocated by validators
```

## QuickStart

The output result should be the following:

```bash
├── files
    ├── deposits.csv
    ├── validators.csv
    ├── allocations.csv
    └── rewards.csv
```

### 1. Install Dependencies

```bash
# FROM: /

pnpm install;
```

### 2. Adjust Environment Variables

```bash
# FROM: /

cp .env.example .env;
```

Make adjustment to environment variable

**File:** `./.env`

```bash
BERACHAIN_RPC_URL=<YOUR_BERACHAIN_MAINNET_DEDICATED_RPC>
```

### 3.Run Deposits

```bash
# FROM: ./

pnpm deposits;
```

### 4. Run Pubkeys

> **NOTE:** Deposits are required before this can be run

```bash
# FROM: ./

pnpm pubkeys;
```

### 4. Run Allocations

> **NOTE:** Pubkeys are required before this can be run

```bash
# FROM: ./

pnpm allocation;
```

### 5. Run Rewards

> **NOTE:** Allocations are required before this can be run

```bash
# FROM: ./

pnpm rewards;
```

## Author

[@codingwithmanny](https://github.com/codingwithmanny)
