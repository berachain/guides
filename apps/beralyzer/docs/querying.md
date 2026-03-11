# Querying Beralyzer

Beralyzer exposes a Postgres schema you can query directly. One database per chain — no `chain_id` columns anywhere. Connect with any Postgres client.

## Connecting

```bash
psql "postgres://user:pass@host/beralyzer_mainnet"
```

For a quick health and coverage summary:

```bash
psql $PG_DSN -f stats-report.sql
```

## Schema

### blocks

One row per EL block. EL and CL data are merged here.

| Column | Type | Notes |
|--------|------|-------|
| `height` | bigint | Primary key |
| `el_hash` | text | EL block hash |
| `timestamp` | timestamptz | Block timestamp |
| `proposer_address` | text | From CL data; may be null until the CL worker has caught up |
| `base_fee_per_gas_wei` | numeric | |
| `gas_used_total` | bigint | |
| `gas_limit` | bigint | |
| `tx_count` | int | |
| `chain_client` | text | Full extraData string |
| `chain_client_type` | text | Reth, Geth, Erigon, Nethermind, Besu, Unknown |
| `chain_client_version` | text | |
| `total_fees_wei` | numeric | Sum of `gas_used × effective_gas_price` across all txs |
| `total_priority_fees_wei` | numeric | |
| `effective_gas_price_avg_wei` | numeric | Average across txs with price data |
| `priority_fee_avg_wei` | numeric | Average priority fee per gas across txs |
| `missing_count` | int | Absent validators this block (from CL) |
| `missing_voting_power` | numeric | Absent voting power |
| `total_voting_power` | numeric | |
| `missing_percentage` | float | `missing_voting_power / total_voting_power` |
| `last_commit_round` | int | CometBFT commit round for this block |
| `absent_validators` | jsonb | Array of absent validator addresses |

### transactions

One row per transaction. Receipt fields are collapsed in — there is no separate receipts table.

| Column | Type | Notes |
|--------|------|-------|
| `hash` | text | Primary key |
| `block_height` | bigint | FK → blocks |
| `from_address` | text | Lowercased |
| `to_address` | text | Null for contract creation |
| `value_wei` | numeric | |
| `gas_limit` | bigint | Gas limit set by the transaction |
| `max_fee_per_gas_wei` | numeric | EIP-1559 max fee |
| `max_priority_fee_per_gas_wei` | numeric | EIP-1559 max priority fee |
| `type` | smallint | Raw tx type (0=legacy, 1=EIP-2930, 2=EIP-1559, 3=EIP-4844, 4=EIP-7702); see `transaction_types` table |
| `selector` | char(10) | First 4 bytes of calldata (`0x` + 8 hex chars); null for transfers or empty input |
| `input_size` | int | Calldata size in bytes |
| `creates_contract` | boolean | |
| `created_contract_address` | text | |
| `state_change_accounts` | int | Number of accounts with state changes (default 0) |
| `erc20_transfer_count` | int | Number of ERC-20 Transfer events emitted |
| `erc20_unique_token_count` | int | Unique token addresses in Transfer events |
| `status` | boolean | true = success, false = reverted |
| `gas_used` | bigint | |
| `cumulative_gas_used` | bigint | Cumulative gas used in block up to this tx |
| `effective_gas_price_wei` | numeric | |
| `total_fee_wei` | numeric | `gas_used × effective_gas_price_wei` |
| `priority_fee_per_gas_wei` | numeric | |
| `transaction_category` | text | legacy, access_list, eip1559, blob, eip7702 |
| `access_list` | jsonb | EIP-2930 only |
| `blob_versioned_hashes` | text[] | EIP-4844 only |
| `max_fee_per_blob_gas_wei` | numeric | EIP-4844 only |
| `blob_gas_used` | bigint | EIP-4844 only |
| `eip_7702_authorization` | text | EIP-7702 only |
| `eip_7702_contract_code_hash` | text | EIP-7702 only |
| `eip_7702_delegation_address` | text | EIP-7702 only |

### contracts

One row per created contract, registered when the EL worker processes the creating transaction.

| Column | Notes |
|--------|-------|
| `address` | Lowercased |
| `created_by_tx` | FK → transactions |
| `created_at_block` | FK → blocks |
| `bytecode_hash` | Not populated by default |
| `is_proxy`, `implementation_address` | Not populated by default |

### erc20_tokens

Subset of `contracts` — tokens detected by the ERC20 worker. Does not track Transfer events or balances; use `transactions.erc20_transfer_count` for volume.

