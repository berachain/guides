-- Failed blocks tracking table
-- Records blocks that failed during ingestion with error details and retry tracking
CREATE TABLE IF NOT EXISTS failed_blocks (
  block_height BIGINT NOT NULL,
  module TEXT NOT NULL,
  failure_stage TEXT NOT NULL,
  error_type TEXT,
  error_message TEXT,
  error_details JSONB,
  last_retried_at TIMESTAMPTZ,
  retry_count INT NOT NULL DEFAULT 0,
  resolved_at TIMESTAMPTZ,
  PRIMARY KEY (block_height, module, failure_stage)
);

CREATE INDEX IF NOT EXISTS failed_blocks_module_resolved_idx 
  ON failed_blocks (module, resolved_at) 
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS failed_blocks_block_height_idx 
  ON failed_blocks (block_height);
