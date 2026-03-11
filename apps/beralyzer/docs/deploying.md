# Deploying Beralyzer

## Prerequisites

- Node.js 18+ and npm
- Postgres 14+ (one database per chain — no `chain_id` columns; run separate DBs for mainnet and testnet)
- EL JSON-RPC endpoint (e.g. `http://127.0.0.1:8545`)
- CL RPC endpoint (e.g. `http://127.0.0.1:26657`)
- (Optional) Go, if you want to build the cometbft-decoder helper

## Install and build

```bash
git clone <repo>
cd beralyzer
npm install
npm run build
```

Create a Postgres database:

```bash
createdb beralyzer_mainnet
# for testnet: createdb beralyzer_bepolia
```

Migrations apply automatically on daemon startup via numbered files in `sql/`. No manual SQL step is needed.

## Configuration

**Required:**

| Variable | Description |
|----------|-------------|
| `PG_DSN` | Postgres connection string, e.g. `postgres://user:pass@localhost/beralyzer_mainnet` |
| `EL_ETHRPC_URL` | EL JSON-RPC endpoint(s), comma- or semicolon-separated for load balancing |
| `CL_ETHRPC_URL` | CL RPC endpoint(s), comma- or semicolon-separated for load balancing |

**Polling intervals:**

| Variable | Default | Description |
|----------|---------|-------------|
| `BERALYZER_POLL_MS` | 15000 | EL ingestion sleep between runs; set to `0` for continuous catch-up |
| `BERALYZER_ERC20_POLL_MS` | 60000 | ERC20 registry loop |
| `BERALYZER_CL_POLL_MS` | 30000 | CL ingestion loop |
| `BERALYZER_DECODER_POLL_MS` | 60000 | Decoder loop |
| `BERALYZER_SNAPSHOT_POLL_MS` | 300000 | Daily snapshot loop |
| `BERALYZER_RETRY_POLL_MS` | 60000 | Failed-blocks retry loop |
| `BERALYZER_STATS_POLL_MS` | 60000 | DB inventory stats collection (row counts, cursor heights) |

**Other:**

| Variable | Default | Description |
|----------|---------|-------------|
| `BERALYZER_LOG` | 1 | Enable minimal logs (1/0) |
| `BERALYZER_METRICS_PORT` | 9464 | Prometheus metrics port (binds to 127.0.0.1) |
| `ABI_DIR` | — | Path to ABIs for decoder helpers |

## Running directly

```bash
PG_DSN="postgres://user:pass@localhost/beralyzer_mainnet" \
EL_ETHRPC_URL="http://127.0.0.1:8545" \
CL_ETHRPC_URL="http://127.0.0.1:26657" \
node dist/index.js
```

## Running as a systemd service

Copy and edit the included unit file:

```bash
cp beralyzer.service.example /etc/systemd/system/beralyzer.service
# edit WorkingDirectory, PG_DSN, EL_ETHRPC_URL, CL_ETHRPC_URL, User
systemctl daemon-reload
systemctl enable --now beralyzer
```

Check status:

```bash
systemctl status beralyzer
journalctl -u beralyzer -f
```

## Monitoring

### Prometheus

Metrics are exposed at `http://127.0.0.1:${BERALYZER_METRICS_PORT}/metrics`. A health check endpoint at `/health` returns `{"status":"ok"}` while the process is running (note: this does not indicate worker health — a worker can exit silently while the process continues).

Use the files in `deploy/` to configure scraping and alerting:

```bash
# add to prometheus.yml or drop into conf.d/
cp deploy/prometheus.yml /etc/prometheus/conf.d/beralyzer.yml

# add alerting rules
cp deploy/beralyzer.rules.yml /etc/prometheus/rules/beralyzer.rules.yml
```

See [deploy/beralyzer.rules.yml](../deploy/beralyzer.rules.yml) for the full alert set with thresholds.

### Key metrics

