# Staking Pool Helper Scripts

Bash scripts for deploying and managing Berachain staking pools. These scripts automate multi-step operations by generating ready-to-review `cast` commands that you execute manually.

**📖 Full documentation:** See the [Staking Pools documentation](https://docs.berachain.com/nodes/staking-pools/) on docs.berachain.com for detailed guides and workflows.

## Quick Reference

### Core Scripts

- **`activate.sh`** — Deploy and activate a staking pool; generates deployment and activation commands with beacon chain proofs. See [Installation Guide](https://docs.berachain.com/nodes/staking-pools/installation).
- **`status.sh`** — Check contract deployment, validator registration, pool activation status, telemetry, and wallet holdings including withdrawal NFTs.
- **`stake.sh`** — Generate a staking transaction to deposit BERA and receive stBERA shares.
- **`unstake.sh`** — Request withdrawals and manage withdrawal NFTs; shows redemption status and timing.

### Delegation Scripts (Capital Providers)

- **`delegator-deploy-handler.sh`** — Deploy a DelegationHandler contract for a validator pubkey.
- **`delegator-delegate.sh`** — Fund and delegate capital to a handler, granting operator role to the validator.
- **`delegator-withdraw-principal.sh`** — Request and complete principal withdrawals after validator exit.

### Delegation Scripts (Operators)

- **`delegated-create-pool.sh`** — Create a staking pool using the first 10,000 BERA from delegated funds.
- **`delegated-deposit.sh`** — Deposit remaining delegated funds to reach target balance.
- **`delegated-withdraw-yield.sh`** — Request and complete yield withdrawals (independent of principal).

See [Delegation Guide](https://docs.berachain.com/nodes/staking-pools/delegators) for delegation workflows.

### Utilities

- **`generate-frontend-config.sh`** — Generate frontend configuration from environment and factory contract lookups.
- **`smart-operator-manager.py`** — Interactive Python CLI for managing SmartOperator contracts (roles, boost, rewards allocation, commission). See [Operator Guide](https://docs.berachain.com/nodes/staking-pools/operators).

### Support Files

- **`lib-common.sh`** — Shared library functions (logging, network detection, cast wrappers, constants).
- **`env.sh.template`** / **`env.sh`** — Local configuration template and your actual configuration.
- **`requirements.txt`** — Python dependencies for `smart-operator-manager.py`.

## Requirements

- **beacond** — Berachain validator client (running with validator keys)
- **cast** — From Foundry toolkit ([installation guide](https://book.getfoundry.sh/))
- **jq**, **bc**, **curl** — Standard command-line tools
- **Ledger** (default) or **PRIVATE_KEY** — For transaction signing

## Getting Help

For script usage, run any script with `--help`:

```bash
./activate.sh --help
./status.sh --help
```

For detailed information about staking pools, see the documentation linked above.
