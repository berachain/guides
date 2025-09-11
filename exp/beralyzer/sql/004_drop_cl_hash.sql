-- Drop unused cl_hash column from blocks
ALTER TABLE blocks DROP COLUMN IF EXISTS cl_hash;


