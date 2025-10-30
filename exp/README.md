# exp = experimental

Safety not guaranteed. One-off experiments and quick utilities that haven't been promoted to production-ready guides.

## Configuration

Scripts use the shared configuration from `config.js` which provides:

- Network-specific RPC endpoints (mainnet/bepolia) with environment variable overrides
- Validator database integration
- Common helper functions for accessing chain configurations

## Directories

### enode-tester/

Quickly checks enode connectivity and handshake status. See [enode-tester/README.md](enode-tester/README.md) for details.

### erc20-scanner/

Scans for ERC20 contracts on Berachain networks. See [erc20-scanner/README.md](erc20-scanner/README.md) for details.

### rpc-benchmark/

Python-based RPC endpoint performance testing tool. See [rpc-benchmark/README.md](rpc-benchmark/README.md) for details.

### tx-pool-study/

Analyzes transaction pool behavior and patterns.

### tx-search/

Transaction search and mempool analysis tools. See [tx-search/README.md](tx-search/README.md) for details.
