# Staking Pool Operator CLI

Node stdlib CLI for validator operators **on the validator host** (next to `beacond` and `BEACOND_HOME`). No `cast`, no Foundry, no `npm install` at runtime — chain reads and hot-key signing/broadcasting go through a vendored, minified `ethers.js` (`vendor/ethers.min.js`).

## Run it

```bash
cp env.sh.template env.sh
# edit BEACOND_HOME; optionally PRIVATE_KEY for hot-key mode
source env.sh

node pool-cli.mjs install
```

Two modes, chosen by whether `PRIVATE_KEY` is set:

- **Hot-key** (`PRIVATE_KEY` set): the CLI signs and broadcasts everything itself. One confirmation, then hands-off through deploy → wait for beacon registration → activate → stake-if-funded.
- **Cold-signing** (no `PRIVATE_KEY`): the CLI never signs. It prints a `cast send` for each transaction that needs a new signature — run those on a separate signing machine with `cast` and a Ledger or your own key — and polls the chain for landing between them. Printed commands default to `--ledger`; pass `--signing-preference key` (or set it via env) if you'd rather they sign with your own private key instead. This is a print-string choice only — the CLI never reads a key either way, and it is never asked for interactively.

`install` is safe to kill and re-run at any point: it reads chain + `beacond` state to work out which phase is next, not a saved run file.

`status`, `activate`, `set-min-balance`, `stake`, and `unstake` don't need to run on the validator host at all: with no `BEACOND_HOME`, each reads network/pubkey from the scenario file `install` already wrote in the working directory (or `--scenario PATH`), falling back further to an explicit `--chain`/`--pubkey` (or `CLI_CHAIN`/`VALIDATOR_PUBKEY`) if you'd rather set it directly. Precedence: explicit flag/env, then the scenario file, then local `beacond`. With none of the three available, they fail closed pointing at `install`. `deploy` is the one exception — it always needs the deposit's credentials/signature/amount, which only a local `beacond` or a full `--deposit` can supply.

## Dependencies

| Tool | Purpose |
| --- | --- |
| Node.js 22+ | CLI runtime (`node:test` suite) |
| `beacond` | Validator pubkey, deposit validation, genesis network detection — only when running on the validator host; not needed at all for the five commands above when a scenario file or `--chain`/`--pubkey` is available instead |

No npm packages, lockfile, or `node_modules` on CLI-owned files. `cast` is never invoked by the CLI itself — it only ever appears as text `install`/the standalone commands print for you to run on a signing machine in cold-signing mode. Legacy `package.json` in this directory is retained for the Foundation-delegated bash scripts (`delegator-*.sh`, `delegated-*.sh`), which this CLI does not touch.

Forbidden in CLI code paths: `jq`, `bc`, `python3`, `curl`, `cast`.

## Configuration

| Variable | Purpose |
| --- | --- |
| `BEACOND_HOME` | beacond data directory (required for `deploy`; optional for `status`/`activate`/`set-min-balance`/`stake`/`unstake` when a scenario file or `--chain`/`--pubkey` covers identity instead) |
| `BEACOND_BIN` | Override beacond binary (default: `beacond` in `$PATH`) |
| `CLI_CHAIN` | `mainnet` or `bepolia` (auto-detected from genesis, or from the scenario file, when omitted) |
| `RPC_URL` / `EL_RPC_URL` | Override EL RPC (defaults: public Berachain endpoints) |
| `CL_NODE_API_URL` / `NODE_API_ADDRESS` | CL REST API for activation proofs (default: `http://127.0.0.1:3500`) |
| `PRIVATE_KEY` | Set for hot-key mode; leave unset for cold-signing |
| `VALIDATOR_PUBKEY` | Explicit pubkey override for the five commands above, in place of `beacond`/scenario file |
| `--signing-preference` | Cold-signing print-string choice only (`ledger` default, or `key`) — flag/env only, never asked interactively |

Do **not** set `CHAIN=` in the environment — Foundry `cast`, run on the signing machine in cold-signing mode, treats `CHAIN` as its own flag and rejects values like `bepolia`. Use `CLI_CHAIN` instead.

## Commands

Entrypoint: `node pool-cli.mjs <command> [options]`. Global: `--verbose` (tx hashes, RPC calls, pinned slots), `--help`.

### `install`

```bash
node pool-cli.mjs install
node pool-cli.mjs install --funding-address 0x... --operator 0x... --shares-recipient 0x...
```

The hands-off flow: reads your pubkey/network/funding balance, confirms the plan once, then runs deploy → wait for validator registration → activate → stake (if the funding wallet covers it beyond the 10,000 BERA deposit) without asking again. `--funding-address` is required in cold-signing mode if it can't be derived from a flag; `--operator`/`--shares-recipient` default to the funding wallet. `install` writes a scenario file (network, pubkey, locality) to the working directory on completion — the standalone commands below pick it up automatically.

### `deploy`

```bash
node pool-cli.mjs deploy --op 0xOperator --sr 0xSharesRecipient
```

