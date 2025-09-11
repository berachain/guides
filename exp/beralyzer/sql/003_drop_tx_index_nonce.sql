-- Remove tx_index and nonce from transactions; drop related unique index

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'tx_block_txindex_uq'
  ) THEN
    EXECUTE 'DROP INDEX ' || quote_ident(current_schema()) || '.tx_block_txindex_uq';
  END IF;
END$$;

ALTER TABLE transactions
  DROP COLUMN IF EXISTS tx_index,
  DROP COLUMN IF EXISTS nonce;


