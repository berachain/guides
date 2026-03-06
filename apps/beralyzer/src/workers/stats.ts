import { Pool } from "pg";
import {
  dbRows,
  dbFailedBlocksUnresolved,
  dbCursorHeight,
  dbDailySnapshotDays,
} from "../metrics.js";

const ROW_COUNT_QUERIES: Record<string, string> = {
  blocks: `SELECT n_live_tup AS count FROM pg_stat_user_tables WHERE relname = 'blocks'`,
  transactions: `SELECT n_live_tup AS count FROM pg_stat_user_tables WHERE relname = 'transactions'`,
  contracts: `SELECT n_live_tup AS count FROM pg_stat_user_tables WHERE relname = 'contracts'`,
  erc20_tokens: `SELECT n_live_tup AS count FROM pg_stat_user_tables WHERE relname = 'erc20_tokens'`,
  validators: `SELECT n_live_tup AS count FROM pg_stat_user_tables WHERE relname = 'validators'`,
};

export async function collectDbStats(pg: Pool): Promise<void> {
  // Each section is independent so a single failure doesn't prevent the rest from updating.

  // Approximate row counts via pg_stat_user_tables (no sequential scan)
  for (const [table, query] of Object.entries(ROW_COUNT_QUERIES)) {
    try {
      const result = await pg.query(query);
      if (result.rows.length > 0) {
        dbRows.set({ table }, parseInt(result.rows[0].count, 10));
      }
    } catch (e) {
      // Individual table count failure; other tables still update
    }
  }

  try {
    const failedResult = await pg.query(
      `SELECT COUNT(*) AS count FROM failed_blocks WHERE resolved_at IS NULL`,
    );
    dbFailedBlocksUnresolved.set(parseInt(failedResult.rows[0].count, 10));
  } catch (_) {
    // failed_blocks is small; this rarely fails
  }

  try {
    const cursorResult = await pg.query(
      `SELECT module, last_processed_height FROM ingest_cursors`,
    );
    for (const row of cursorResult.rows) {
      dbCursorHeight.set(
        { module: row.module },
        Number(row.last_processed_height),
      );
    }
  } catch (_) {
    // cursor query failed; metrics stay at last-known values
  }

  try {
    const snapshotResult = await pg.query(
      `SELECT COUNT(DISTINCT day) AS count FROM validator_set_daily_snapshots`,
    );
    dbDailySnapshotDays.set(parseInt(snapshotResult.rows[0].count, 10));
  } catch (_) {
    // snapshot coverage query failed
  }
}
