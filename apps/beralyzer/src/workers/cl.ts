import { Pool, Client } from "pg";
import { RoundRobinClClient } from "../rpc-balancer.js";
import {
  blocksProcessed,
  blocksProcessDuration,
  blockProcessingRate,
  currentBlockHeight,
  chainHeadHeight,
  blocksBehind,
} from "../metrics.js";

export interface ClWorkerConfig {
  clRpcUrls: string[]; // Multiple CL RPC URLs for load balancing
  batchSize: number; // heights per loop
  validatorRefreshInterval: number; // blocks between validator set refreshes
}

type ValidatorsAtHeight = {
  votingPowerByAddress: Map<string, bigint>;
  addressByPosition: Map<number, string>;
  totalVotingPower: bigint;
  validatorCount: number;
};

export async function ingestClAbsences(
  pg: Pool | Client,
  cfg: ClWorkerConfig & { log?: boolean },
): Promise<void> {
  const clClient = new RoundRobinClClient(cfg.clRpcUrls);
  if (cfg.log) {
    console.log(
      `CL: Using ${cfg.clRpcUrls.length} RPC endpoint(s): ${cfg.clRpcUrls.join(", ")}`,
    );
  }

  const latest = await clClient.getLatestHeight();
  chainHeadHeight.set({ type: "cl" }, latest);

  // Get CL cursor
  const curRes = await pg.query(
    "SELECT last_processed_height FROM ingest_cursors WHERE module=$1",
    ["cl_absences"],
  );

  // Get EL cursor to ensure we don't process blocks that don't exist yet
  const elCursorRes = await pg.query(
    "SELECT last_processed_height FROM ingest_cursors WHERE module=$1",
    ["blocks_el"],
  );
  const elCursor = elCursorRes.rows[0]
    ? Number(elCursorRes.rows[0].last_processed_height)
    : 0;

  // We ingest stats for block H using last_commit from H+1, so our max H is latest-1
  // But we can't process beyond what EL has indexed
  const start = (() => {
    if (curRes.rows[0]) {
      const v = curRes.rows[0].last_processed_height;
      const n = typeof v === "number" ? v : Number(v);
      return Math.max(1, (Number.isFinite(n) ? n : 0) + 1);
    }
    return 1;
  })();

  // Don't process beyond EL cursor - CL needs blocks to exist first
  const maxProcessable = Math.max(0, elCursor - 1); // H+1 needed, so max H is elCursor-1
  const end = Math.min(Math.max(1, latest - 1), maxProcessable);

  currentBlockHeight.set({ type: "cl" }, start - 1);
  blocksBehind.set({ type: "cl" }, end - start + 1);

  if (start > end) {
    // Caught up - sleep for a bit before next iteration
    if (cfg.log) {
      console.log(
        `CL: Caught up to EL cursor (${elCursor}), waiting for more blocks...`,
      );
    }
    return;
  }

  let nextCursor = start - 1;
  let cachedVals: ValidatorsAtHeight | null = null;
  let cachedAtHeight = 0;

  const t0All = Date.now();
  let blocksProcessedCount = 0;
  for (let from = start; from <= end; from += cfg.batchSize) {
    const to = Math.min(end, from + cfg.batchSize - 1);
    const t0 = Date.now();
    // Process heights H in [from..to]
    for (let h = from; h <= to; h++) {
      // Refresh validators every validatorRefreshInterval or at first
      if (!cachedVals || h % cfg.validatorRefreshInterval === 0) {
        const vals = await clClient.getValidators(h + 1); // last_commit references set at H+1
        if (vals) {
          const votingPowerByAddress = new Map<string, bigint>();
          const addressByPosition = new Map<number, string>();
          let total = 0n;
          vals.forEach((v: any, idx: number) => {
            const addr: string = v.address;
            const power = BigInt(v.voting_power);
            votingPowerByAddress.set(addr, power);
            addressByPosition.set(idx, addr);
            total += power;
          });
          cachedVals = {
            votingPowerByAddress,
            addressByPosition,
            totalVotingPower: total,
            validatorCount: vals.length,
          };
          cachedAtHeight = h + 1;
        }
      }
      if (!cachedVals) continue;

      const [blockPrev, blockNext] = await Promise.all([
        clClient.getBlock(h),
        clClient.getBlock(h + 1),
      ]);
      if (!blockPrev || !blockNext) continue;

      const proposer = blockPrev.header?.proposer_address || null;
      const signatures = blockNext.last_commit?.signatures || [];
      const roundRaw = blockNext.last_commit?.round;
      const round =
        typeof roundRaw === "string"
          ? parseInt(roundRaw, 10)
          : typeof roundRaw === "number"
            ? roundRaw
            : null;

      let missingCount = 0;
      let missingVotingPower = 0n;
      const absentees: { address: string; voting_power: string }[] = [];
      for (let i = 0; i < signatures.length; i++) {
        const sig = signatures[i];
        const flag = sig?.block_id_flag;
        if (flag === 1) {
          missingCount++;
          const addr = cachedVals.addressByPosition.get(i);
          if (addr) {
            const vp = cachedVals.votingPowerByAddress.get(addr) || 0n;
            absentees.push({ address: addr, voting_power: vp.toString() });
            missingVotingPower += vp;
          }
        }
      }

      const totalVotingPower = cachedVals.totalVotingPower;
      const missingPct =
        totalVotingPower > 0n
          ? Number((missingVotingPower * 10000n) / totalVotingPower) / 100
          : 0;

      // Update blocks consensus fields (merged) and absentees JSON
      await pg.query(
        `UPDATE blocks SET missing_count=$2, missing_voting_power=$3, total_voting_power=$4, missing_percentage=$5, last_commit_round=$6, absent_validators=$7
         WHERE height=$1`,
        [
          h,
          missingCount,
          missingVotingPower.toString(),
          totalVotingPower.toString(),
          missingPct,
          round,
          JSON.stringify(absentees),
        ],
      );

      // Backfill proposer on blocks table if null
      if (proposer) {
        await pg.query(
          `UPDATE blocks SET proposer_address = COALESCE(proposer_address, $2) WHERE height=$1`,
          [h, proposer],
        );
        await pg.query(
          `INSERT INTO validators(address, first_seen_block, last_proposed_block)
           VALUES($1,$2,$2)
           ON CONFLICT (address) DO UPDATE SET last_proposed_block=GREATEST(COALESCE(validators.last_proposed_block,0), EXCLUDED.last_proposed_block)`,
          [proposer, h],
        );
      }

      nextCursor = h;
      blocksProcessedCount++;
    }

    await pg.query(
      `INSERT INTO ingest_cursors(module,last_processed_height) VALUES($1,$2)
       ON CONFLICT (module) DO UPDATE SET last_processed_height=EXCLUDED.last_processed_height, updated_at=NOW()`,
      ["cl_absences", nextCursor],
    );

    // Update metrics for this batch
    const batchDuration = (Date.now() - t0) / 1000;
    blocksProcessDuration.observe({ type: "cl" }, batchDuration);
    blocksProcessed.inc({ type: "cl" }, to - from + 1);
    if (batchDuration > 0) {
      blockProcessingRate.set({ type: "cl" }, (to - from + 1) / batchDuration);
    }
    currentBlockHeight.set({ type: "cl" }, nextCursor);
    blocksBehind.set({ type: "cl" }, end - nextCursor);

    if (cfg.log)
      console.log(`CL: absences ${from}-${to} in ${Date.now() - t0}ms`);
  }

  // Update final metrics
  const totalDuration = (Date.now() - t0All) / 1000;
  if (totalDuration > 0 && blocksProcessedCount > 0) {
    blockProcessingRate.set(
      { type: "cl" },
      blocksProcessedCount / totalDuration,
    );
  }

  if (cfg.log)
    console.log(`CL: window ${start}-${end} in ${Date.now() - t0All}ms`);
}
