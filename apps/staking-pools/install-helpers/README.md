# Staking Pool Operator CLI

Node standard-library CLI for validator operators **on the validator host** (next to `beacond` and `BEACOND_HOME`). Deploy a staking pool, activate your validator, and check status — with every state-changing command dry-running first (`cast call` preflight + decoded authorization summary), then **printing a copy-paste `cast send`** for signing on another machine (ledger on a laptop). Optional `--execute` broadcasts on the validator only when `PRIVATE_KEY` is set (hot key).

Retail **stake** and **unstake** are not in this toolkit. Use the sample frontend at `../frontend/`.

## Run on the validator

Install Node.js 22+, Foundry `cast`, and `beacond` on the **validator host**. Set `BEACOND_HOME` to your beacond data directory. The CLI refuses to run deploy/activate/set-min-balance if `BEACOND_HOME` is missing or `beacond` cannot read validator keys.

Copy `env.sh.template` to `env.sh` for optional env vars and for the retained delegation scripts:

```bash
cp env.sh.template env.sh
# edit BEACOND_HOME, optional PRIVATE_KEY for hot-key --execute
source env.sh
```

## Dependencies

| Tool | Purpose |
| --- | --- |
| Node.js 22+ | CLI runtime (`node:test` suite) |
| Foundry `cast` | All EVM reads and writes |
| `beacond` | Validator pubkey, deposit validation, genesis network detection |

No npm packages, lockfile, or `node_modules` on CLI-owned files. Legacy `package.json` in this directory is retained for the Foundation-delegated flow.

Forbidden in CLI code paths: `jq`, `bc`, `python3`, `curl`, ethers, web3.

## Configuration

| Variable | Purpose |
| --- | --- |
| `BEACOND_HOME` | beacond data directory (**required** on validator host) |
| `BEACOND_BIN` | Override beacond binary (default: `beacond` in `$PATH`) |
| `CLI_CHAIN` | `mainnet` or `bepolia` (auto-detected from genesis when omitted) |
| `RPC_URL` / `EL_RPC_URL` | Override EL RPC (defaults: public Berachain endpoints) |
| `CL_NODE_API_URL` / `NODE_API_ADDRESS` | CL REST API for activation proofs (default: `http://127.0.0.1:3500`) |
| `PRIVATE_KEY` | Optional hot key on validator; required for `--execute` |

Do **not** set `CHAIN=` in the environment when running this CLI — Foundry `cast` treats `CHAIN` as its own flag and rejects values like `bepolia`. Use `CLI_CHAIN` instead.

## Commands

Entrypoint: `node pool-cli.mjs <command> [options]`

### Operator flow

1. **Deploy** pool contracts + 10,000 BERA initial deposit (dry-run, then copy-paste `cast send`)
2. Wait for beacon-chain validator registration
3. **Activate** with CL proofs (dry-run, then copy-paste `cast send`; 10-minute proof window)
4. **Status** telemetry
5. Optional **set-min-balance** (default 250,000 BERA; dry-run, then copy-paste `cast send`)

### Copy-paste ledger signing

After dry-run, the CLI prints a complete `cast send … --ledger` command. Run that on your **laptop** (or any machine with your ledger). The validator host does not need a ledger attached.

### Optional hot-key `--execute`

To broadcast directly from the validator (no second machine), set `PRIVATE_KEY` and pass `--execute`. Without `PRIVATE_KEY`, `--execute` is refused and the emitted command is still printed.

### `deploy`

```bash
node pool-cli.mjs deploy --op 0xOperator --sr 0xSharesRecipient
# copy-paste the printed cast send on your signing machine
node pool-cli.mjs deploy --op 0x... --sr 0x... --execute   # requires PRIVATE_KEY
```

Dry-run: `beacond deposit validate`, predicted addresses from `predictStakingPoolContractsAddresses`, `cast call` preflight, 10,000 BERA value shown before emit. Not an event decode.

### `activate`

```bash
node pool-cli.mjs activate
node pool-cli.mjs activate --execute   # requires PRIVATE_KEY on validator
```

Fetches three CL proofs via Node `fetch` from the local CL API (default `http://127.0.0.1:3500`), pins head slot, derives EIP-4788 timestamp from EL block `slot+1`, preflights `activateStakingPool`, enforces 10-minute expiry before emit. Test hook: `--now <unix>` injects clock for expiry checks.

### `status`

```bash
node pool-cli.mjs status
```

Read-only via `cast`: contract addresses (with code checks), beacon operator match, active / not-active / fully-exited, assets/supply, threshold, buffered assets, min effective balance, WBERA disposition, legacy BGT when present. With `PRIVATE_KEY`, also wallet stBERA and withdrawal NFTs.

### `set-min-balance` (optional)

```bash
node pool-cli.mjs set-min-balance              # dry-run + emit, default 250,000 BERA
node pool-cli.mjs set-min-balance --amount 300000 --execute
```

Omission of this command is not an error. Default amount when `--amount` is omitted: **250,000 BERA**.

## Tests

From this directory:

```bash
node --test test/*.test.mjs
```

## Retained bash

Until the delegated CLI lands: `lib-common.sh`, `env.sh.template`, `package.json`, `delegator-*.sh`, `delegated-*.sh`, and `generate-frontend-config.sh`.
