# Staking pool installer

Remote install from a machine with Foundry `cast`. Does not run on the validator.

```bash
export EL_RPC_URL=https://bepolia.rpc.berachain.com
export CL_NODE_API_URL=http://your-node-api:3500
./install.sh
```

Set `PRIVATE_KEY` to run `cast send` locally after confirmation. Leave unset to run printed commands on a Ledger machine and paste transaction hashes back.

If a `DelegationHandler` exists for your validator pubkey, the script lands a delegated pool (create → activate → optional delegated deposit). Forming the handler is only `delegator-delegate.sh` in `../install-helpers/`.

On success, prints the staking pool address and appends to `staking-pool-receipts.jsonl`.

Post-install ops on the validator: `../install-helpers/` (`stake.sh`, `status.sh`, etc.).

Operator docs: [Staking pool installation](https://docs.berachain.com/nodes/staking-pools/installation)
