# Staking Pool Install Helpers

Shell scripts that automate staking pool lifecycle operations on Berachain.
Every script follows the same two-step pattern: **generate, then execute**.

## How It Works

Each script validates inputs, queries on-chain state, and writes a ready-to-run
`cast send` command into the `generated/` directory. You review the generated
file, then execute it yourself. Nothing is sent on-chain until you run the
generated script.

```
./register.sh --sr 0x... --op 0x...   # step 1: generate
./generated/deployment-command.sh       # step 2: execute
```

## Configuration

Copy the template and fill in your node path:

```bash
cp env.sh.template env.sh
```

| Variable           | Purpose                                                             |
| ------------------ | ------------------------------------------------------------------- |
| `BEACOND_HOME`     | Path to your beacond data directory (required for most scripts)     |
| `BEACOND_BIN`      | Override beacond binary location (defaults to `beacond` in `$PATH`) |
| `NODE_API_ADDRESS` | Beacon API endpoint (defaults to `127.0.0.1:3500`)                  |
| `PRIVATE_KEY`      | EVM private key for signing (see below)                             |

## Transaction Signing: Private Key vs Ledger

If `PRIVATE_KEY` is set in `env.sh`, generated commands use `cast send --private-key`.
If it is unset or empty, they default to `cast send --ledger` (hardware wallet).

Three ways to supply a private key, in order of preference:

1. **File reference** (recommended) — `PRIVATE_KEY=$(sed -n '1p' "../private-keys.txt")`
2. **Environment variable** — export it before running the script
3. **Inline in env.sh** (not recommended) — never commit the file

## Prerequisites

- [Foundry](https://book.getfoundry.sh/) (`cast`)
- `jq`, `bc`
- A synced `beacond` node (for operator scripts)

## Script Reference

### Operator Scripts (self-funded validators)

| Script                        | Purpose                                                   | Key Inputs                                          |
| ----------------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| `register.sh`                 | Deploy a new staking pool + initial 10 000 BERA deposit   | `--sr` (shares recipient), `--op` (operator)        |
| `activate.sh`                 | Activate a deployed pool using a beacon state proof       | (auto-detected from `BEACOND_HOME`)                 |
| `stake.sh`                    | Stake BERA into a pool, receive stBERA                    | `--amount`, `--receiver`, optional `--staking-pool` |
| `unstake.sh`                  | Request withdrawal from a pool                            | `--amount` or `--shares`, `--receiver`              |
| `status.sh`                   | Check deployment, activation, and delegation state        | (auto-detected)                                     |
| `generate-frontend-config.sh` | Write a `config.draft.json` for the staking-pool frontend | optional `--out` path                               |

### Delegator Scripts (Foundation / capital provider)

| Script                            | Purpose                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `delegator-setup-pool.sh`         | Generate deploy-handler + fund + delegate commands (3-step)                           |
| `delegator-delegate.sh`           | Generate delegation artifacts and simulate the full flow on a local anvil fork        |
| `delegator-withdraw-principal.sh` | Reclaim original delegated funds (4-step: request → complete → undelegate → withdraw) |

### Delegated-Operator Scripts (validator operator with `VALIDATOR_ADMIN_ROLE`)

| Script                        | Purpose                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `delegated-create-pool.sh`    | Create staking pool using delegated funds (initial 10 000 BERA)                 |
| `delegated-deposit.sh`        | Deposit remaining delegated funds to reach 250 000 BERA                         |
| `delegated-withdraw-yield.sh` | Claim earned staking rewards (2-step: request → complete after ~3 day cooldown) |

### Shared

| File              | Purpose                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `lib-common.sh`   | Shared functions: logging, `cast` wrappers, address resolution, network detection, simulation |
| `env.sh.template` | Configuration template                                                                        |
| `generated/`      | Output directory for generated commands (git-ignored)                                         |
