# Staking Pool Operator CLI

Node standard-library CLI for validator operators deploying and activating a staking pool on Berachain. Every state-changing command dry-runs first (`cast call` preflight + decoded authorization summary), then broadcasts with `--execute` (`cast send`, `--ledger` by default).

Retail **stake** and **unstake** are not in this toolkit. Use the sample frontend at `../frontend/`.

## Dependencies

| Tool | Purpose |
| --- | --- |
| Node.js 22+ | CLI runtime (`node:test` suite) |
| Foundry `cast` | All EVM reads and writes |
| `beacond` | Validator pubkey, deposit validation, genesis network detection |

No npm packages, lockfile, or `node_modules` on CLI-owned files. Legacy `package.json` in this directory is retained for the Foundation-delegated flow (BERA-944).

Forbidden in CLI code paths: `jq`, `bc`, `python3`, `curl`, ethers, web3.

## Configuration

Copy the template for delegation scripts and optional env vars:

```bash
cp env.sh.template env.sh
# edit BEACOND_HOME, NODE_API_ADDRESS / CL_NODE_API_URL, PRIVATE_KEY
source env.sh
```

| Variable | Purpose |
| --- | --- |
| `BEACOND_HOME` | beacond data directory (required for deploy/activate/status) |
| `BEACOND_BIN` | Override beacond binary (default: `beacond` in `$PATH`) |
| `CHAIN` / `CLI_CHAIN` | `mainnet` or `bepolia` (auto-detected from genesis when omitted) |
| `RPC_URL` / `EL_RPC_URL` | Override EL RPC (defaults: public Berachain endpoints) |
| `CL_NODE_API_URL` / `NODE_API_ADDRESS` | CL REST API for activation proofs (**required for activate**; no baked host) |
| `PRIVATE_KEY` | Optional; defaults to `--ledger` for `--execute` |

## Commands

Entrypoint: `node pool-cli.mjs <command> [options]`

### Operator flow

1. **Deploy** pool contracts + 10,000 BERA initial deposit  
2. Wait for beacon-chain validator registration  
3. **Activate** with CL proofs (10-minute proof window)  
4. **Status** telemetry  
5. Optional **set-min-balance** (default 250,000 BERA)

### `deploy`

```bash
node pool-cli.mjs deploy --op 0xOperator --sr 0xSharesRecipient
node pool-cli.mjs deploy --op 0x... --sr 0x... --execute
```

Dry-run: `beacond deposit validate`, predicted addresses, `cast call` preflight, decoded `StakingPoolContractsDeployed` summary, 10,000 BERA value shown before signing.

### `activate`

```bash
export CL_NODE_API_URL=http://127.0.0.1:3500   # or NODE_API_ADDRESS
node pool-cli.mjs activate
node pool-cli.mjs activate --execute
```

Fetches three CL proofs via Node `fetch`, pins head slot, derives EIP-4788 timestamp from EL block `slot+1`, preflights `activateStakingPool`, enforces 10-minute expiry on execute. Test hook: `--now <unix>` injects clock for expiry checks.

### `status`

```bash
node pool-cli.mjs status
```

Read-only via `cast`: contract addresses (with code checks), beacon operator match, active / not-active / fully-exited, assets/supply, threshold, buffered assets, min effective balance, WBERA disposition, legacy BGT when present. With `PRIVATE_KEY`, also wallet stBERA and withdrawal NFTs.

### `set-min-balance` (optional)

```bash
node pool-cli.mjs set-min-balance              # dry-run, default 250,000 BERA
node pool-cli.mjs set-min-balance --amount 300000 --execute
```

Omission of this command is not an error. Default amount when `--amount` is omitted: **250,000 BERA**.

## Tests

From this directory:

```bash
node --test test/*.test.mjs
```

## Retained bash (BERA-944)

Until the delegated CLI lands: `lib-common.sh`, `env.sh.template`, `package.json`, `delegator-*.sh`, `delegated-*.sh`, and `generate-frontend-config.sh`.
