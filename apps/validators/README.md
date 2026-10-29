# pubkey-deposits

Bash scripts that scan Berachain mainnet for validator deposits and withdrawal requests, then write CSVs of remaining stake, reward-vault allocations, and how BGT is directed.

Run them in this order. `deposits.sh` and `exits.sh` are independent of each other.

1. `scripts/deposits.sh` writes `files/deposits.csv`
2. `scripts/exits.sh` writes `files/exits.csv`
3. `scripts/pubkeys.sh` writes `files/validators.csv`
4. `scripts/allocations.sh` writes `files/allocations.csv`
5. `scripts/rewards.sh` writes `files/rewards.csv`
6. `scripts/validator.sh` prints one validator's history from those files. `--output` also writes that history to a CSV.

## Requirements

Install these before the first run:

- [Foundry](https://book.getfoundry.sh/getting-started/installation), for `cast`
- `jq`, `curl`, `awk`, `sort`, `cut`, and `date`
- `node`, for `scripts/rewards.sh`
- `bc`, for `scripts/validator.sh`
- A Berachain execution RPC. The default is `https://rpc.berachain.com`

The first run of `deposits.sh` or `exits.sh` downloads beacon genesis to `out/genesis.json` when that file is missing. `pubkeys.sh` downloads validator metadata to `out/validators/mainnet.json`. `allocations.sh` downloads vault metadata to `out/vaults/mainnet.json`. Those downloads need access to GitHub.

Paths inside `scripts/deposits.sh`, `exits.sh`, `pubkeys.sh`, `allocations.sh`, and `validator.sh` are resolved from the script location. `scripts/rewards.sh` reads and writes `files/` relative to the current directory, so run it from the repository root.

## Configuration

Create `.env` at the repository root. A variable already set in the shell is kept. `.env` supplies a name only when it is unset.

```
RPC_URL=https://rpc.berachain.com
CHUNK_SIZE=10000
```

`RPC_URL` is the execution RPC for `deposits.sh`, `exits.sh`, `pubkeys.sh`, and `allocations.sh`.

`CHUNK_SIZE` is the number of blocks in each log query for `deposits.sh` and `exits.sh`. The default is `9999`. Use a smaller value when an RPC rejects large `eth_getLogs` ranges.

Set either value for a single run by putting it on the command:

```bash
RPC_URL=https://rpc.berachain.com CHUNK_SIZE=2000 ./scripts/deposits.sh
```

`END_BLOCK` defaults to the latest block at the start of a scan. `END_BLOCK=0` follows the chain head, including blocks produced while the scan is running. `START_BLOCK` defaults to `516370` for deposits and `4021622` for exits (the Berachain Bectra upgrade, 2025-06-04).

## Output files

| File | Script | What each row is |
| --- | --- | --- |
| `files/deposits.csv` | `deposits.sh` | One deposit. `source` is `genesis` or `execution`. `amount` is BERA. |
| `files/exits.csv` | `exits.sh` | One withdrawal request. `request_type` is `Full exit` or `Partial withdrawal`. |
| `files/validators.csv` | `pubkeys.sh` | One pubkey: name, operator, stake, status, proposal share, estimated daily BERA, and dates. |
| `files/allocations.csv` | `allocations.sh` | One validator, with up to 10 reward-vault slots. |
| `files/rewards.csv` | `rewards.sh` | One reward vault, with how many validators direct stake to it. |

`validators.csv` stake is deposited BERA minus partial withdrawals. A full exit sets stake to `0`. Consensus rewards are omitted. `status` is `active` at 250,000 BERA or more, and `inactive` below that. `block_proposal` is that validator's share of total stake. `est_bera_24h` is that share times the on-chain base rate times 43,200 (one day of 2-second blocks).

`allocations.csv` stores each slot as an address, a name and protocol from vault metadata, a raw numerator (`10000` is 100%), and `allocationN_percentage` (the numerator divided by 100, so `3000` is `30`).

`rewards.csv` columns:

- `validatorsDirectingRewards` is the number of validators with that vault in any slot
- `validatorsDirectingPercentage` is that count divided by the number of validator rows, times 100
- `bgtDirectingPercentage` is the average allocation percentage across validator rows

## Quickstart

### deposits.sh

Scan from the default start block through the chain head and write `files/deposits.csv`. Genesis deposits are written first.

```bash
./scripts/deposits.sh
```

Use another RPC, a smaller log window, and an explicit output path:

```bash
RPC_URL=https://rpc.berachain.com CHUNK_SIZE=2000 ./scripts/deposits.sh ./files/deposits.csv
```

Scan a fixed range, or follow the head:

```bash
START_BLOCK=516370 END_BLOCK=1000000 ./scripts/deposits.sh
START_BLOCK=516370 END_BLOCK=0 CHUNK_SIZE=2000 ./scripts/deposits.sh
```

`--append` scans only `START_BLOCK` through `END_BLOCK`, skips genesis, and adds deposits whose index is not already in the CSV. Both block variables are required.

```bash
START_BLOCK=15403512 END_BLOCK=0 ./scripts/deposits.sh --append
```

Skip genesis on a full run with `INCLUDE_GENESIS=0`. If `deposit-blocks.csv` exists, the scan queries those blocks inside the range, then continues after the last listed block. Point at another list with `DEPOSIT_BLOCKS`. Point at another genesis file with `GENESIS_FILE`.

```bash
INCLUDE_GENESIS=0 ./scripts/deposits.sh
DEPOSIT_BLOCKS=./deposit-blocks.csv GENESIS_FILE=./out/genesis.json ./scripts/deposits.sh
```

### exits.sh

Scan withdrawal requests on the EIP-7002 predeploy and write `files/exits.csv`. An amount of 0 gwei is a full exit. Any other amount is a partial withdrawal.

```bash
./scripts/exits.sh
```

```bash
RPC_URL=https://rpc.berachain.com CHUNK_SIZE=10000 ./scripts/exits.sh ./files/exits.csv
```

```bash
START_BLOCK=4021622 END_BLOCK=5000000 ./scripts/exits.sh
START_BLOCK=4021622 END_BLOCK=0 CHUNK_SIZE=10000 ./scripts/exits.sh
```

`--append` adds requests whose transaction and log index are not already in the CSV. Both block variables are required.

```bash
START_BLOCK=4021622 END_BLOCK=0 CHUNK_SIZE=10000 ./scripts/exits.sh --append
```

`index` is filled from `out/genesis.json` when that pubkey was a genesis validator. `GENESIS_FILE` selects another genesis file.

### pubkeys.sh

Build `files/validators.csv` from `files/deposits.csv` and `files/exits.csv`. This calls the chain for each operator address and the reward base rate, so `RPC_URL` applies here. `CHUNK_SIZE` does not.

```bash
./scripts/pubkeys.sh
```

```bash
RPC_URL=https://rpc.berachain.com ./scripts/pubkeys.sh ./files/validators.csv
```

```bash
DEPOSITS=./files/deposits.csv EXITS=./files/exits.csv ./scripts/pubkeys.sh
```

`--append` adds pubkeys that are not already listed. Rows already in the file stay as they are. New rows use each validator's share of current total stake.

```bash
./scripts/pubkeys.sh --append
```

### allocations.sh

Read `files/validators.csv` and write `files/allocations.csv` from `getActiveRewardAllocation`. `RPC_URL` selects the RPC. `ALLOC_BATCH` is how many validators are read per multicall (default `20`).

```bash
./scripts/allocations.sh
```

```bash
RPC_URL=https://rpc.berachain.com ./scripts/allocations.sh ./files/allocations.csv
```

```bash
ALLOC_BATCH=10 RPC_URL=https://rpc.berachain.com ./scripts/allocations.sh
VALIDATORS=./files/validators.csv ./scripts/allocations.sh
```

### rewards.sh

From the repository root, roll `files/allocations.csv` up into `files/rewards.csv`, one row per vault. This script does not call the chain.

```bash
./scripts/rewards.sh
```

### validator.sh

Print every deposit and exit for one pubkey, plus remaining stake and the status from `files/validators.csv`. The pubkey is 48 bytes (96 hex characters). This script does not call the chain.

```bash
./scripts/validator.sh --pubkey 0x82ba04ebb0d7544e0a1737873d6f161b3292732735a2b224c3a7de6eff0a82631dd80b50c59991f43bc2a3a4032bc34d
```

`--output` writes the same deposit and exit rows to a CSV. Each row also carries the summary and status. With no path, the file is `files/<pubkey>.csv`.

```bash
./scripts/validator.sh --pubkey 0x82ba04ebb0d7544e0a1737873d6f161b3292732735a2b224c3a7de6eff0a82631dd80b50c59991f43bc2a3a4032bc34d --output
```

```bash
./scripts/validator.sh --pubkey 0x82ba04ebb0d7544e0a1737873d6f161b3292732735a2b224c3a7de6eff0a82631dd80b50c59991f43bc2a3a4032bc34d \
  --output ./files/custom.csv
```

```bash
DEPOSITS=./files/deposits.csv EXITS=./files/exits.csv VALIDATORS=./files/validators.csv \
  ./scripts/validator.sh --pubkey 0x82ba04ebb0d7544e0a1737873d6f161b3292732735a2b224c3a7de6eff0a82631dd80b50c59991f43bc2a3a4032bc34d
```
