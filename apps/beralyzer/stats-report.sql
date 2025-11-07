-- Beralyzer Database Statistics Report
-- High-level stats, histograms, and distributions

\set ON_ERROR_STOP on
\pset format aligned
\pset tuples_only off

\echo '================================================================================'
\echo 'BERALYZER DATABASE STATISTICS REPORT'
\echo '================================================================================'
\echo ''

\echo '=== OVERALL COUNTS ==='
SELECT 
  (SELECT COUNT(*) FROM blocks) as blocks_total,
  (SELECT COUNT(*) FROM transactions) as transactions_total,
  (SELECT COUNT(*) FROM contracts) as contracts_total,
  (SELECT COUNT(*) FROM erc20_tokens) as erc20_tokens_total,
  (SELECT COUNT(*) FROM validators) as validators_total,
  (SELECT COUNT(DISTINCT proposer_address) FROM blocks WHERE proposer_address IS NOT NULL) as unique_proposers;

\echo ''
\echo '=== BLOCK HEIGHT RANGE ==='
SELECT 
  MIN(height) as min_block,
  MAX(height) as max_block,
  MAX(height) - MIN(height) + 1 as block_span,
  COUNT(*) as blocks_in_range,
  ROUND(AVG(tx_count), 2) as avg_tx_per_block,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY tx_count) as median_tx_per_block,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY tx_count) as p95_tx_per_block,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY tx_count) as p99_tx_per_block
FROM blocks;

\echo ''
\echo '=== TIME RANGE ==='
SELECT 
  MIN(timestamp) as earliest_block_time,
  MAX(timestamp) as latest_block_time,
  EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) / 86400 as days_span,
  COUNT(*) as blocks_in_period,
  ROUND(COUNT(*) / NULLIF(EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) / 86400, 0), 2) as avg_blocks_per_day
FROM blocks;

\echo ''
\echo '=== TRANSACTION TYPE DISTRIBUTION ==='
SELECT 
  COALESCE(tt.name, 'Unknown') as tx_type_name,
  COALESCE(t.type::text, 'NULL') as tx_type_id,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM transactions t
LEFT JOIN transaction_types tt ON t.type = tt.type_id
GROUP BY t.type, tt.name
ORDER BY count DESC;

\echo ''
\echo '=== TRANSACTION CATEGORY DISTRIBUTION ==='
SELECT 
  COALESCE(transaction_category, 'NULL') as category,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM transactions
GROUP BY transaction_category
ORDER BY count DESC;

\echo ''
\echo '=== CONTRACT CREATION STATS ==='
SELECT 
  COUNT(*) FILTER (WHERE creates_contract = true) as contract_creation_txs,
  COUNT(DISTINCT created_contract_address) FILTER (WHERE created_contract_address IS NOT NULL) as unique_contracts_created,
  ROUND(100.0 * COUNT(*) FILTER (WHERE creates_contract = true) / COUNT(*), 4) as pct_contract_creations
FROM transactions;

\echo ''
\echo '=== ERC20 TRANSFER STATS ==='
SELECT 
  COUNT(*) FILTER (WHERE erc20_transfer_count > 0) as txs_with_erc20_transfers,
  SUM(erc20_transfer_count) as total_erc20_transfers,
  SUM(erc20_unique_token_count) as total_unique_tokens_in_txs,
  ROUND(AVG(erc20_transfer_count) FILTER (WHERE erc20_transfer_count > 0), 2) as avg_transfers_per_tx,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY erc20_transfer_count) as median_transfers_per_tx,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY erc20_transfer_count) as p95_transfers_per_tx,
  MAX(erc20_transfer_count) as max_transfers_in_single_tx
FROM transactions;

\echo ''
\echo '=== VALIDATOR STATS ==='
SELECT 
  COUNT(*) as validators_seen,
  (SELECT COUNT(DISTINCT proposer_address) FROM blocks WHERE proposer_address IS NOT NULL) as unique_validators_proposed,
  COUNT(*) FILTER (WHERE last_proposed_block IS NOT NULL) as validators_with_proposals,
  MIN(first_seen_block) as earliest_validator_seen,
  MAX(last_proposed_block) as latest_proposal_block
FROM validators;

\echo ''
\echo '=== CHAIN CLIENT DISTRIBUTION ==='
SELECT 
  COALESCE(chain_client_type, 'Unknown') as client_type,
  COALESCE(chain_client_version, 'Unknown') as client_version,
  COUNT(*) as block_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM blocks
GROUP BY chain_client_type, chain_client_version
ORDER BY block_count DESC;

\echo ''
\echo '=== BLOCK GAS USAGE STATISTICS ==='
SELECT 
  ROUND(AVG(gas_used_total::numeric), 0) as avg_gas_used,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gas_used_total) as median_gas_used,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY gas_used_total) as p95_gas_used,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY gas_used_total) as p99_gas_used,
  MAX(gas_used_total) as max_gas_used,
  ROUND(AVG((gas_used_total::numeric / NULLIF(gas_limit, 0)) * 100), 2) as avg_gas_utilization_pct
FROM blocks
WHERE gas_used_total IS NOT NULL AND gas_limit IS NOT NULL;

\echo ''
\echo '=== BASE FEE PER GAS STATISTICS (wei) ==='
SELECT 
  ROUND(AVG(base_fee_per_gas_wei::numeric), 0) as avg_base_fee,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY base_fee_per_gas_wei) as median_base_fee,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY base_fee_per_gas_wei) as p95_base_fee,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY base_fee_per_gas_wei) as p99_base_fee,
  MIN(base_fee_per_gas_wei) as min_base_fee,
  MAX(base_fee_per_gas_wei) as max_base_fee
FROM blocks
WHERE base_fee_per_gas_wei IS NOT NULL;

