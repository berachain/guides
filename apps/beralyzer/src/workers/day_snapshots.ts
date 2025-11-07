import { Pool, Client } from "pg";
import { RoundRobinClClient } from "../rpc-balancer.js";

export interface DaySnapshotConfig {
  clRpcUrls: string[]; // Multiple CL RPC URLs for load balancing
}

export async function snapshotTodayIfMissing(
  pg: Pool | Client,
  cfg: DaySnapshotConfig,
): Promise<void> {
  const clClient = new RoundRobinClClient(cfg.clRpcUrls);

  // Determine today UTC
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const dayStr = today.toISOString().split("T")[0];
  const exists = await pg.query(
    `SELECT 1 FROM validator_set_daily_snapshots WHERE day=$1 LIMIT 1`,
    [dayStr],
  );
  if (exists.rowCount && exists.rowCount > 0) return; // already snapshotted

  const latest = await clClient.getLatestHeight();

  // Find boundary block for today using binary search
  const targetTs = Math.floor(today.getTime() / 1000);
  let l = 1;
  let r = latest;
  let boundary: number | null = null;
  while (l < r) {
    const mid = Math.floor((l + r) / 2);
    const blk = await clClient.getBlock(mid);
    if (!blk) {
      boundary = null;
      break;
    }
    const iso = blk.header?.time;
    if (!iso) {
      boundary = null;
      break;
    }
    const ts = Math.floor(new Date(iso).getTime() / 1000);
    if (ts >= targetTs) r = mid;
    else l = mid + 1;
  }
  boundary = l;

  if (!boundary) return;

  const validatorsRaw = await clClient.getValidators(boundary);
  if (!validatorsRaw) return;
  const validators = validatorsRaw.map((v: any, i: number) => ({
    idx: i,
    address: v.address,
    voting_power: v.voting_power,
  }));

  // Ensure a minimal blocks row exists for FK (timestamp required)
  const blockExists = await pg.query("SELECT 1 FROM blocks WHERE height=$1", [
    boundary,
  ]);
  if (!blockExists.rowCount || blockExists.rowCount === 0) {
    const blk = await clClient.getBlock(boundary);
    if (blk) {
      const hdr = blk.header;
      const iso = hdr?.time;
      const proposer = hdr?.proposer_address || null;
      if (iso) {
        const ts = Math.floor(new Date(iso).getTime() / 1000);
        await pg.query(
          `INSERT INTO blocks(height, timestamp, proposer_address)
           VALUES($1, to_timestamp($2), $3)
           ON CONFLICT (height) DO NOTHING`,
          [boundary, ts, proposer],
        );
      }
    }
  }

  // Insert rows
  for (const v of validators) {
    await pg.query(
      `INSERT INTO validator_set_daily_snapshots(day, boundary_block, validator_index, address, voting_power)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT DO NOTHING`,
      [dayStr, boundary, v.idx, v.address, v.voting_power],
    );
  }
}
