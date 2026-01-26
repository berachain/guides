Beralyzer

Purpose: ingest EL/CL data into Postgres for analysis (per-chain schema), resilient catch-up to tip, and near-tip streaming. Uses the existing Go cometbft-decoder as a helper.

## Architecture

All indexing processes run independently in parallel. Each worker maintains its own cursor and runs at its own optimal speed, eliminating blocking dependencies between workers. This allows:

- EL ingestion to catch up on historical blocks while other workers process new data
- Each worker to run at its optimal polling interval
- Independent error handling and retry logic per worker
- Better resource utilization with all workers active simultaneously

### Workers

- **EL Ingestion**: Processes execution layer blocks with multi-stage pipeline (header fetch → transaction fetch → receipt fetch → database write)
- **ERC20 Registry**: Detects and registers ERC20 tokens from newly created contracts
- **CL Ingestion**: Processes consensus layer validator absences and voting power
- **Decoder**: Runs Go cometbft-decoder helper to process decoded transactions
- **Snapshots**: Generates daily validator set snapshots

## Environment Variables

### Required

- `PG_DSN`: Postgres connection string (database per chain)
- `EL_ETHRPC_URL`: EL JSON-RPC endpoint(s), comma or semicolon-separated for load balancing
- `CL_ETHRPC_URL`: CL RPC endpoint(s), comma or semicolon-separated for load balancing

### Worker Polling Intervals

- `BERALYZER_POLL_MS`: EL ingestion loop sleep in ms (default: 15000; set 0 for continuous catch-up)
- `BERALYZER_ERC20_POLL_MS`: ERC20 registry loop sleep in ms (default: 60000)
- `BERALYZER_CL_POLL_MS`: CL ingestion loop sleep in ms (default: 30000)
- `BERALYZER_DECODER_POLL_MS`: Decoder loop sleep in ms (default: 60000)
- `BERALYZER_SNAPSHOT_POLL_MS`: Snapshot loop sleep in ms (default: 300000)

### Concurrency Settings

- `BERALYZER_CONCURRENCY_EL`: Number of parallel EL block header fetch threads (default: 24)
- `BERALYZER_CONCURRENCY_TRACE`: Number of parallel transaction fetch threads (default: 24)
- `BERALYZER_CONCURRENCY_RECEIPT`: Number of parallel receipt fetch threads (default: 2x trace, typically 48)
- `BERALYZER_BLOCK_BATCH_SIZE`: Block batch size for processing (default: 512)

### Other Settings

- `BERALYZER_LOG`: Enable minimal logs, 1/0 (default: 1)
- `BERALYZER_METRICS_PORT`: Metrics server port (default: 9464)
- `ABI_DIR`: Optional, path to ABIs for helpers

## Scripts

- `npm run build`: Compile TypeScript to dist/
- `npm run start`: Run the daemon with all workers in parallel
- `npm run build:decoder`: Build the Go decoder helper

## Features

### Parallel Processing

Each worker runs in its own loop with independent error handling. Workers don't block each other, allowing optimal throughput even during large catch-up operations.

### Failed Block Tracking

Blocks that fail at any stage (header fetch, transaction fetch, receipt fetch, or database write) are automatically recorded in the `failed_blocks` table with detailed error information. This allows:

- Analysis of failure patterns
- Retry of failed blocks later
- Monitoring of failure rates by stage
- Debugging of persistent issues

Failed blocks are logged with structured JSON including block height, error type, error message, RPC duration, and full stack traces.

### Resilient Cursor Tracking

Cursors advance even when blocks fail, ensuring processing never stalls on individual failures. Each worker maintains its own cursor in the `ingest_cursors` table:

- `blocks_el`: EL block ingestion cursor
- `cl_absences`: CL absence ingestion cursor
- `erc20_registry`: ERC20 token registry cursor

### Error Handling

- **Retryable errors**: Network timeouts, connection errors - worker retries with backoff
- **Fatal errors**: Database constraint violations, schema errors - worker exits, others continue
- **Consecutive failures**: After 5 consecutive retryable failures, worker exits gracefully
- **Detailed logging**: All errors logged with full context for debugging

### Metrics

Prometheus metrics available at `http://127.0.0.1:${BERALYZER_METRICS_PORT}/metrics`:

- Block processing rates and durations
- RPC call counts and latencies
- Database query performance
- Loop iterations and durations per worker
- Queue depths and active workers
- Current block heights and blocks behind chain head

Metrics include a `worker` label to track each worker independently.

## Database Schema

- One schema per chain (no chain columns)
- Transactions store selector, input_size, state_change_accounts, contract creation flags, ERC-20 counts
- Blocks store decoded chain_client fields, consensus layer data (missing validators, voting power), and absent_validators JSONB
- ERC-20 registry tracks detected tokens; no transfer telemetry. Per-tx counts summarize Transfer events
- Failed blocks table tracks processing failures for analysis and retry
- Migrations are applied automatically by the daemon on startup; no manual step needed

## Monitoring

Query failed blocks:
```sql
SELECT * FROM failed_blocks 
WHERE module = 'blocks_el' AND resolved_at IS NULL
ORDER BY first_failed_at DESC;
```

Check cursor positions:
```sql
SELECT module, last_processed_height, updated_at 
FROM ingest_cursors 
ORDER BY module;
```

Monitor worker health via metrics endpoint or check logs for worker-specific messages.
