# Berachain Node Quickstart Scripts

Full instructions are on [docs.berachain.com](https://docs.berachain.com/nodes/quickstart).

Requires Beacon Kit and Bera-Reth **v1.4.1** or later. Set `CHAIN` to `mainnet` or `bepolia` in `env.sh`.

1. Install `beacond` and `bera-reth` and ensure both are on your `$PATH`.
2. Review and modify `env.sh`.
3. `./fetch-berachain-params.sh`
4. In one window: `./setup-beacond.sh; ./run-beacond.sh`
5. In another window: `./setup-reth.sh; ./run-reth.sh`

## Experimental: storage-v2 snapshots (this branch)

`mkberanode.sh` defaults to the production v1 `index.csv` path.

Opt into the bepolia storage-v2 catalog with `--reth-storage-v2` (or `RETH_STORAGE_V2=1`):

```bash
sudo ./mkberanode.sh --chain bepolia --mode pruned --reth-storage-v2
sudo ./mkberanode.sh --chain bepolia --mode archive --reth-storage-v2
sudo ./mkberanode.sh --chain bepolia --mode full_archive --reth-storage-v2
```

Pairing: `pruned`/`minimal` → `bera-reth download --minimal` + CL pruned; `archive` → `--archive` + CL pruned; `full_archive` → `--archive` + CL archive.

Offline smoke: `./test-v2-snapshot-pairing.sh`
