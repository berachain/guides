# Staking Pool Operator CLI

Node standard-library CLI for validator operators **on the validator host** (next to `beacond` and `BEACOND_HOME`). Deploy a staking pool, activate your validator, stake, unstake, and check status — with every state-changing command dry-running first (`cast call` preflight), then **printing a copy-paste `cast send`** for signing on another machine (ledger on a laptop). Optional `--execute` broadcasts on the validator only when `PRIVATE_KEY` is set (hot key).

## Run on the validator

Install Node.js 22+, Foundry `cast`, and `beacond` on the **validator host**. Set `BEACOND_HOME` to your beacond data directory. The CLI refuses to run deploy/activate/set-min-balance/stake/unstake if `BEACOND_HOME` is missing or `beacond` cannot read validator keys.

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
| `RPC_URL` / `EL_RPC_URL` | Override EL RPC (defaults: public Berachain endpoints). When CL is `127.0.0.1`, set this to the local execution RPC or EIP-4788 reads a different node. |
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
5. **Stake** extra BERA (`submit`), **unstake** (`requestWithdrawal` / `requestRedeem`, then `--finalize`)
6. Optional **set-min-balance** (default 250,000 BERA; dry-run, then copy-paste `cast send`)

### Copy-paste ledger signing

After dry-run, the CLI prints a complete `cast send … --ledger` command. Run that on your **laptop** (or any machine with your ledger). The validator host does not need a ledger attached. Cold-signing commands default to `--ledger`; pass `--signing-preference key` (or set it via env) if you'd rather the printed command sign with your own private key. This is a print-string choice only — the CLI never reads a key either way, and it is never asked for interactively.

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

Fetches three CL proofs via Node `fetch` from the local CL API (default `http://127.0.0.1:3500`). Pins `min(CL head, EL latest - 1) - 5` so the EIP-4788 EL block (`slot+1`) already exists. The CL and EL stay in lockstep on Berachain, so a 5-slot cushion should never be exhausted in practice. Preflights `activateStakingPool` and enforces 10-minute expiry before emit. Test hook: `--now <unix>` injects clock for expiry checks.

### `status`

```bash
node pool-cli.mjs status
```

Read-only via `cast` plus one Beacon API lookup (`GET /eth/v1/beacon/states/head/validators/<pubkey>`). Reports three separate facts:

1. EL operator match on the beacon deposit contract
2. Beacon inclusion (`not in head state` vs `index` + CL `status`)
3. Pool contract `isActive`

`isActive=false` is normal after deploy. It does not mean "run activate now." After deploy, wait until status says the beacon has the validator. Then run `activate`. The CLI also prints that next action.

When the pool is active: contract addresses (with code checks), assets/supply, threshold, buffered assets, min effective balance, WBERA disposition, legacy BGT when present. With `PRIVATE_KEY`, also wallet stBERA and withdrawal NFTs.

### `set-min-balance` (optional)

```bash
node pool-cli.mjs set-min-balance              # dry-run + emit, default 250,000 BERA
node pool-cli.mjs set-min-balance --amount 300000 --execute
```

Omission of this command is not an error. Default amount when `--amount` is omitted: **250,000 BERA**.

### `stake`

```bash
node pool-cli.mjs stake --amount 100 --receiver 0xRECEIVER
node pool-cli.mjs stake --amount 100 --receiver 0xRECEIVER --execute   # requires PRIVATE_KEY
```

Calls `StakingPool.submit(address)` with `--value <amount>ether`. `--receiver` gets the stBERA. Dry-run simulates `--from` the receiver unless you pass `--from`. Optional `--staking-pool` skips `getCoreContracts` lookup. The sample frontend at `../frontend/` remains available.

### `unstake`

Withdrawal is two transactions. Request creates an NFT; after the on-chain delay, finalize it.

```bash
node pool-cli.mjs unstake --amount 100 --from 0xHOLDER
node pool-cli.mjs unstake --shares 50 --from 0xHOLDER
node pool-cli.mjs unstake --finalize --from 0xHOLDER      # finalize every ready request
node pool-cli.mjs unstake --finalize 42 --from 0xHOLDER    # finalize just request 42
```

`--amount` calls `WithdrawalVault.requestWithdrawal(pubkey, assetsInGWei, maxFeeToPay)` (amount must be a multiple of 1 gwei) and calls `requestRedeem` for `--shares`. Either surfaces the confirmed request id in its output and receipt. Pass exactly one of `--amount`, `--shares`, or `--finalize`.

`--finalize` with no id (including when immediately followed by another flag, e.g. `--from`) enumerates every withdrawal-request NFT `--from` holds, finalizes every one that has passed the finalization delay in a single `finalizeWithdrawalRequests(uint256[])` transaction (never one call per id — cold-signing prints exactly one `cast send` covering all of them), and reports plainly if none are ready yet (naming each and when it becomes ready) or if there are none at all. `--finalize <id>` finalizes just that one request via `finalizeWithdrawalRequest(uint256)`, unchanged. A batch finalize is recorded as one receipt entry with a `requestIds` array and one transaction hash.

`--from` is the stBERA holder (required for preflight). `--receiver` is accepted as an alias. If both are omitted, the CLI derives the address from `PRIVATE_KEY`.

EIP-7002 fee: omit `--max-fee` to read the current fee directly from the contract (`WithdrawalVault.getWithdrawalRequestFee()`), or pass `--max-fee` in BERA to override it. The fee is both `maxFeeToPay` and `--value`.

The pool must already be active. `status` lists withdrawal NFTs when `PRIVATE_KEY` is set.

## Tests

From this directory:

```bash
node --test test/*.test.mjs
```

## Retained bash

Until the delegated CLI lands: `lib-common.sh`, `env.sh.template`, `package.json`, `delegator-*.sh`, `delegated-*.sh`, and `generate-frontend-config.sh`.
