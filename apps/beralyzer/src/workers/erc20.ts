import { Pool, Client } from "pg";
import { ethers } from "ethers";
import { RoundRobinProvider } from "../rpc-balancer.js";

export interface Erc20WorkerConfig {
  elRpcUrls: string[]; // Multiple EL RPC URLs for load balancing
  batchSize: number;
}

const ERC20_IFACE = new ethers.Interface([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);

export async function ingestErc20Registry(
  pg: Pool | Client,
  cfg: Erc20WorkerConfig,
): Promise<void> {
  const provider = new RoundRobinProvider(cfg.elRpcUrls);

  // Cursor
  const curRes = await pg.query(
    "SELECT last_processed_height FROM ingest_cursors WHERE module=$1",
    ["erc20_registry"],
  );
  const last = curRes.rows[0]
    ? Number(curRes.rows[0].last_processed_height)
    : 0;
  const q = await pg.query(
    `SELECT address, created_by_tx, created_at_block FROM contracts
     WHERE created_at_block > $1
     ORDER BY created_at_block ASC
     LIMIT $2`,
    [last, cfg.batchSize],
  );
  if (q.rowCount === 0) return;

  let maxHeight = last;
  for (const row of q.rows) {
    const addr: string = row.address;
    const block: number = Number(row.created_at_block);
    maxHeight = Math.max(maxHeight, block);

    // Skip if already registered
    const exists = await pg.query(
      "SELECT 1 FROM erc20_tokens WHERE address=$1",
      [addr],
    );
    if (Number(exists.rowCount) > 0) continue;

    try {
      const c = new ethers.Contract(addr, ERC20_IFACE, provider.getProvider());
      const [name, symbol, decimals] = await Promise.all([
        c.name().catch(() => null),
        c.symbol().catch(() => null),
        c.decimals().catch(() => null),
      ]);
      if (name == null && symbol == null && decimals == null) {
        continue;
      }
      await pg.query(
        `INSERT INTO erc20_tokens(address, detected_by_tx, detected_at_block, name, symbol, decimals)
         VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT (address) DO NOTHING`,
        [addr, row.created_by_tx, block, name, symbol, decimals],
      );
    } catch {
      // ignore
    }
  }

  await pg.query(
    `INSERT INTO ingest_cursors(module,last_processed_height) VALUES($1,$2)
     ON CONFLICT (module) DO UPDATE SET last_processed_height=EXCLUDED.last_processed_height, updated_at=NOW()`,
    ["erc20_registry", maxHeight],
  );
}
