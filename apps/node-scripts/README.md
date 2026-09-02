# Berachain Node Quickstart Scripts

Full instructions are on [docs.berachain.com](https://docs.berachain.com/nodes/quickstart).

Requires Beacon Kit and Bera-Reth **v1.4.1** or later. Set `CHAIN` to `mainnet` or `bepolia` in `env.sh`.

1. Install `beacond` and `bera-reth` and ensure both are on your `$PATH`.
2. Review and modify `env.sh`.
3. `./fetch-berachain-params.sh`
4. `./setup-beacond.sh` then `./setup-reth.sh`
5. Optional: `. ./env.sh && ./fetch-berachain-snapshot.sh` to restore the latest official snapshots into `$BEACOND_DATA` and `$RETH_DATA`. Storage v2 (Bepolia): `./fetch-berachain-snapshot-v2.sh` uses the same env and datadirs.
6. In one window: `./run-beacond.sh`
7. In another window: `./run-reth.sh`
