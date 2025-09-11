Beralyzer

Purpose: ingest EL/CL data into Postgres for analysis (per-chain schema), resilient catch-up to tip, and near-tip streaming. Uses the existing Go cometbft-decoder as a helper.

Environment variables

- PG_DSN: Postgres connection string (database per chain)
- EL_ETHRPC_URL: EL JSON-RPC endpoint
- CL_ETHRPC_URL: CL RPC endpoint
- BERALYZER_POLL_MS: loop sleep in ms (default 15000; set 0 for initial scan)
- BERALYZER_LOG: 1/0 to enable minimal logs (default 1)
- ABI_DIR: optional, path to ABIs for helpers

Scripts

- npm run build: compile TypeScript to dist/
- npm run start: run the daemon loop
- npm run build:decoder: build the Go decoder helper

Notes

- One schema per chain (no chain columns).
- Transactions store selector, input_size, state_change_accounts, contract creation flags, ERC-20 counts.
- Blocks store decoded chain_client fields (no extra_data).
- ERC-20 registry exists; no transfer telemetry. Per-tx counts summarize Transfer events.
- Migrations are applied automatically by the daemon on startup; no manual step needed.
