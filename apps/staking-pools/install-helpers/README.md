# Staking Pool Install Helpers

Validator-local scripts for **post-install ops**, **delegator forming**, and **delegated yield**.

**Landing** a pool (self-funded or delegated) is [`../installer/install.sh`](../installer/install.sh) on a remote machine with RPC access. It is not run here.

## Configuration

Copy `env.sh.template` to `env.sh` on the validator and set `BEACOND_HOME`. Add `STAKING_POOL` if you want stake/unstake without passing `--staking-pool`.

| Variable | Purpose |
| --- | --- |
| `BEACOND_HOME` | Required for `status.sh` and pubkey auto-detect in stake/unstake |
| `STAKING_POOL` | Pool address (optional if you pass `--staking-pool`) |
| `CHAIN` | `mainnet` or `bepolia` |
| `NODE_API_ADDRESS` | Beacon API host:port |
| `PRIVATE_KEY` | Optional; defaults to `--ledger` |

## Prerequisites

- [Foundry](https://book.getfoundry.sh/) (`cast`)
- `jq`, `bc` (for some scripts)

## Script reference

### Operator (post-install)

| Script | Purpose |
| --- | --- |
| `stake.sh` | Stake BERA into a pool |
| `unstake.sh` | Request withdrawal from a pool |
| `status.sh` | Pool telemetry (needs `BEACOND_HOME`) |
| `generate-frontend-config.sh` | Frontend `config.draft.json` (needs `BEACOND_HOME`) |

### Delegator (forming — one script)

| Script | Purpose |
| --- | --- |
| `delegator-delegate.sh` | Deploy handler, fund, `delegate()`, `grantRole()`, anvil simulation |
| `delegator-withdraw-principal.sh` | Delegator reclaims principal (4-step) |

### Delegated operator (post-landing)

| Script | Purpose |
| --- | --- |
| `delegated-withdraw-yield.sh` | Claim earned yield (request → complete) |

### Shared

| File | Purpose |
| --- | --- |
| `lib-common.sh` | Shared library (also sourced by `installer/install.sh`) |
| `env.sh.template` | Validator-side config template |
| `generated/` | Script output (git-ignored) |
