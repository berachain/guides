# Staking Pool Helper Scripts

Bash scripts for deploying and managing Berachain staking pools. These scripts automate multi-step operations by generating ready-to-review `cast` commands that you execute manually.

**📖 Full documentation:** See the [Staking Pools documentation](https://docs.berachain.com/nodes/staking-pools/) on docs.berachain.com for detailed guides and workflows.

## Quick Reference

The core scripts handle deployment and daily operations. **`register.sh`** deploys (registers) staking pool contracts and generates the deployment transaction. **`activate.sh`** activates a deployed pool using beacon chain proofs and generates the activation transaction. See the [Installation Guide](https://docs.berachain.com/nodes/staking-pools/installation) for details. **`status.sh`** checks contract deployment, validator registration, pool activation status, telemetry, and wallet holdings including withdrawal NFTs. **`stake.sh`** generates a staking transaction to deposit BERA and receive stBERA shares. **`unstake.sh`** requests withdrawals and manages withdrawal NFTs, showing redemption status and timing.

For delegation workflows, capital providers use **`delegator-deploy-handler.sh`** to deploy a DelegationHandler contract for a validator pubkey, **`delegator-delegate.sh`** to fund and delegate capital to a handler (granting operator role to the validator), and **`delegator-withdraw-principal.sh`** to request and complete principal withdrawals after validator exit. Operators use **`delegated-create-pool.sh`** to create a staking pool using the first 10,000 BERA from delegated funds, **`delegated-deposit.sh`** to deposit remaining delegated funds to reach target balance, and **`delegated-withdraw-yield.sh`** to request and complete yield withdrawals independent of principal. See the [Delegation Guide](https://docs.berachain.com/nodes/staking-pools/delegators) for delegation workflows.

Utility scripts include **`generate-frontend-config.sh`** for generating frontend configuration from environment and factory contract lookups, **`delegator-setup-pool.sh`** for generating delegation setup commands (deploy, BitGo funding, Safe transactions), and **`submit-bitgo-transaction.ts`** for submitting BitGo transactions.

Support files include **`lib-common.sh`** with shared library functions (logging, network detection, cast wrappers, constants), **`env.sh.template`** and **`env.sh`** for local configuration, and TypeScript dependencies (`bitgo`, `dotenv`, `tsx`) for `submit-bitgo-transaction.ts`.

For SmartOperator management, see the **[`smart-operator-manager`](../smart-operator-manager/)** directory for the interactive Python CLI tool.

## Requirements

You need **beacond** (Berachain validator client running with validator keys), **cast** from the Foundry toolkit ([installation guide](https://book.getfoundry.sh/)), standard command-line tools (**jq**, **bc**, **curl**), and either a **Ledger** hardware wallet (default) or **PRIVATE_KEY** for transaction signing.

## Deployment and Activation Workflow

The staking pool setup process has two distinct steps:

1. **Registration** (`register.sh`): Deploys the staking pool contracts to the chain. Run this when your validator keys are ready but the validator is not yet registered on the beacon chain.

2. **Activation** (`activate.sh`): Activates the deployed pool using validator proofs from the beacon chain. Run this after your validator has been registered and appears on the beacon chain.

Typical workflow:

```bash
# Step 1: Register (deploy contracts)
./register.sh --sr 0x... --op 0x...
./deployment-command.sh  # Execute the generated command

# Step 2: Wait for validator to be registered on beacon chain
# (Check with: ./status.sh)

# Step 3: Activate (generate activation command)
./activate.sh --sr 0x... --op 0x...
./activation-command.sh  # Execute the generated command
```

## Getting Help

For script usage, run any script with `--help`:

```bash
./register.sh --help
./activate.sh --help
./status.sh --help
```

For detailed information about staking pools, see the documentation linked above.