Just the deploy step (`install` calls this internally). Validates the `beacond` deposit, predicts the four pool contract addresses, preflights `deployStakingPoolContracts`, then broadcasts (hot-key) or prints `cast send` (cold-signing). Always needs a local `beacond` or a full `--deposit` — the scenario file's network/pubkey isn't enough on its own.

### `activate`

```bash
node pool-cli.mjs activate
```

Just the activate step (`install` calls this internally). Fetches the three CL proofs, pins a slot 5 blocks behind head so the EIP-4788 EL block already exists, preflights `activateStakingPool`, and enforces the 10-minute proof window before broadcasting/emitting (refreshing proactively if cold-signing hasn't landed yet and the window is about to close). Re-running after activation reports "already active" and does nothing. Standalone on a remote validator: reads network/pubkey from `install`'s scenario file (or `--scenario PATH`) when `BEACOND_HOME` isn't set; `--chain`/`--pubkey` still override it.

### `status`

```bash
node pool-cli.mjs status
```

Read-only. Reports three separate facts: EL operator match on the beacon deposit contract, beacon inclusion (index + status), and pool `isActive`. Once active: contract addresses, assets/supply, buffered assets, min effective balance, WBERA disposition, legacy BGT when present. With `PRIVATE_KEY`, also wallet stBERA and withdrawal NFTs. Standalone on a remote validator: reads network/pubkey from `install`'s scenario file (or `--scenario PATH`) — its own check, not the `activate`/`stake`/`unstake` preflight path, since `status` never went through that path's fail-closed refusal either.

### `set-min-balance` (optional)

```bash
node pool-cli.mjs set-min-balance
node pool-cli.mjs set-min-balance --amount 300000
```

Not part of `install`'s plan or confirmation — run it yourself when you need it. Targets `SmartOperator.setMinEffectiveBalance`, which forwards to the pool. Default when `--amount` is omitted: 250,000 BERA. Standalone on a remote validator: reads network/pubkey from `install`'s scenario file (or `--scenario PATH`) when `BEACOND_HOME` isn't set; `--chain`/`--pubkey` still override it.

### `stake`

```bash
node pool-cli.mjs stake --amount 100 --receiver 0xRECEIVER
```

Calls `StakingPool.submit(address)` with `--amount` as the value. `--receiver` gets the minted stBERA. Any time after activation. Standalone on a remote validator: reads network/pubkey from `install`'s scenario file (or `--scenario PATH`) when `BEACOND_HOME` isn't set; `--chain`/`--pubkey` still override it.

### `unstake`

Withdrawal is two transactions — request, then finalize after the on-chain delay.

```bash
node pool-cli.mjs unstake --amount 100 --from 0xHOLDER
node pool-cli.mjs unstake --shares 50 --from 0xHOLDER
node pool-cli.mjs unstake --finalize --from 0xHOLDER      # finalize every ready request
node pool-cli.mjs unstake --finalize 42 --from 0xHOLDER    # finalize just request 42
```

Pass exactly one of `--amount` (assets), `--shares`, or `--finalize [id]`. `--from` is the stBERA holder (or `--receiver` as an alias; derived from `PRIVATE_KEY` if both are omitted).

`--amount` calls `WithdrawalVault.requestWithdrawal(pubkey, assetsInGWei, maxFeeToPay)` (amount must be a multiple of 1 gwei); `--shares` calls `requestRedeem`. Either surfaces the confirmed request id in its output and receipt.

`--finalize` with no id (including when immediately followed by another flag, e.g. `--from`) enumerates every withdrawal-request NFT `--from` holds, finalizes every one that has passed the finalization delay in a single `finalizeWithdrawalRequests(uint256[])` transaction (never one call per id — cold-signing prints exactly one `cast send` covering all of them), and reports plainly if none are ready yet (naming each and when it becomes ready) or if there are none at all. `--finalize <id>` finalizes just that one request via `finalizeWithdrawalRequest(uint256)`, unchanged. A batch finalize is recorded as one receipt entry with a `requestIds` array and one transaction hash.

EIP-7002 fee: omit `--max-fee` to read the current fee directly from the contract (`WithdrawalVault.getWithdrawalRequestFee()`), or pass `--max-fee` in BERA to override it. The fee is both `maxFeeToPay` and `--value`.

Standalone on a remote validator: reads network/pubkey from `install`'s scenario file (or `--scenario PATH`) when `BEACOND_HOME` isn't set; `--chain`/`--pubkey` still override it.

## Tests

```bash
make test
# or: node --test test/*.test.mjs
```

Chain-touching tests run against a real local `anvil` fork with real `contracts-staking-pools` bytecode deployed — not `cast`-output or CL-proof-text fixtures. Proof-shape/expiry pure-function tests keep fixture-based unit tests.

## Retained bash

Until a delegated CLI ships: `lib-common.sh`, `env.sh.template`, `package.json`, `delegator-*.sh`, `delegated-*.sh`, and `generate-frontend-config.sh`. These are untouched by this CLI and out of its scope.