\echo ''
\echo '=== BLOCK FEES STATISTICS ==='
SELECT 
  ROUND(AVG(total_fees_wei::numeric), 0) as avg_total_fees_wei,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_fees_wei) as median_total_fees_wei,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_fees_wei) as p95_total_fees_wei,
  SUM(total_fees_wei) as sum_total_fees_wei,
  SUM(total_priority_fees_wei) as sum_total_priority_fees_wei,
  ROUND(AVG(effective_gas_price_avg_wei::numeric), 0) as avg_effective_gas_price_wei
FROM blocks
WHERE total_fees_wei IS NOT NULL;

\echo ''
\echo '=== MISSING VALIDATOR STATISTICS ==='
SELECT 
  COUNT(*) as total_blocks_with_consensus_data,
  COUNT(*) FILTER (WHERE missing_count > 0) as blocks_with_missing_validators,
  CASE 
    WHEN COUNT(*) > 0 THEN ROUND(100.0 * COUNT(*) FILTER (WHERE missing_count > 0) / COUNT(*), 2)
    ELSE 0
  END as pct_blocks_with_missing,
  ROUND(AVG(missing_count) FILTER (WHERE missing_count > 0), 2) as avg_missing_validators,
  ROUND(AVG(missing_percentage::numeric) FILTER (WHERE missing_percentage > 0), 3) as avg_missing_percentage,
  MAX(missing_count) as max_missing_validators,
  MAX(missing_percentage) as max_missing_percentage
FROM blocks
WHERE missing_count IS NOT NULL;

\echo ''
\echo '=== TRANSACTION SUCCESS RATE ==='
SELECT 
  COUNT(*) FILTER (WHERE status = true) as successful_txs,
  COUNT(*) FILTER (WHERE status = false) as failed_txs,
  COUNT(*) FILTER (WHERE status IS NULL) as unknown_status_txs,
  CASE 
    WHEN COUNT(*) FILTER (WHERE status IS NOT NULL) > 0 
    THEN ROUND(100.0 * COUNT(*) FILTER (WHERE status = true) / COUNT(*) FILTER (WHERE status IS NOT NULL), 4)
    ELSE 0
  END as success_rate_pct
FROM transactions;

\echo ''
\echo '=== TRANSACTION GAS STATISTICS ==='
SELECT 
  ROUND(AVG(gas_used::numeric), 0) as avg_gas_used_per_tx,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gas_used) as median_gas_used_per_tx,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY gas_used) as p95_gas_used_per_tx,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY gas_used) as p99_gas_used_per_tx,
  MAX(gas_used) as max_gas_used_per_tx,
  ROUND(AVG(effective_gas_price_wei::numeric), 0) as avg_effective_gas_price_wei
FROM transactions
WHERE gas_used IS NOT NULL AND effective_gas_price_wei IS NOT NULL;

\echo ''
\echo '=== INPUT SIZE STATISTICS (bytes) ==='
SELECT 
  ROUND(AVG(input_size), 0) as avg_input_size_bytes,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY input_size) as median_input_size_bytes,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY input_size) as p95_input_size_bytes,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY input_size) as p99_input_size_bytes,
  MAX(input_size) as max_input_size_bytes,
  COUNT(*) FILTER (WHERE input_size = 0) as zero_input_txs,
  COUNT(*) FILTER (WHERE selector IS NOT NULL) as txs_with_function_selectors
FROM transactions;

\echo ''
\echo '=== BLOCK TIME HISTOGRAM (seconds between blocks) ==='
WITH block_times AS (
  SELECT 
    height,
    timestamp,
    LAG(timestamp) OVER (ORDER BY height) as prev_timestamp,
    EXTRACT(EPOCH FROM (timestamp - LAG(timestamp) OVER (ORDER BY height))) as block_time_seconds
  FROM blocks
)
SELECT 
  CASE 
    WHEN block_time_seconds < 1 THEN '< 1s'
    WHEN block_time_seconds < 2 THEN '1-2s'
    WHEN block_time_seconds < 3 THEN '2-3s'
    WHEN block_time_seconds < 5 THEN '3-5s'
    WHEN block_time_seconds < 10 THEN '5-10s'
    ELSE '> 10s'
  END as time_range,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM block_times
WHERE block_time_seconds IS NOT NULL
GROUP BY 
  CASE 
    WHEN block_time_seconds < 1 THEN '< 1s'
    WHEN block_time_seconds < 2 THEN '1-2s'
    WHEN block_time_seconds < 3 THEN '2-3s'
    WHEN block_time_seconds < 5 THEN '3-5s'
    WHEN block_time_seconds < 10 THEN '5-10s'
    ELSE '> 10s'
  END
ORDER BY MIN(block_time_seconds);

\echo ''
\echo '=== INGESTION PROGRESS ==='
SELECT 
  module,
  last_processed_height,
  updated_at,
  NOW() - updated_at as time_since_last_update
FROM ingest_cursors
ORDER BY module;

\echo ''
\echo '=== TOP 20 BLOCKS BY TRANSACTION COUNT ==='
SELECT 
  height,
  tx_count,
  timestamp,
  proposer_address,
  chain_client_type
FROM blocks
ORDER BY tx_count DESC
LIMIT 20;

\echo ''
\echo '=== TOP 20 BLOCKS BY GAS USED ==='
SELECT 
  height,
  gas_used_total,
  gas_limit,
  ROUND((gas_used_total::numeric / NULLIF(gas_limit, 0)) * 100, 2) as utilization_pct,
  timestamp
FROM blocks
WHERE gas_used_total IS NOT NULL
ORDER BY gas_used_total DESC
LIMIT 20;

\echo ''
\echo '================================================================================'
\echo 'END OF REPORT'
\echo '================================================================================'

