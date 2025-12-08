# Transaction Search Tools

Tools for searching and analyzing transactions in the Berachain mempool.

## Scripts

### txpool_probe.py

Samples Berachain RPC for txpool metrics and classifies queued transactions by reason (nonce gaps vs pricing). Uses `txpool_status` and `txpool_inspect`.

**Environment Variables:**

- `RPC_URL`: RPC endpoint (default: https://rpc.berachain.com)
- `SAMPLES`: number of txpool_status samples (default: 30)
- `INSPECT_HITS`: number of txpool_inspect queries (default: 30)
- `GAS_PRICE_FLOOR_GWEI`: node floor for gas price (default: 1.0)
- `SLEEP_MS_MIN`: min sleep between requests in ms (default: 50)
- `SLEEP_MS_JITTER`: extra random jitter in ms (default: 50)

### tx_search.py

Searches Berachain RPC cluster for specific transaction IDs and sender addresses in the mempool. Uses `txpool_inspect` to find transactions across multiple RPC hits.

**Command Line Options:**

- `--hashes`: comma-separated list of transaction hashes to search for
- `--addresses`: comma-separated list of sender addresses to search for
- `--rpc-url`: RPC endpoint URL (default: https://rpc.berachain.com)
- `--hits`: number of txpool_inspect queries (default: 50)
- `--sleep`: min sleep between requests in ms (default: 100)
- `--jitter`: extra random jitter in ms (default: 50)
- `--timeout`: RPC request timeout in seconds (default: 5.0)

**Usage Examples:**

```bash
# Search by transaction hashes
python3 tx_search.py --hashes 0x123...,0x456...

# Search by sender addresses
python3 tx_search.py --addresses 0xabc...,0xdef...

# Search by both hashes and addresses
python3 tx_search.py --hashes 0x123... --addresses 0xabc...

# Use different RPC endpoint
python3 tx_search.py --hashes 0x123... --rpc-url https://bepolia.rpc.berachain.com

# Increase search hits and sleep time
python3 tx_search.py --addresses 0xabc... --hits 100 --sleep 200
```

## Setup

```bash
cd tx-search
python3 -m venv venv
source venv/bin/activate
pip install requests
```
