import axios from 'axios';
import { Client } from 'pg';

export interface DaySnapshotConfig {
  clRpcUrl: string;
}

async function getLatestHeight(clUrl: string): Promise<number> {
  const res = await axios.get(`${clUrl}/status`);
  return parseInt(res.data.result.sync_info.latest_block_height, 10);
}

async function getBlockTimestamp(clUrl: string, height: number): Promise<number | null> {
  try {
    const res = await axios.get(`${clUrl}/block?height=${height}`);
    const iso = res.data?.result?.block?.header?.time;
    if (!iso) return null;
    return Math.floor(new Date(iso).getTime() / 1000);
  } catch {
    return null;
  }
}

async function getBlockInfo(clUrl: string, height: number): Promise<{ ts: number; proposer: string | null } | null> {
  try {
    const res = await axios.get(`${clUrl}/block?height=${height}`);
    const hdr = res.data?.result?.block?.header;
    const iso = hdr?.time;
    const proposer = hdr?.proposer_address || null;
    if (!iso) return null;
    const ts = Math.floor(new Date(iso).getTime() / 1000);
    return { ts, proposer };
  } catch {
    return null;
  }
}

async function binarySearchBoundary(clUrl: string, low: number, high: number, targetTs: number): Promise<number | null> {
  // Find first height with timestamp >= targetTs
  let l = low;
  let r = high;
  while (l < r) {
    const mid = Math.floor((l + r) / 2);
    const ts = await getBlockTimestamp(clUrl, mid);
    if (ts == null) return null;
    if (ts >= targetTs) r = mid; else l = mid + 1;
  }
  return l;
}

async function findBoundaryBlockForDay(clUrl: string, dayUtc: Date, latest: number): Promise<number | null> {
  const targetTs = Math.floor(dayUtc.getTime() / 1000);
  // Bracket: naive low=1, high=latest
  return binarySearchBoundary(clUrl, 1, latest, targetTs);
}

async function getValidatorsAt(clUrl: string, height: number): Promise<{ idx: number; address: string; voting_power: string }[] | null> {
  try {
    const res = await axios.get(`${clUrl}/validators?per_page=99&height=${height}`);
    const vals = res.data.result.validators as any[];
    return vals.map((v: any, i: number) => ({ idx: i, address: v.address, voting_power: v.voting_power }));
  } catch {
    return null;
  }
}

export async function snapshotTodayIfMissing(pg: Client, cfg: DaySnapshotConfig): Promise<void> {
  // Determine today UTC
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const dayStr = today.toISOString().split('T')[0];
  const exists = await pg.query(`SELECT 1 FROM validator_set_daily_snapshots WHERE day=$1 LIMIT 1`, [dayStr]);
  if (exists.rowCount && exists.rowCount > 0) return; // already snapshotted

  const latest = await getLatestHeight(cfg.clRpcUrl);
  const boundary = await findBoundaryBlockForDay(cfg.clRpcUrl, today, latest);
  if (!boundary) return;
  const validators = await getValidatorsAt(cfg.clRpcUrl, boundary);
  if (!validators) return;

  // Ensure a minimal blocks row exists for FK (timestamp required)
  const blockExists = await pg.query('SELECT 1 FROM blocks WHERE height=$1', [boundary]);
  if (!blockExists.rowCount || blockExists.rowCount === 0) {
    const info = await getBlockInfo(cfg.clRpcUrl, boundary);
    if (info) {
      await pg.query(
        `INSERT INTO blocks(height, timestamp, proposer_address)
         VALUES($1, to_timestamp($2), $3)
         ON CONFLICT (height) DO NOTHING`,
        [boundary, info.ts, info.proposer]
      );
    }
  }

  // Insert rows
  for (const v of validators) {
    await pg.query(
      `INSERT INTO validator_set_daily_snapshots(day, boundary_block, validator_index, address, voting_power)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT DO NOTHING`,
      [dayStr, boundary, v.idx, v.address, v.voting_power]
    );
  }
}


