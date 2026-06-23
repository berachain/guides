# Berachain Node Quickstart Scripts

Full instructions are on [docs.berachain.com](https://docs.berachain.com/nodes/quickstart).

Requires Beacon Kit and Bera-Reth **v1.4.1** or later. Set `CHAIN` to `mainnet` or `bepolia` in `env.sh`.

1. Install `beacond` and `bera-reth` and ensure both are on your `$PATH`.
2. Review and modify `env.sh`.
3. `./fetch-berachain-params.sh`
4. In one window: `./setup-beacond.sh; ./run-beacond.sh`
5. In another window: `./setup-reth.sh; ./run-reth.sh`
