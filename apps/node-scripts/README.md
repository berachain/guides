# Berachain Node Quickstart Scripts

Full instructions are on [docs.berachain.com](https://docs.berachain.com/nodes/quickstart).

1. Download or build beacon kit and either bera-reth or bera-geth.
   Ensure your $PATH includes where you installed it.
2. Review and modify env.sh
3. `./fetch-berachain-params.sh`
4. In one window: `./setup-beacond.sh; ./run-beacond.sh`
5. In another window:
   `./setup-geth.sh; ./run-geth.sh`
   OR `./setup-reth.sh; ./run-reth.sh`