| Column | Notes |
|--------|-------|
| `address` | FK → contracts |
| `detected_by_tx` | FK → transactions; the tx that created the contract |
| `detected_at_block` | Block height when detected |
| `name`, `symbol`, `decimals` | Fetched from the contract at detection time |

### validators

Registry of validator addresses ever seen proposing or in the validator set.

| Column | Notes |
|--------|-------|
| `address` | |
| `first_seen_block`, `last_proposed_block` | |
| `name`, `pubkey` | Not always populated |

### validator_set_daily_snapshots

One row per validator per day — the validator set at midnight UTC (from the first block of each day).

| Column | Notes |
|--------|-------|
| `day` | Date |
| `validator_index` | Index in the CL validator set |
| `address`, `voting_power` | |
| `boundary_block` | Block used as the snapshot reference |

### ingest_cursors

Per-worker progress tracking. Cursors advance even when individual blocks fail.

| Module | Tracks |
|--------|--------|
| `blocks_el` | EL block ingestion |
| `cl_absences` | CL absence and voting power ingestion |
| `erc20_registry` | ERC-20 token detection |

### failed_blocks

Blocks that failed at some stage. The retry worker re-processes these and removes entries on success.

| Column | Notes |
|--------|-------|
| `block_height`, `module`, `failure_stage` | Composite PK |
| `failure_stage` | header_fetch, tx_fetch, receipt_fetch, db_write |
| `error_details` | JSONB with full error context |
| `retry_count`, `resolved_at` | |

---

## Query patterns

### Ingestion coverage

```sql
SELECT module, last_processed_height, updated_at, NOW() - updated_at AS lag
FROM ingest_cursors ORDER BY module;
```

### Client distribution

```sql
SELECT chain_client_type, chain_client_version,
       COUNT(*) AS blocks,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS pct
FROM blocks
GROUP BY chain_client_type, chain_client_version
ORDER BY blocks DESC;
```

### Validator absence rate by day

```sql
SELECT DATE_TRUNC('day', timestamp) AS day,
       ROUND(AVG(missing_percentage) * 100, 3) AS avg_missing_pct,
       MAX(missing_count) AS max_missing_validators
FROM blocks
WHERE missing_count IS NOT NULL
GROUP BY 1 ORDER BY 1 DESC;
```

### Blocks with worst validator absence

```sql
SELECT height, timestamp, missing_count, missing_percentage, absent_validators
FROM blocks
WHERE missing_count IS NOT NULL
ORDER BY missing_count DESC LIMIT 20;
```

### Most-called function selectors

```sql
SELECT selector, COUNT(*) AS calls
FROM transactions
WHERE selector IS NOT NULL
GROUP BY selector
ORDER BY calls DESC LIMIT 20;
```

### Contract creation rate by day

```sql
SELECT DATE_TRUNC('day', b.timestamp) AS day, COUNT(*) AS contracts_created
FROM contracts c JOIN blocks b ON c.created_at_block = b.height
GROUP BY 1 ORDER BY 1 DESC;
```

### ERC-20 transfer volume by block range

```sql
SELECT b.height, b.timestamp, SUM(t.erc20_transfer_count) AS transfers
FROM transactions t JOIN blocks b ON t.block_height = b.height
WHERE b.height BETWEEN 1000000 AND 1001000
GROUP BY b.height, b.timestamp ORDER BY b.height;
```

### Transaction type mix

```sql
SELECT transaction_category, COUNT(*) AS txs,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS pct
FROM transactions
GROUP BY transaction_category ORDER BY txs DESC;
```

### Unresolved failed blocks

```sql
SELECT module, failure_stage, COUNT(*) AS count,
       MIN(block_height) AS first, MAX(block_height) AS last
FROM failed_blocks WHERE resolved_at IS NULL
GROUP BY module, failure_stage ORDER BY count DESC;
```

---

## What's not in the schema

- **Full event logs.** There is no `logs` table. ERC-20 Transfer events are counted per transaction (`erc20_transfer_count`) but individual log entries are not stored.
- **Token balances or transfer amounts.** ERC-20 tracking is registry-only (name/symbol/decimals) plus per-tx transfer event counts.
- **Bytecode.** `contracts.bytecode_hash` is present but not populated by the default ingestion.
- **Proxy resolution.** `contracts.is_proxy` and `implementation_address` are not populated by default.
- **Decoded calldata.** The decoder worker processes cometbft-specific transactions; general ABI decoding is not included.
