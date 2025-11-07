import { Pool, Client } from "pg";

let globalPool: Pool | null = null;

export function getPool(dsn: string, maxConnections: number = 50): Pool {
  if (!globalPool) {
    globalPool = new Pool({
      connectionString: dsn,
      max: maxConnections, // Max connections in pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }
  return globalPool;
}

export async function connectPg(
  dsn: string,
  maxConnections?: number,
): Promise<Pool | Client> {
  // For backward compatibility, return Pool (which has same query interface)
  return getPool(dsn, maxConnections);
}

export async function closePool(): Promise<void> {
  if (globalPool) {
    await globalPool.end();
    globalPool = null;
  }
}

export async function getCursor(
  pg: Pool | Client,
  module: string,
): Promise<number | null> {
  const { rows } = await pg.query(
    "SELECT last_processed_height FROM ingest_cursors WHERE module=$1",
    [module],
  );
  if (!rows[0]) return null;
  const v = rows[0].last_processed_height;
  // pg returns int8 as string; coerce to number
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function upsertCursor(
  pg: Pool | Client,
  module: string,
  height: number,
): Promise<void> {
  await pg.query(
    `INSERT INTO ingest_cursors(module,last_processed_height) VALUES($1,$2)
     ON CONFLICT (module) DO UPDATE SET last_processed_height=EXCLUDED.last_processed_height, updated_at=NOW()`,
    [module, height],
  );
}
