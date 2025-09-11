-- Migration status
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Blocks
CREATE TABLE IF NOT EXISTS blocks (
  height BIGINT PRIMARY KEY,
  el_hash TEXT UNIQUE,
  timestamp TIMESTAMPTZ NOT NULL,
  proposer_address TEXT,
  base_fee_per_gas_wei NUMERIC(78,0),
  gas_used_total BIGINT,
  gas_limit BIGINT,
  tx_count INT,
  chain_client TEXT,
  chain_client_type TEXT,
  chain_client_version TEXT,
  total_fees_wei NUMERIC(78,0),
  total_priority_fees_wei NUMERIC(78,0),
  effective_gas_price_avg_wei NUMERIC(78,0),
  priority_fee_avg_wei NUMERIC(78,0),
  -- consensus fields merged into blocks
  missing_count INT,
  missing_voting_power NUMERIC(78,0),
  total_voting_power NUMERIC(78,0),
  missing_percentage DOUBLE PRECISION,
  last_commit_round INT,
  absent_validators JSONB,
  CONSTRAINT chain_client_type_chk
    CHECK (chain_client_type IN ('Reth','Geth','Erigon','Nethermind','Besu','Unknown'))
);
CREATE INDEX IF NOT EXISTS blocks_timestamp_idx ON blocks (timestamp);
CREATE INDEX IF NOT EXISTS blocks_proposer_idx ON blocks (proposer_address);
CREATE INDEX IF NOT EXISTS blocks_client_idx ON blocks (chain_client_type, chain_client_version);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  hash TEXT PRIMARY KEY,
  block_height BIGINT NOT NULL REFERENCES blocks(height) ON DELETE CASCADE,
  from_address TEXT,
  to_address TEXT,
  value_wei NUMERIC(78,0),
  gas_limit BIGINT,
  max_fee_per_gas_wei NUMERIC(78,0),
  max_priority_fee_per_gas_wei NUMERIC(78,0),
  type SMALLINT,
  selector CHAR(10),
  input_size INT,
  creates_contract BOOLEAN,
  created_contract_address TEXT,
  state_change_accounts INT NOT NULL DEFAULT 0,
  erc20_transfer_count INT NOT NULL DEFAULT 0,
  erc20_unique_token_count INT NOT NULL DEFAULT 0,
  -- realized fields (collapsed from receipts)
  status BOOLEAN,
  gas_used BIGINT,
  cumulative_gas_used BIGINT,
  effective_gas_price_wei NUMERIC(78,0),
  total_fee_wei NUMERIC(78,0),
  priority_fee_per_gas_wei NUMERIC(78,0)
);
CREATE INDEX IF NOT EXISTS tx_block_idx ON transactions (block_height);
CREATE INDEX IF NOT EXISTS tx_selector_idx ON transactions (selector);
CREATE INDEX IF NOT EXISTS tx_creates_contract_idx ON transactions (creates_contract);
CREATE INDEX IF NOT EXISTS tx_block_hash_idx ON transactions (block_height, hash);
CREATE INDEX IF NOT EXISTS tx_created_contract_addr_idx ON transactions (created_contract_address);

-- Receipts table removed; realized fields are on transactions

-- Contracts
CREATE TABLE IF NOT EXISTS contracts (
  address TEXT PRIMARY KEY,
  created_by_tx TEXT NOT NULL REFERENCES transactions(hash) ON DELETE CASCADE,
  created_at_block BIGINT NOT NULL REFERENCES blocks(height) ON DELETE CASCADE,
  bytecode_hash TEXT,
  is_proxy BOOLEAN,
  implementation_address TEXT
);
CREATE INDEX IF NOT EXISTS contracts_block_idx ON contracts (created_at_block);
CREATE INDEX IF NOT EXISTS contracts_impl_idx ON contracts (implementation_address);

-- ERC-20 registry
CREATE TABLE IF NOT EXISTS erc20_tokens (
  address TEXT PRIMARY KEY REFERENCES contracts(address) ON DELETE CASCADE,
  detected_by_tx TEXT REFERENCES transactions(hash) ON DELETE SET NULL,
  detected_at_block BIGINT NOT NULL REFERENCES blocks(height) ON DELETE CASCADE,
  name TEXT,
  symbol TEXT,
  decimals SMALLINT
);
CREATE INDEX IF NOT EXISTS erc20_detected_block_idx ON erc20_tokens (detected_at_block);
CREATE INDEX IF NOT EXISTS erc20_symbol_idx ON erc20_tokens (symbol);

-- Consensus aggregates and absentees
-- consensus tables removed; data lives on blocks

-- Validator set snapshots (daily)
CREATE TABLE IF NOT EXISTS validator_set_daily_snapshots (
  day DATE NOT NULL,
  boundary_block BIGINT NOT NULL REFERENCES blocks(height) ON DELETE CASCADE,
  validator_index INT NOT NULL,
  address TEXT NOT NULL,
  voting_power NUMERIC(78,0) NOT NULL,
  PRIMARY KEY (day, validator_index)
);
CREATE INDEX IF NOT EXISTS validator_set_daily_addr_idx ON validator_set_daily_snapshots (address, day);

-- Validators registry (ever seen)
CREATE TABLE IF NOT EXISTS validators (
  address TEXT PRIMARY KEY,
  name TEXT,
  pubkey TEXT,
  first_seen_block BIGINT,
  last_proposed_block BIGINT
);
CREATE INDEX IF NOT EXISTS validators_last_proposed_idx ON validators (last_proposed_block);

-- Orchestration
CREATE TABLE IF NOT EXISTS ingest_cursors (
  module TEXT PRIMARY KEY,
  last_processed_height BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingest_runs (
  id BIGSERIAL PRIMARY KEY,
  module TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  start_height BIGINT,
  end_height BIGINT,
  status TEXT,
  error TEXT
);