| Metric | What it tells you |
|--------|------------------|
| `beralyzer_worker_running{worker}` | 1 if the worker is running, 0 if it has exited — most reliable worker health signal |
| `beralyzer_blocks_behind{type="el"}` | How far the EL worker is from chain head |
| `beralyzer_blocks_behind{type="cl"}` | How far the CL worker is from chain head |
| `beralyzer_loop_iterations_total{worker}` | Loop heartbeat — stops incrementing if worker exits or is stuck |
| `beralyzer_rpc_errors_total` | RPC failures by endpoint and error type |
| `beralyzer_blocks_process_duration_seconds` | Per-block processing time distribution |
| `beralyzer_queue_depth{type="tx_queue"}` | EL pipeline backpressure indicator |
| `beralyzer_db_rows{table="blocks"}` | Approximate indexed block count (updated every ~60s by stats worker) |
| `beralyzer_db_rows{table="transactions"}` | Approximate indexed transaction count |
| `beralyzer_db_rows{table="contracts"}` | Approximate indexed contract count |
| `beralyzer_db_rows{table="erc20_tokens"}` | Approximate detected ERC-20 token count |
| `beralyzer_db_rows{table="validators"}` | Approximate known validator count |
| `beralyzer_db_failed_blocks_unresolved` | Unresolved failed blocks — key data integrity signal |
| `beralyzer_db_cursor_height{module}` | Committed cursor per worker (from DB, reliable after worker exit) |
| `beralyzer_db_daily_snapshot_days` | Number of distinct days with validator set snapshots |

### DB-based health checks

The `beralyzer_worker_running` gauge is the most reliable Prometheus-side signal for worker exits — it's set to 0 immediately when a worker returns. For additional ground truth, the DB cursor tracks the last committed height:

```sql
-- Lag since last cursor update per worker
SELECT module, last_processed_height, NOW() - updated_at AS lag
FROM ingest_cursors ORDER BY module;

-- Unresolved failed blocks
SELECT module, failure_stage, COUNT(*), MIN(block_height), MAX(block_height)
FROM failed_blocks WHERE resolved_at IS NULL
GROUP BY module, failure_stage;
```

The `beralyzer_worker_running == 0` alert in the alerting rules catches these exits directly.

## Error handling

Failed blocks don't stall the cursor. The worker logs the failure, records it in `failed_blocks` with stage, error type, and full error details (including stack trace), advances the cursor, and continues. The retry worker re-processes `failed_blocks` entries periodically and removes them on success.

Workers exit after 5 consecutive retryable errors (timeouts, connection resets). Fatal errors (schema violations, permission denied, auth failure) cause immediate worker exit. Other workers are unaffected. The daemon process exits only when all workers exit.

SIGTERM and SIGINT trigger graceful shutdown — workers finish their current iteration with a 30-second timeout.

---

## For maintainers

### EL pipeline

The EL worker is a four-stage pipeline running stages in parallel across different blocks:

```
Stage 1: Header Fetcher   ──► headerQueue
Stage 2: TX Fetcher       ──► txQueue
Stage 3: Receipt Fetcher  ──► readyQueue
Stage 4: DB Writer        (sequential per block, one DB transaction each)
```

Stages 1–3 use concurrent RPC calls (configurable). Stage 4 is sequential to preserve block order. Backpressure: TX fetching pauses when `txQueue` exceeds `maxQueueDepth` (default 100). Each block is committed as a DB transaction — a partial block is never written.

On retry: if a block appears in `failed_blocks`, Stage 4 deletes all existing data for that block before re-inserting (CASCADE handles child rows), then removes the `failed_blocks` entry on success.

**Concurrency tuning:**

| Variable | Default | Description |
|----------|---------|-------------|
| `BERALYZER_CONCURRENCY_EL` | 24 | Parallel header fetch threads |
| `BERALYZER_CONCURRENCY_TRACE` | 24 | Parallel transaction fetch threads |
| `BERALYZER_CONCURRENCY_RECEIPT` | 2× trace | Parallel receipt fetch threads |
| `BERALYZER_BLOCK_BATCH_SIZE` | 512 | Block batch size |

Connection pool is sized to `max(100, elFetch + trace + receipt + 20)` to ensure all concurrent operations have connections.

### Schema decisions

- One schema per chain. No `chain_id` column anywhere.
- `blocks.proposer_address` comes from CL data, not EL. It may be null until the CL worker reaches that block height.
- Receipt fields are collapsed into `transactions` — no separate receipts or logs tables.
- `transactions.erc20_transfer_count` counts Transfer events per transaction. Individual log entries are not stored.
- `ingest_cursors` advances even on block failure so processing never stalls on a bad block.
- `failed_blocks` PK is `(block_height, module, failure_stage)` — the same block can fail at multiple stages independently.
- Migrations use `schema_migrations` to track applied files; numbered files in `sql/` run in order at startup.
