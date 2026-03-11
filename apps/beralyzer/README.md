# Beralyzer

Beralyzer indexes Berachain EL and CL data into Postgres so you can query it. Block headers, transactions, receipts, validator absences, and voting power — all in one schema, continuously updated as the chain advances.

**Querying the data?** See [docs/querying.md](docs/querying.md) — schema reference, query patterns, and what the data does and doesn't contain.

**Running the daemon?** See [docs/deploying.md](docs/deploying.md) — install, configuration, systemd, and Prometheus monitoring.

## What it indexes

Five workers run in parallel:

| Worker | What it ingests |
|--------|----------------|
| EL | Block headers, transactions, receipts, contract creations, ERC-20 transfer counts |
| CL | Validator absences and voting power per block |
| ERC20 | ERC-20 token registry (name, symbol, decimals for newly detected contracts) |
| Decoder | Decoded transaction data via cometbft-decoder helper |
| Snapshots | Daily validator set snapshots |

A retry worker re-processes blocks that failed during ingestion, and a stats worker exports DB inventory metrics (row counts, cursor heights, failed blocks) for Prometheus.

## Quick start

```bash
npm install && npm run build

PG_DSN="postgres://user:pass@localhost/beralyzer_mainnet" \
EL_ETHRPC_URL="http://127.0.0.1:8545" \
CL_ETHRPC_URL="http://127.0.0.1:26657" \
npm run start
```

Migrations run automatically on startup. See [docs/deploying.md](docs/deploying.md) for full setup.

## For maintainers

Workers, pipeline architecture, error model, schema decisions: see the maintainers section at the bottom of [docs/deploying.md](docs/deploying.md).
