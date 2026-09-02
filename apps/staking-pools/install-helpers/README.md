# Staking Pool Install Helpers

Bash scripts to **form** and **land** Berachain staking pools from a bastion or laptop with Foundry `cast`. Run them on a machine with EL RPC and Node API access — **not on the validator**. Deposit signing stays on the validator (`beacond deposit create-validator` / `validate`).

Operator docs: [Staking pool installation](https://docs.berachain.com/nodes/staking-pools/installation)

## Contents

| File | Purpose |
| --- | --- |
| [`install.sh`](install.sh) | Land a pool (self-funded or delegated) |
| [`delegator-delegate.sh`](delegator-delegate.sh) | Form a `DelegationHandler` before landing |
| [`lib-common.sh`](lib-common.sh) | Shared helpers (sourced by both scripts) |
| [`env.sh.template`](env.sh.template) | Copy to `env.sh` for persistent config |

Confirmed transactions append to `staking-pool-receipts.jsonl` in this directory (git-ignored).

## Prerequisites

On the machine where you run these scripts:

- **bash**, [Foundry](https://book.getfoundry.sh/) (`cast`), `jq`, `curl`
- Reachable **EL JSON-RPC** (`EL_RPC_URL`)
- For `install.sh`: reachable **Beacon Kit Node API** (`CL_NODE_API_URL`; [enable in app.toml](https://docs.berachain.com/nodes/beaconkit/configuration#node-api-beacon-kit-node-api))
- **Self-funded:** funding wallet with ≥ 10,000 BERA + gas
- **Delegated:** delegator has already formed the handler (see below); operator needs gas only

On the validator:

- Synced node with backed-up `priv_validator_key.json`
- `beacond` for `deposit create-validator` and `deposit validate`

## Setup

```bash
git clone https://github.com/berachain/guides/
cd guides/apps/staking-pools/install-helpers
cp env.sh.template env.sh
# edit env.sh
chmod +x install.sh delegator-delegate.sh
```

Both scripts source `env.sh` from this directory when present. You can also `export` variables in your shell.

## Configuration

### Required

| Variable | Scripts | Purpose |
| --- | --- | --- |
| `EL_RPC_URL` | both | Execution-layer JSON-RPC. Network is inferred from `eth_chainId`. |
| `CL_NODE_API_URL` | `install.sh` | Node API base URL (`http://host:port`). |

### Signing

| Variable | Purpose |
| --- | --- |
| `PRIVATE_KEY` | Optional. When set, scripts can run `cast send` after you confirm. When unset, each step prints a command for your Ledger machine; paste the transaction hash back. |

### Prompt defaults

Scripts **always prompt** for identity facts. Set these in `env.sh` to pre-fill the bracketed default — press Enter to accept.

**`install.sh`**

| Variable | Prompt |
| --- | --- |
| `VALIDATOR_PUBKEY` | Validator pubkey |
| `FUNDING_ADDRESS` | Funding wallet (cold signing; skipped when `PRIVATE_KEY` is set) |
| `OPERATOR_ADDRESS` | Operator address (self-funded path) |
| `SHARES_RECIPIENT` | Shares recipient (self-funded path) |

**`delegator-delegate.sh`**

| Variable | Prompt |
| --- | --- |
| `VALIDATOR_PUBKEY` | Validator pubkey |
| `DELEGATE_AMOUNT_BERA` | Whole BERA to delegate |
| `VALIDATOR_ADMIN` | Operator address for `VALIDATOR_ADMIN_ROLE` |

Flags on `delegator-delegate.sh` (`--pubkey`, `--amount`, `--validator-admin`) skip the matching prompt.

## Self-funded flow

One operator wallet funds the 10,000 BERA deposit and deploy.

```bash
./install.sh
```

1. Preflight: verify `cast` / `jq` / `curl`, EL RPC, Node API.
2. Pubkey prompt (default from `VALIDATOR_PUBKEY`).
3. No `DelegationHandler` for that pubkey → self-funded path: funding wallet, operator, shares recipient.
4. On the **validator**, run `beacond deposit create-validator`, then `deposit validate` (must exit 0). Paste create-validator output into the script.
5. Deploy pool (`deployStakingPoolContracts`, 10,000 BERA), wait for beacon registration, activate.
6. Print pool address; append receipts.

## Delegated flow

Two roles, two scripts.

**1. Delegator — form the handler**

```bash
./delegator-delegate.sh
```

Deploy handler (if needed), fund, `delegate()`, `grantRole(VALIDATOR_ADMIN_ROLE, operator)`. Steps 3–4 usually need `DEFAULT_ADMIN_ROLE` on the handler (often the Foundation Safe).

**2. Operator — land the pool**

```bash
./install.sh
```

When a formed handler with delegated funds exists for your pubkey, `install.sh` enters **delegated landing** mode automatically (skips operator/shares prompts). It runs `createStakingPoolWithDelegatedFunds`, activation, and optionally `depositDelegatedFunds` for the remainder.

## Validator deposit (both paths)

`install.sh` prints the exact `beacond` commands with withdrawal vault, amount, and genesis root filled in for your network. You run them on the validator with `--home <validator-data-dir>`. The bastion never runs `beacond`.

After paste-back, the script checks pubkey match, amount (10,000 BERA), and asks you to confirm `deposit validate` succeeded on the validator.

## Help

```bash
./install.sh --help
./delegator-delegate.sh --help
```
